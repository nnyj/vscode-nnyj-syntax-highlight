// Patches the VS Code workbench bundle. Run with VS Code closed or reload after.
// The extension in this folder reruns it on the first start of each new VS Code version.
// Patches start from the pristine .bak files, so a changed patch replaces the old one. Reruns write nothing.
// Restore: copy workbench.desktop.main.js.bak over workbench.desktop.main.js and product.json.bak over product.json.
// Usage: node vscode_workbench_patch.js [install dir], default the user install of VS Code.
// If WSL: node.exe "$(wslpath -w workbench_patch/vscode_workbench_patch.js)"
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const install_dir = process.argv[2] ?? path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code")
const workbench_rel = path.join("out", "vs", "workbench", "workbench.desktop.main.js")
const checksum_key = "vs/workbench/workbench.desktop.main.js"
const pointer_none = 'this.domNode.style.pointerEvents="none",'
const pipe_test = "/^\\s*\\|/.test("

const patches = [
  {
    // Editor webview insets ignore the mouse, so the wheel over them scrolls the editor natively.
    // Used by nnyj-syntax-highlight image and Mermaid insets. Chromium keeps routing a wheel gesture to the
    // inset iframe after it scrolls away from the pointer, and drops the events, which stalls scrolling.
    // Anchored on the EditorWebviewZone constructor view zone fields.
    name: "inset scroll",
    re: /(this\.domNode=document\.createElement\("div"\),this\.domNode\.style\.zIndex="10",)(this\.afterLineNumber=\w+,this\.afterColumn=1,this\.heightInLines=)/g,
    marker: pointer_none + "this.afterLineNumber=",
    replace: (_, head, tail) => `${head}${pointer_none}${tail}`,
  },
  {
    // Lines starting with `|` get no line break data, so Markdown table rows stay unwrapped while prose wraps.
    // Applies to every language, the line breaks computer only sees line text.
    // Anchored on the MonospaceLineBreaksComputerFactory finalize loop and its escaped line feed check.
    name: "table no-wrap",
    re: /(,(\w+)=\w+\.getLineContent\(\w+\),\w+=\w+\[\w+\],\w+=\w+&&\2\.includes\('"'\)&&\2\.includes\("\\\\n"\);)((\w+)&&!\4\.injectionOptions&&!\w+&&!\w+\?(\w+\[\w+\])=)/g,
    marker: pipe_test,
    replace: (_, head, line, tail, _previous, slot) => `${head}${pipe_test}${line})?${slot}=null:${tail}`,
  },
  {
    // Inset webviews size their own zone and get mouse input relayed, see zone_bridge.
    // Anchored on the EditorWebviewZone constructor end, the webview mount before dispose(), and on the zone _id it uses.
    name: "inset resize",
    re: /((\w+)\.mountTo\(this\.domNode,\w+\(\w+\.getDomNode\(\)\)\))\}dispose\(\)\{(this\.editor\.changeViewZones\(\w+=>this\._id&&)/g,
    marker: "zoneHeight",
    replace: (_, head, webview, tail) =>
      `${head},(${zone_bridge.toString()})(this,${webview})}dispose(){this.zoneAbort.abort();${tail}`,
  },
  {
    // Fold commands with explicit selectionLines keep the scroll position, unpatched they scroll to an off-screen cursor.
    // nnyj-syntax-highlight folds tables under their insets while scrolling and checks this marker.
    // Anchored on FoldingAction.runEditorCommand, the reveal after invoke.
    name: "fold no reveal",
    re: /(this\.invoke\(\w+,\w+,\w+,(\w+),\w+\);let (\w+)=\w+\.getSelection\(\);\3&&)(\w+\.reveal\(\3\.getStartPosition\(\)\))/g,
    marker: "selectionLines&&",
    replace: (_, head, args, _selection, tail) => `${head}!${args}?.selectionLines&&${tail}`,
  },
]

// Injected into the EditorWebviewZone constructor, so only browser globals and the zone are in scope.
// Messages from the webview:
//   zoneHeight: zone height in px, applied in place, so a height change needs no new webview.
//   zoneMouse: relay mouse input. The zone keeps ignoring the mouse (inset scroll), so the wheel always scrolls the
//     editor natively. Presses on the zone are kept from the editor and sent as zoneMouse {type, x, y, detail},
//     the webview selects text and handles clicks from them. A wheel gesture over an iframe stays on the iframe and
//     stalls once the iframe moves away from the pointer, so the iframe never takes the mouse itself.
//   zoneSelection: selected text, Ctrl+C copies it while set. A press outside the zone, any other key and an editor
//     selection change clear it.
// Every zone listens on the shared editor node, only the zone holding the selection acts on a key or copy.
function zone_bridge(zone, webview) {
  zone.zoneAbort = new AbortController()
  const signal = zone.zoneAbort.signal
  const editor_node = zone.editor.getDomNode()
  const host_document = editor_node.ownerDocument
  const host_window = host_document.defaultView
  // The webview sets inline pointer-events auto on its iframe after any window dragend, the !important rule wins
  zone.domNode.classList.add("nnyj-inset-zone")
  if (!host_document.getElementById("nnyj-inset-zone-style")) {
    const style = host_document.createElement("style")
    style.id = "nnyj-inset-zone-style"
    style.textContent = ".nnyj-inset-zone iframe { pointer-events: none !important; }"
    host_document.head.appendChild(style)
  }
  let relay = false
  let dragging = false
  let selection = ""
  const zone_point = (event) => {
    const rect = zone.domNode.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, inside: rect.height > 0 &&
      event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom }
  }
  const send = (type, event) => {
    const { x, y } = zone_point(event)
    webview.postMessage({ zoneMouse: { type, x, y, detail: event.detail } })
  }
  const clear = () => {
    if (selection) webview.postMessage({ zoneMouse: { type: "clear" } })
    selection = ""
  }
  // Overlay widgets over the zone (find, sticky scroll, scrollbar, minimap) and content widgets (hover, suggest) keep their presses
  const on_text_area = (target) => target.closest(".lines-content") && !target.closest(".contentWidgets")
  const press = (event) => {
    if (!relay) return
    if (!zone_point(event).inside || !on_text_area(event.target)) return clear()
    // pointerdown keeps its default, preventing it would cancel the mousedown that carries the click count
    event.stopPropagation()
    if (event.type !== "mousedown") return
    event.preventDefault()
    zone.editor.focus()
    dragging = true
    send("down", event)
  }
  editor_node.addEventListener("pointerdown", press, { capture: true, signal })
  editor_node.addEventListener("mousedown", press, { capture: true, signal })
  host_window.addEventListener("mousemove", (event) => { if (dragging) send("move", event) }, { capture: true, signal })
  host_window.addEventListener("mouseup", (event) => {
    if (!dragging) return
    dragging = false
    send("up", event)
  }, { capture: true, signal })
  editor_node.addEventListener("keydown", (event) => {
    if (!selection || !zone.editor.hasTextFocus() || ["Control", "Shift", "Alt", "Meta"].includes(event.key)) return
    if (!(event.ctrlKey || event.metaKey) || event.key !== "c") return clear()
    event.stopPropagation()
    event.preventDefault()
    host_document.execCommand("copy")
  }, { capture: true, signal })
  // The workbench origin lacks the clipboard write permission, the copy event can still set the copied text
  editor_node.addEventListener("copy", (event) => {
    if (!selection || !zone.editor.hasTextFocus()) return
    event.clipboardData.setData("text/plain", selection)
    event.preventDefault()
    event.stopImmediatePropagation()
  }, { capture: true, signal })
  const selection_listener = zone.editor.onDidChangeCursorSelection(clear)
  signal.addEventListener("abort", () => selection_listener.dispose())
  // A reparented iframe (split down, layout toggle) reloads blank, the webview ignores its second ready message.
  // Remounting gives the iframe a new src and resends the content. A load with a new src is a regular mount.
  const frame = webview.element
  let loaded_src
  let remounting = false
  frame?.addEventListener("load", () => {
    const src = frame.getAttribute("src")
    if (src !== loaded_src) remounting = false
    else if (src && !remounting) {
      remounting = true
      webview.reinitializeAfterDismount?.()
    }
    loaded_src = src
  }, { signal })
  webview.onMessage(({ message }) => {
    if (!message || signal.aborted) return
    if (message.zoneHeight > 0 && zone._id) {
      zone.heightInPx = message.zoneHeight
      zone.editor.changeViewZones((accessor) => accessor.layoutZone(zone._id))
    }
    if (message.zoneMouse) relay = true
    if (typeof message.zoneSelection === "string") selection = message.zoneSelection
  })
}

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("base64").replace(/=+$/, "")
}

// The .bak pair is pristine when product.json.bak is from the same build and holds the checksum of the bundle .bak
function read_backup(workbench_path, product_path) {
  const backup_paths = [`${workbench_path}.bak`, `${product_path}.bak`]
  if (!backup_paths.every((backup_path) => fs.existsSync(backup_path))) return null
  const [workbench, product] = backup_paths.map((backup_path) => fs.readFileSync(backup_path, "utf8"))
  const product_json = JSON.parse(product)
  if (product_json.commit !== JSON.parse(fs.readFileSync(product_path, "utf8")).commit) return null
  if (product_json.checksums?.[checksum_key] !== checksum(Buffer.from(workbench, "utf8"))) return null
  return { workbench, product }
}

// Returns the number of patches that failed to match
function patch_app(app_dir) {
  const workbench_path = path.join(app_dir, workbench_rel)
  const product_path = path.join(app_dir, "product.json")
  const current = { workbench: fs.readFileSync(workbench_path, "utf8"), product: fs.readFileSync(product_path, "utf8") }
  let pristine = read_backup(workbench_path, product_path)
  const backup_valid = !!pristine
  if (!pristine) {
    const found = patches.filter((patch) => current.workbench.includes(patch.marker)).map((patch) => patch.name)
    if (found.length > 0) throw new Error(`${workbench_path}: patched (${found.join(", ")}) and no pristine .bak, reinstall VS Code`)
    pristine = current
  }
  let source = pristine.workbench
  let failed = 0
  for (const patch of patches) {
    const matches = source.match(patch.re) ?? []
    if (matches.length !== 1) {
      console.error(`${patch.name}: expected 1 match, seen ${matches.length}`)
      failed++
      continue
    }
    source = source.replace(patch.re, patch.replace)
  }

  // Keep the integrity check quiet, otherwise VS Code reports a corrupt installation.
  // Checked before any write, so a missing key leaves both files untouched.
  const key_re = new RegExp(`("${checksum_key.replace(/[/.]/g, "\\$&")}"\\s*:\\s*")[^"]+(")`)
  if (!key_re.test(pristine.product)) throw new Error(`${product_path}: missing checksum for ${checksum_key}`)
  const product = pristine.product.replace(key_re, `$1${checksum(Buffer.from(source, "utf8"))}$2`)
  if (source === current.workbench && product === current.product) {
    console.log(`${workbench_path}: already patched`)
    return failed
  }

  if (!backup_valid) {
    fs.writeFileSync(`${workbench_path}.bak`, pristine.workbench)
    fs.writeFileSync(`${product_path}.bak`, pristine.product)
  }
  fs.writeFileSync(workbench_path, source)
  fs.writeFileSync(product_path, product)
  console.log(`${workbench_path}: written`)
  return failed
}

const app_dirs = fs
  .readdirSync(install_dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(install_dir, entry.name, "resources", "app"))
  .filter((app_dir) => fs.existsSync(path.join(app_dir, workbench_rel)))

if (app_dirs.length === 0) {
  console.error(`no VS Code app found under ${install_dir}`)
  process.exit(1)
}
let failed = 0
for (const app_dir of app_dirs) failed += patch_app(app_dir)
if (failed > 0) process.exit(1)
