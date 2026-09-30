const vscode = require('vscode')

// API for nnyj.nnyj-syntax-highlight, which activates this extension on demand through getExtension().activate().
// The proposed API throws here unless argv.json has "enable-proposed-api": ["nnyj.nnyj-inset-helper"].
function activate() {
  return {
    createInset: (editor, line, height, options) => vscode.window.createWebviewTextEditorInset(editor, line, height, options),
  }
}

module.exports = { activate }
