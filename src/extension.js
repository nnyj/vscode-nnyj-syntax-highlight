const vscode = require('vscode');
const indented_table = require('./indented_table');
const shell_comment = require('./shell_comment');

let stop_inline;

function activate(context) {
  indented_table.register(context);
  shell_comment.register(context);
  let inline_extension;
  let inline_context;
  let inline_api;

  stop_inline = () => {
    if (!inline_context) return;
    for (const subscription of inline_context.subscriptions.reverse()) subscription.dispose();
    inline_extension.deactivate();
    inline_context = undefined;
    inline_api = undefined;
  };

  const update_inline = () => {
    const enabled = vscode.workspace.getConfiguration('nnyjEditorStyling').get('inline.enabled', true);
    if (!enabled) {
      stop_inline();
    } else if (!inline_context) {
      inline_extension ??= require('./inline/extension');
      inline_context = Object.create(context, { subscriptions: { value: [] } });
      inline_api = inline_extension.activate(inline_context);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('nnyjEditorStyling.inline.enabled')) update_inline();
    }),
    { dispose: () => stop_inline() },
  );
  update_inline();
  return { get inline() { return inline_api; } };
}

function deactivate() {
  stop_inline?.();
  indented_table.dispose();
  shell_comment.dispose();
}

module.exports = { activate, deactivate };
