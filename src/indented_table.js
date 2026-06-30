const vscode = require('vscode');

const RE_ROW = /^\s*\|(.+)\|\s*$/;
const RE_SEP = /^\s*\|[\s:|\-]+\|\s*$/;

const BORDER = {
  borderWidth: '0 0 1px 0',
  borderStyle: 'solid',
  borderColor: 'rgba(128,128,128,1.0)',
};

let headerType, rowType, sepType, pipeType;

function createDecorationTypes() {
  disposeDecorationTypes();
  headerType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'var(--vscode-editorGroupHeader-tabsBackground)',
    fontWeight: 'bold',
    ...BORDER,
  });
  rowType = vscode.window.createTextEditorDecorationType({ ...BORDER });
  sepType = vscode.window.createTextEditorDecorationType({
    opacity: '0.15',
  });
  pipeType = vscode.window.createTextEditorDecorationType({
    color: 'rgba(128,128,128,1.0)',
  });
}

function disposeDecorationTypes() {
  headerType?.dispose();
  rowType?.dispose();
  sepType?.dispose();
  pipeType?.dispose();
}

function pipeRanges(lineNum, text) {
  const ranges = [];
  for (let c = 0; c < text.length; c++) {
    if (text[c] === '|')
      ranges.push(new vscode.Range(lineNum, c, lineNum, c + 1));
  }
  return ranges;
}

function findTables(doc) {
  const headers = [];
  const rows = [];
  const seps = [];
  const pipes = [];

  let i = 0;
  const lineCount = doc.lineCount;

  while (i < lineCount) {
    const line = doc.lineAt(i);
    if (!RE_ROW.test(line.text)) { i++; continue; }

    const start = i;
    let j = i + 1;
    while (j < lineCount && RE_ROW.test(doc.lineAt(j).text)) j++;

    if (j - start >= 3 && RE_SEP.test(doc.lineAt(start + 1).text)) {
      const sepNum = start + 1;
      const end = j - 1;

      const hdr = doc.lineAt(start);
      const hFirst = hdr.text.indexOf('|');
      const hLast = hdr.text.lastIndexOf('|');
      headers.push({ range: new vscode.Range(start, hFirst, start, hLast + 1) });
      pipes.push(...pipeRanges(start, hdr.text).map(range => ({ range })));

      seps.push({
        range: new vscode.Range(sepNum, 0, sepNum, doc.lineAt(sepNum).text.length),
      });

      for (let n = sepNum + 1; n <= end; n++) {
        const row = doc.lineAt(n);
        const rFirst = row.text.indexOf('|');
        const rLast = row.text.lastIndexOf('|');
        rows.push({ range: new vscode.Range(n, rFirst, n, rLast + 1) });
        pipes.push(...pipeRanges(n, row.text).map(range => ({ range })));
      }
    }

    i = j;
  }

  return { headers, rows, seps, pipes };
}

function applyDecorations(editor) {
  const { headers, rows, seps, pipes } = findTables(editor.document);
  editor.setDecorations(headerType, headers);
  editor.setDecorations(rowType, rows);
  editor.setDecorations(sepType, seps);
  editor.setDecorations(pipeType, pipes);
}

let debounceTimer;

function register(context) {
  createDecorationTypes();

  const update = (editor) => {
    if (editor?.document?.languageId === 'markdown') {
      applyDecorations(editor);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => update(editor), 100);
      }
    })
  );

  for (const editor of vscode.window.visibleTextEditors) {
    update(editor);
  }
}

function dispose() {
  clearTimeout(debounceTimer);
  disposeDecorationTypes();
}

module.exports = { register, dispose };
