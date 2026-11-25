const { execFile } = require('child_process')
const path = require('path')
const vscode = require('vscode')

// API for nnyj.nnyj-syntax-highlight, which activates this extension on demand through getExtension().activate().
// The proposed API throws here unless argv.json has "enable-proposed-api": ["nnyj.nnyj-workbench-patch"].
function activate(context) {
  // A remote extension host runs on another machine, it cannot patch the local install
  if (!vscode.env.remoteName) workbench_patch(context)
  return {
    createInset: (editor, line, height, options) => vscode.window.createWebviewTextEditorInset(editor, line, height, options),
  }
}

// Reruns vscode_workbench_patch.js on the first start of each new VS Code or extension version, on the install running this extension
function workbench_patch(context) {
  const patched_version = `${vscode.version}|${context.extension.packageJSON.version}`
  if (context.globalState.get('patched_version') === patched_version) return
  const script_path = path.join(context.extensionPath, 'vscode_workbench_patch.js')
  const install_dir = path.dirname(process.execPath)
  // ELECTRON_RUN_AS_NODE makes Code.exe run the script as plain node, so no node install is needed
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  execFile(process.execPath, [script_path, install_dir], { env }, async (error, stdout, stderr) => {
    if (error) {
      vscode.window.showErrorMessage(`Workbench patch failed: ${stderr || error.message}`)
      return
    }
    await context.globalState.update('patched_version', patched_version)
    if (!stdout.includes(': written')) return
    // The main process caches product.json checksums at launch, so a window reload still shows the corrupt install banner
    const message = `Workbench patched for VS Code ${vscode.version}, quit and reopen to load it`
    const choice = await vscode.window.showInformationMessage(message, 'Quit')
    if (choice === 'Quit') vscode.commands.executeCommand('workbench.action.quit')
  })
}

module.exports = { activate }
