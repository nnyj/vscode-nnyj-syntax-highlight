const vscode = require('vscode');

const RE_FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*(?:shell|sh|bash|zsh)\b/i;
const RE_FENCE_CLOSE = /^(\s*)(`{3,}|~{3,})\s*$/;

let commentType;

function findComments(doc) {
  const ranges = [];
  let fence = null;

  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;

    if (!fence) {
      const m = text.match(RE_FENCE_OPEN);
      if (m) fence = { indent: m[1].length, marker: m[2][0], len: m[2].length };
      continue;
    }

    const cm = text.match(RE_FENCE_CLOSE);
    if (cm && cm[2][0] === fence.marker && cm[2].length >= fence.len
        && cm[1].length <= fence.indent + 3) {
      fence = null;
      continue;
    }

    const trimmed = text.trimStart();
    if (trimmed.startsWith('#')) {
      const start = text.length - trimmed.length;
      ranges.push(new vscode.Range(i, start, i, text.length));
    }
  }

  return ranges;
}

function applyDecorations(editor) {
  if (editor?.document?.languageId !== 'markdown') return;
  editor.setDecorations(commentType, findComments(editor.document));
}

let debounceTimer;

function register(context) {
  commentType?.dispose();
  commentType = vscode.window.createTextEditorDecorationType({
    color: '#6A9955',
  });

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(applyDecorations),
    vscode.workspace.onDidChangeTextDocument(e => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => applyDecorations(editor), 100);
      }
    })
  );

  for (const editor of vscode.window.visibleTextEditors) {
    applyDecorations(editor);
  }
}

function dispose() {
  clearTimeout(debounceTimer);
  commentType?.dispose();
}

module.exports = { register, dispose };
