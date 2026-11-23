"""Regression check for the inset features of vscode-nnyj-syntax-highlight.

Usage: python inset_check.py [--repo DIR] [--code-exe PATH] [--only TEXT]
Expects `dist/` built in the repo. Runs a VS Code instance on a hidden desktop through vscode_hidden.py,
prints one `PASS|FAIL name: expected X, seen Y` line per check, exits 1 on any FAIL.
"""
import argparse
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
LAUNCHER = HERE / "vscode_hidden.py"
WORK = Path(tempfile.gettempdir()) / "inset_check"
CDP_PORT = 9371
DRIVER_PORT = 9372
SETTINGS = {
  "editor.wordWrap": "on",
  "security.workspace.trust.enabled": False,
  "window.dialogStyle": "custom",
  "workbench.startupEditor": "none",
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
  "window.restoreWindows": "none",
  "files.hotExit": "off",
  "git.enabled": True,
  "git.openRepositoryInParentFolders": "never",
  "chat.disableAIFeatures": True,
}

BASE_TEXT = """# Title

Some text paragraph before the table.

## Section A

Intro line for A.

| Name | Value |
| --- | --- |
| alpha | one |
| beta | two |

After table text.

## Section B

More text in B.
line b2
line b3
"""

# Table at line 4, the burst and arrow scenarios walk through it.
ARROW_TEXT = """# Format test

Text above.

| a               | b                       |
| --------------- | ----------------------- |
| long cell value | x                       |
| y               | another long value here |

Middle text.

- item
  | c   | d   |
  | --- | --- |
  | 1   | 2   |

Tail text.
"""

RESTART_TEXT = """# Restart

## Open

| item | next step |
| --- | --- |
| first | photo the group names |
| second | check the cabinet |

End text.
"""


# Table at line 13, a drag from line 1 to the middle of the viewport crosses it.
DRAG_TEXT = ("".join(f"Line {n} of prose above the table.\n" for n in range(12)) +
  "\n| Name | Value | Note |\n| --- | --- | --- |\n" +
  "".join(f"| row{n} | {n} | a longer note cell {n} |\n" for n in range(8)) +
  "\n" + "".join(f"Line {n} of prose below the table.\n" for n in range(80)))

# Table on the last lines, Ctrl+A ends the selection in its folded rows.
END_TABLE_TEXT = "# End\n\nText.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n"


def long_table_text():
  rows = "".join(f"| a{n} | b{n} |\n" for n in range(300))
  tail = "".join(f"Tail line {n}\n" for n in range(200))
  return f"# Long\n\nIntro.\n\n| Col A | Col B |\n| --- | --- |\n{rows}\n{tail}"


# External edits as in a file written by another program, each applied to the text left by the one before.
def edit_change_cell(text):
  return text.replace("| alpha | one |", "| alpha | ONE changed |", 1)


def edit_append_row(text):
  return text.replace("| beta | two |\n", "| beta | two |\n| gamma | three |\n", 1)


def edit_rewrite_same(text):
  return (text.replace("Some text", "Other words").replace("| Name | Value |", "| Key | Val |")
    .replace("| beta | two |", "| bravo | 2 |").replace("After table", "Below table"))


def edit_insert_above(text):
  return text.replace("Intro line for A.\n", "Intro line for A.\nInserted one.\nInserted two.\n", 1)


def edit_add_table(text):
  return text.replace("line b2\n", "line b2\n\n| K | V |\n| - | - |\n| x | 1 |\n| y | 2 |\n\n", 1)


def edit_delete_table(text):
  return "".join(line for line in text.splitlines(True) if not line.startswith("|"))


def edit_reset(text):
  return BASE_TEXT


EDIT_MATRIX = {
  "change_cell": edit_change_cell,
  "append_row": edit_append_row,
  "rewrite_same": edit_rewrite_same,
  "insert_above": edit_insert_above,
  "add_table": edit_add_table,
  "delete_table": edit_delete_table,
  "reset": edit_reset,
}

EDITOR_DOM_JS = r"""
() => [...document.querySelectorAll('.monaco-editor')]
  .filter(editor => (editor.getAttribute('data-uri') || '').endsWith('.md'))
  .map(editor => ({
    uri: editor.getAttribute('data-uri'),
    zones: [...editor.querySelectorAll('.view-zones > div')]
      .filter(zone => zone.querySelector('iframe') && zone.getBoundingClientRect().height > 0)
      .map(zone => ({ height: Math.round(zone.getBoundingClientRect().height), src: zone.querySelector('iframe').src })),
  }))
"""

PANEL_CENTER_JS = r"""
() => {
  const panel = [...document.querySelectorAll('iframe.webview')]
    .find(frame => !frame.closest('.view-zones') && frame.getBoundingClientRect().width > 50);
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
"""

# Per frame: top of the first line below the table and the inset count, for the editor whose uri ends with the argument.
SAMPLER_JS = r"""
(uri_end) => {
  const editor = [...document.querySelectorAll('.monaco-editor')]
    .find(e => (e.getAttribute('data-uri') || '').endsWith(uri_end) && e.getBoundingClientRect().width > 0);
  window.__samples = [];
  window.__sampling = true;
  const tick = () => {
    if (!window.__sampling) return;
    const below = [...editor.querySelectorAll('.view-line')]
      .find(line => line.textContent.replace(/\s/g, ' ').startsWith('Line 0 of prose below'));
    window.__samples.push({ below: below ? Math.round(below.getBoundingClientRect().top) : null,
      zones: editor.querySelectorAll('.view-zones > div iframe').length });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const rect = editor.querySelector('.view-lines').getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: Math.min(rect.bottom, innerHeight) };
}
"""

SAMPLER_STOP_JS = "() => { window.__sampling = false; return window.__samples; }"

INNER_CONTENT_JS = "() => document.body ? document.body.innerHTML.length : 0"

results = []


def report(name, ok, expected, seen):
  results.append(ok)
  print(f"{'PASS' if ok else 'FAIL'} {name}: expected {expected}, seen {seen}", flush=True)


def wait_for(read, accept, timeout=5.0, interval=0.1):
  """Polls read() until accept(value), returns the last value."""
  deadline = time.time() + timeout
  while True:
    value = read()
    if accept(value) or time.time() > deadline:
      return value
    time.sleep(interval)


def port_free(port):
  with socket.socket() as probe:
    return probe.connect_ex(("127.0.0.1", port)) != 0


def pick_ports():
  global CDP_PORT, DRIVER_PORT
  while not port_free(CDP_PORT):
    CDP_PORT += 10
  while DRIVER_PORT == CDP_PORT or not port_free(DRIVER_PORT):
    DRIVER_PORT += 10


class Instance:
  def __init__(self, repo, code_exe):
    self.repo = repo
    self.code_exe = code_exe
    self.user_dir = WORK / "user"
    self.workspace = WORK / "ws"
    self.page = None
    self.fresh_count = 0

  def start(self):
    # git writes its object files read-only, which rmtree cannot delete as is
    def remove_read_only(remove, path, _error):
      os.chmod(path, stat.S_IWRITE)
      remove(path)
    if WORK.exists():
      shutil.rmtree(WORK, onexc=remove_read_only)
    (self.user_dir / "User").mkdir(parents=True)
    (self.user_dir / "User" / "settings.json").write_text(json.dumps(SETTINGS, indent=2), newline="\n")
    self.workspace.mkdir(parents=True)
    # A git repo with one changed file, for the git diff drag check
    tracked = self.workspace / "tracked.md"
    tracked.write_text(DRAG_TEXT, newline="\n")
    for git_args in (["init", "-q"], ["add", "."], ["-c", "user.name=check", "-c", "user.email=check@localhost", "commit", "-qm", "base"]):
      subprocess.run(["git", "-C", self.workspace.as_posix(), *git_args], check=True, capture_output=True)
    tracked.write_text(DRAG_TEXT.replace("Line 5 of prose above", "Line 5 changed above"), newline="\n")
    env = dict(os.environ, INSET_CHECK_DRIVER_PORT=str(DRIVER_PORT))
    if self.code_exe:
      env["VSCODE_EXE"] = self.code_exe
    repo = self.repo.as_posix()
    args = [
      sys.executable, str(LAUNCHER), "start",
      "--user-data-dir", self.user_dir.as_posix(),
      "--extensions-dir", (WORK / "ext").as_posix(),
      f"--extensionDevelopmentPath={repo}",
      f"--extensionDevelopmentPath={repo}/workbench_patch",
      f"--extensionDevelopmentPath={(HERE / 'driver').as_posix()}",
      "--enable-proposed-api", "nnyj.nnyj-workbench-patch",
      f"--remote-debugging-port={CDP_PORT}",
      self.workspace.as_posix(),
    ]
    subprocess.run(args, env=env, check=True, capture_output=True)

  def stop(self):
    subprocess.run([sys.executable, str(LAUNCHER), "stop", self.user_dir.as_posix()], capture_output=True)

  def connect(self, playwright):
    browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
    self.page = wait_for(self.find_workbench(browser), lambda page: page is not None, 30, 0.5)
    if self.page is None:
      raise RuntimeError("no workbench page")
    ready = wait_for(self.driver_ready, bool, 60, 0.5)
    if not ready:
      raise RuntimeError("driver does not answer")

  def find_workbench(self, browser):
    def find():
      for context in browser.contexts:
        for page in context.pages:
          if "workbench" in page.url:
            return page
      return None
    return find

  def driver_ready(self):
    try:
      return self.ext("return 1") == 1
    except (OSError, RuntimeError):
      return False

  def ext(self, js):
    """Runs an async JS body in the extension host, `vscode` in scope."""
    request = urllib.request.Request(f"http://127.0.0.1:{DRIVER_PORT}", data=js.encode(), method="POST")
    answer = json.loads(urllib.request.urlopen(request, timeout=30).read())
    if not answer["ok"]:
      raise RuntimeError(answer["error"])
    return answer.get("result")

  def command(self, name, argument=None):
    argument_js = "" if argument is None else ", " + json.dumps(argument)
    return self.ext(f"return await vscode.commands.executeCommand({json.dumps(name)}{argument_js}) ?? null")

  def press(self, key, count=1, delay=0.05):
    for _ in range(count):
      self.page.keyboard.press(key)
      time.sleep(delay)

  def close_all(self):
    # A dirty file would open a save dialog that blocks closeAllEditors.
    self.ext("""
      globalThis.panel?.dispose()
      globalThis.panel = undefined
      for (const doc of vscode.workspace.textDocuments) if (doc.isDirty && !doc.isUntitled) await doc.save()
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      return 1""")
    time.sleep(0.3)

  def new_file(self, text):
    """A new file name each time: VS Code restores fold state per file name."""
    self.fresh_count += 1
    path = self.workspace / f"case_{self.fresh_count}.md"
    path.write_text(text, newline="\n")
    return path

  def open_file(self, path, line=0, column=None):
    column_js = f", viewColumn: {column}" if column else ""
    self.ext(f"""
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file({json.dumps(path.as_posix())}))
      await vscode.window.showTextDocument(doc, {{ preview: false{column_js},
        selection: new vscode.Selection({line}, 0, {line}, 0) }})
      return 1""")

  def focus_editor(self):
    self.command("workbench.action.focusActiveEditorGroup")

  def set_cursor(self, line, character=0):
    self.ext(f"""
      const editor = vscode.window.activeTextEditor
      editor.selection = new vscode.Selection({line}, {character}, {line}, {character})
      return 1""")

  def editor_info(self, path):
    """Text, visible line ranges and selection of the visible editor showing `path`."""
    return self.ext(f"""
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath.endsWith({json.dumps(path.name)}))
      if (!editor) return null
      return {{ text: editor.document.getText(), visible: editor.visibleRanges.map(r => [r.start.line, r.end.line]),
        active: [editor.selection.active.line, editor.selection.active.character] }}""")

  def zones(self):
    """Inset zones with a height, per markdown editor in the DOM."""
    return self.page.evaluate(EDITOR_DOM_JS)

  def zone_count(self):
    return sum(len(editor["zones"]) for editor in self.zones())

  def zone_contents(self):
    """Per inset zone: size of the body inside its webview frame, 0 when blank."""
    sizes = []
    for editor in self.zones():
      for zone in editor["zones"]:
        sizes.append(self.zone_body_size(zone["src"]))
    return sizes

  def zone_body_size(self, src):
    webview_id = src.split("id=")[-1].split("&")[0]
    for frame in self.page.frames:
      if frame.url.startswith("vscode-webview://") and webview_id in frame.url:
        for child in frame.child_frames:
          try:
            return child.evaluate(INNER_CONTENT_JS)
          except Exception:
            return 0
    return 0


def table_ranges(text):
  """(first line, last line) of each run of 2+ lines starting with a pipe."""
  ranges = []
  start = None
  lines = text.split("\n")
  for number, line in enumerate(lines + [""]):
    if line.lstrip().startswith("|"):
      if start is None:
        start = number
    elif start is not None:
      if number - start >= 2:
        ranges.append((start, number - 1))
      start = None
  return ranges


def is_visible(line, visible):
  return any(first <= line <= last for first, last in visible)


def rows_visible(info, table):
  return any(is_visible(line, info["visible"]) for line in range(table[0] + 1, table[1] + 1))


def rows_hidden(info, table):
  return not rows_visible(info, table)


def first_table(info):
  return table_ranges(info["text"])[0]


# ---------------------------------------------------------------- scenarios

def check_render(vsc):
  vsc.close_all()
  path = vsc.new_file(BASE_TEXT)
  vsc.open_file(path)
  vsc.focus_editor()
  wait_for(vsc.zone_count, lambda count: count > 0)
  info = vsc.editor_info(path)
  zones = [zone for editor in vsc.zones() for zone in editor["zones"]]
  table = first_table(info)
  report("render rows hidden", rows_hidden(info, table), f"table rows {table} outside visible", info["visible"])
  report("render one zone", len(zones) == 1 and zones[0]["height"] > 0,
    "1 zone with height > 0 and an iframe", [zone["height"] for zone in zones])


def check_cursor_in_out(vsc):
  vsc.close_all()
  path = vsc.new_file(BASE_TEXT)
  vsc.open_file(path)
  vsc.focus_editor()
  wait_for(vsc.zone_count, lambda count: count > 0)
  table = first_table(vsc.editor_info(path))
  vsc.set_cursor(table[0] + 1)
  info = wait_for(lambda: vsc.editor_info(path), lambda value: rows_visible(value, table))
  zones = wait_for(vsc.zone_count, lambda count: count == 0)
  report("cursor in shows source", rows_visible(info, table) and zones == 0,
    "rows visible, 0 zones", f"visible {info['visible']}, {zones} zones")
  vsc.set_cursor(0)
  info = wait_for(lambda: vsc.editor_info(path), lambda value: rows_hidden(value, table))
  zones = wait_for(vsc.zone_count, lambda count: count == 1)
  report("cursor out refolds", rows_hidden(info, table) and zones == 1,
    "rows hidden, 1 zone", f"visible {info['visible']}, {zones} zones")


def is_double_table(vsc, path):
  """An inset zone while the rows of a table show as source, with the cursor outside every table."""
  info = vsc.editor_info(path)
  if info is None:
    return False
  rows_shown = any(rows_visible(info, table) for table in table_ranges(info["text"]))
  return rows_shown and vsc.zone_count() > 0


def open_panel_and_click(vsc):
  vsc.ext("""
    const panel = vscode.window.createWebviewPanel('inset_check', 'Chat', vscode.ViewColumn.Two, {})
    panel.webview.html = '<h1>chat</h1>'
    globalThis.panel = panel
    return 1""")
  center = wait_for(lambda: vsc.page.evaluate(PANEL_CENTER_JS), lambda value: value is not None)
  if center is None:
    return False
  for _ in range(3):
    vsc.ext("await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup'); return 1")
    wait_for(lambda: vsc.ext("return globalThis.panel.active"), lambda active: not active, 3)
    center = vsc.page.evaluate(PANEL_CENTER_JS)
    vsc.page.mouse.click(center["x"], center["y"])
    if wait_for(lambda: vsc.ext("return globalThis.panel.active"), bool, 2):
      return True
  return False


def check_external_edits(vsc):
  for focus in ("editor", "panel"):
    vsc.close_all()
    path = vsc.new_file(BASE_TEXT)
    vsc.open_file(path, column=1)
    wait_for(vsc.zone_count, lambda count: count > 0)
    if focus == "panel":
      focused = open_panel_and_click(vsc)
      report("external_edit panel focus", focused is True, "panel active after real click", focused)
    else:
      vsc.focus_editor()
    text = BASE_TEXT
    for name, edit in EDIT_MATRIX.items():
      text = edit(text)
      path.write_text(text, newline="\n")
      synced = wait_for(lambda: vsc.editor_info(path), lambda info: info["text"].replace("\r\n", "\n") == text)
      time.sleep(1.0)
      double_at = None
      for _ in range(6):
        if is_double_table(vsc, path):
          double_at = vsc.zone_count()
        else:
          double_at = None
        time.sleep(0.2)
      loaded = synced["text"].replace("\r\n", "\n") == text
      report(f"external_edit {focus} {name}", loaded and double_at is None,
        "editor shows the edit, no zone above visible rows",
        f"loaded {loaded}, zones above visible rows {double_at}")
    vsc.ext("globalThis.panel?.dispose(); return 1")


def check_reopen_on_folded_header(vsc):
  vsc.close_all()
  path = vsc.new_file(RESTART_TEXT)
  vsc.open_file(path, line=0)
  vsc.focus_editor()
  table = table_ranges(RESTART_TEXT)[0]
  wait_for(lambda: vsc.editor_info(path), lambda info: rows_hidden(info, table))
  vsc.close_all()
  time.sleep(1.0)
  vsc.open_file(path, line=table[0])
  info = wait_for(lambda: vsc.editor_info(path), lambda value: rows_visible(value, table), 2.0)
  report("reopen on folded header", rows_visible(info, table),
    f"rows {table} visible within 2 s", f"visible {info['visible']}")


def check_arrows(vsc):
  table = table_ranges(ARROW_TEXT)[0]

  def start_at(line):
    vsc.close_all()
    path = vsc.new_file(ARROW_TEXT)
    vsc.open_file(path, line=line)
    vsc.focus_editor()
    wait_for(lambda: vsc.editor_info(path), lambda info: rows_hidden(info, table) and info["active"][0] == line)
    wait_for(vsc.zone_count, lambda count: count > 0)
    time.sleep(0.5)
    vsc.focus_editor()
    return path

  path = start_at(table[1] + 1)
  vsc.press("ArrowUp")
  line = wait_for(lambda: vsc.editor_info(path)["active"][0], lambda value: value != table[1] + 1)
  report("arrow up enters last row", line == table[1], f"line {table[1]}", f"line {line}")

  path = start_at(table[0] - 1)
  vsc.press("ArrowDown")
  line = wait_for(lambda: vsc.editor_info(path)["active"][0], lambda value: value != table[0] - 1)
  report("arrow down enters header", line == table[0], f"line {table[0]}", f"line {line}")

  path = start_at(0)
  vsc.press("ArrowDown", 10, 0.033)
  time.sleep(1.5)
  line = vsc.editor_info(path)["active"][0]
  report("arrow down burst", line == 10, "line 10 after 10 presses at 33 ms", f"line {line}")


def check_goto_line(vsc):
  vsc.close_all()
  path = vsc.new_file(long_table_text())
  vsc.open_file(path, line=505)
  vsc.focus_editor()
  time.sleep(1.5)
  vsc.command("workbench.action.gotoLine")
  time.sleep(0.5)
  vsc.page.keyboard.type("200")
  vsc.press("Enter")
  wait_for(lambda: vsc.editor_info(path), lambda value: value["active"][0] == 199)
  time.sleep(1.5)
  info = vsc.editor_info(path)
  report("goto line in long table", info["active"][0] == 199 and is_visible(199, info["visible"]),
    "cursor on line 199 and line 199 visible", f"cursor {info['active'][0]}, visible {info['visible']}")


def check_broken_table(vsc):
  vsc.close_all()
  path = vsc.new_file(BASE_TEXT)
  vsc.open_file(path)
  vsc.focus_editor()
  wait_for(vsc.zone_count, lambda count: count > 0)
  table = table_ranges(BASE_TEXT)[0]
  vsc.ext(f"""
    const editor = vscode.window.activeTextEditor
    const end = editor.document.lineAt({table[0]}).range.end
    await editor.edit(builder => builder.insert(end, ' extra |'))
    return 1""")
  info = wait_for(lambda: vsc.editor_info(path), lambda value: rows_visible(value, table), 3.0)
  zones = wait_for(vsc.zone_count, lambda count: count == 0, 3.0)
  report("broken table unfolds", rows_visible(info, table) and zones == 0,
    "rows visible, 0 zones", f"visible {info['visible']}, {zones} zones")


def check_split(vsc):
  vsc.close_all()
  path = vsc.new_file(BASE_TEXT)
  vsc.open_file(path)
  vsc.focus_editor()
  wait_for(vsc.zone_contents, lambda sizes: len(sizes) == 1 and sizes[0] > 0)
  for step, command, editors in (
      ("right", "workbench.action.splitEditorRight", 2),
      ("back", "workbench.action.closeActiveEditor", 1)):
    vsc.command(command)
    sizes = wait_for(vsc.zone_contents, lambda value: len(value) == editors and all(value), 3.0)
    report(f"split {step} not blank", len(sizes) == editors and all(sizes),
      f"{editors} zones with content within 3 s", f"content sizes {sizes}")


def drag_layout(vsc, uri_end):
  """Drags from the second line down across the table and back up, returns (layout changes, inset count changes)."""
  box = vsc.page.evaluate(SAMPLER_JS, uri_end)
  x = box["left"] + 40
  y_from = box["top"] + 30
  y_to = box["top"] + (box["bottom"] - box["top"]) * 0.6
  vsc.page.mouse.move(x, y_from)
  vsc.page.mouse.down()
  for step in list(range(1, 41)) + list(range(40, 0, -2)):
    vsc.page.mouse.move(x, y_from + (y_to - y_from) * step / 40)
    time.sleep(0.03)
  vsc.page.mouse.up()
  time.sleep(0.5)
  samples = vsc.page.evaluate(SAMPLER_STOP_JS)
  changes = lambda key: sum(1 for a, b in zip(samples, samples[1:]) if a[key] != b[key])
  return changes("below"), changes("zones")


def check_drag_select(vsc):
  vsc.close_all()
  path = vsc.new_file(DRAG_TEXT)
  vsc.open_file(path)
  vsc.focus_editor()
  wait_for(vsc.zone_count, lambda count: count > 0)
  time.sleep(1.0)
  moved, zones = drag_layout(vsc, path.name)
  report("drag select keeps layout", moved == 0 and zones == 0, "0 layout and 0 inset changes", f"{moved} layout, {zones} inset")
  table = table_ranges(DRAG_TEXT)[0]

  vsc.set_cursor(table[0] - 2)
  vsc.focus_editor()
  time.sleep(0.5)
  vsc.press("Shift+ArrowDown", 4, 0.15)
  time.sleep(1.0)
  info = vsc.editor_info(path)
  zones = vsc.zone_count()
  report("shift down through table keeps fold", rows_hidden(info, table) and zones == 1 and info["active"][0] > table[1],
    f"rows hidden, 1 zone, cursor below line {table[1]}", f"visible {info['visible']}, {zones} zones, cursor {info['active']}")
  copied = vsc.ext("""
    const before = await vscode.env.clipboard.readText()
    await vscode.commands.executeCommand('editor.action.clipboardCopyAction')
    const text = await vscode.env.clipboard.readText()
    await vscode.env.clipboard.writeText(before)
    return text""")
  report("copy across folded table has rows", "| row7 | 7 |" in copied and "| row0 | 0 |" in copied,
    "copied text holds rows 0 and 7", repr(copied[:80]))

  vsc.set_cursor(0)
  time.sleep(0.5)
  vsc.focus_editor()
  vsc.press("Control+a")
  time.sleep(1.0)
  info = vsc.editor_info(path)
  zones = vsc.zone_count()
  report("select all keeps fold", rows_hidden(info, table) and zones == 1, "rows hidden, 1 zone",
    f"visible {info['visible']}, {zones} zones")

  vsc.close_all()
  path = vsc.new_file(END_TABLE_TEXT)
  vsc.open_file(path)
  vsc.focus_editor()
  wait_for(vsc.zone_count, lambda count: count > 0)
  time.sleep(1.0)
  vsc.press("Control+a")
  time.sleep(1.5)
  visible = []
  for _ in range(5):
    visible.append(vsc.editor_info(path)["visible"])
    time.sleep(0.2)
  report("select all with table at the end settles", all(view == visible[0] for view in visible),
    "same visible ranges over 1 s", visible)


def check_drag_diff(vsc):
  vsc.close_all()
  left = vsc.workspace / "diff_left.md"
  right = vsc.workspace / "diff_right.md"
  left.write_text(DRAG_TEXT, newline="\n")
  right.write_text(DRAG_TEXT.replace("Line 5 of prose above", "Line 5 changed above"), newline="\n")
  vsc.ext(f"""await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file({json.dumps(left.as_posix())}),
    vscode.Uri.file({json.dumps(right.as_posix())}), 'diff'); return 1""")
  time.sleep(2.0)
  moved, zones = drag_layout(vsc, right.name)
  report("diff drag keeps layout", moved == 0 and zones == 0, "0 layout and 0 inset changes", f"{moved} layout, {zones} inset")
  vsc.close_all()
  tracked = vsc.workspace / "tracked.md"
  opened = wait_for(lambda: vsc.ext(f"""
    await vscode.commands.executeCommand('git.openChange', vscode.Uri.file({json.dumps(tracked.as_posix())}))
    return vscode.window.visibleTextEditors.some(editor => editor.document.uri.scheme === 'git')"""), bool, 15, 1.0)
  time.sleep(2.0)
  moved, zones = drag_layout(vsc, "tracked.md")
  report("git diff drag keeps layout", opened and moved == 0 and zones == 0, "git diff open, 0 layout and 0 inset changes",
    f"open {opened}, {moved} layout, {zones} inset")


SCENARIOS = [
  check_render, check_cursor_in_out, check_external_edits, check_reopen_on_folded_header,
  check_arrows, check_goto_line, check_broken_table, check_split, check_drag_select, check_drag_diff,
]


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--repo", default=REPO)
  parser.add_argument("--code-exe")
  parser.add_argument("--only", default="", help="run scenarios whose function name contains this text")
  args = parser.parse_args()
  sys.stdout.reconfigure(encoding="utf-8")
  pick_ports()
  started = time.time()
  vsc = Instance(Path(args.repo), args.code_exe)
  try:
    vsc.start()
    with sync_playwright() as playwright:
      vsc.connect(playwright)
      for scenario in SCENARIOS:
        if args.only not in scenario.__name__:
          continue
        try:
          scenario(vsc)
        except Exception as error:
          report(scenario.__name__, False, "scenario runs", f"{type(error).__name__}: {error}")
  finally:
    vsc.stop()
  print(f"{results.count(True)} passed, {results.count(False)} failed, {time.time() - started:.0f} s")
  sys.exit(1 if False in results else 0)


if __name__ == "__main__":
  main()
