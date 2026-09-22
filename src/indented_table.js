const vscode = require('vscode');

const RE_ROW = /^\s*\|(.+)\|\s*$/;
const RE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const emoji_pattern = /\p{Emoji_Presentation}|\uFE0F|\u20E3/u;
const emoji_decorations = new Map();
const languages = new Set(['markdown', 'mdx', 'quarto']);

const BORDER = {
  borderWidth: '0 0 1px 0',
  borderStyle: 'solid',
  borderColor: 'rgba(128,128,128,0.3)',
};

let headerType, rowType, sepType, pipeType;
let inline_enabled;

function createDecorationTypes() {
  disposeDecorationTypes();
  inline_enabled = vscode.workspace.getConfiguration('nnyjEditorStyling').get('inline.enabled', true);
  headerType = vscode.window.createTextEditorDecorationType({
    ...(inline_enabled ? {} : { fontWeight: 'bold' }),
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
  emoji_decorations.forEach(decoration => decoration.dispose());
  emoji_decorations.clear();
}

function emoji_runs(text) {
  const runs = [];
  for (const { segment, index } of segments.segment(text)) {
    if (!emoji_pattern.test(segment)) continue;
    const previous = runs[runs.length - 1];
    // Adjacent spans with the same decoration merge in Monaco.
    if (previous?.end === index) {
      previous.end += segment.length;
      previous.columns += 2;
    } else {
      runs.push({ start: index, end: index + segment.length, columns: 2 });
    }
  }
  return runs;
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
  const emoji = new Map();

  let i = 0;
  const lineCount = doc.lineCount;
  let fence;

  while (i < lineCount) {
    const line = doc.lineAt(i);
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      i++;
      continue;
    }
    if (fence) { i++; continue; }
    if (!line.text.includes('|') || i + 1 >= lineCount || !RE_SEP.test(doc.lineAt(i + 1).text)) { i++; continue; }

    const start = i;
    const indent = /^\s*/.exec(line.text)[0];
    let j = i + 2;
    while (j < lineCount && doc.lineAt(j).text.includes('|') && /^\s*/.exec(doc.lineAt(j).text)[0] === indent) j++;

    if (j - start >= 2 && RE_SEP.test(doc.lineAt(start + 1).text)) {
      const sepNum = start + 1;
      const end = j - 1;
      for (let row = start; row <= end; row++) {
        for (const run of emoji_runs(doc.lineAt(row).text)) {
          if (!emoji.has(run.columns)) emoji.set(run.columns, []);
          emoji.get(run.columns).push(new vscode.Range(row, run.start, row, run.end));
        }
      }
      if (!RE_ROW.test(line.text)) { i = j; continue; }

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

  return { headers, rows, seps, pipes, emoji };
}

function applyDecorations(editor) {
  const { headers, rows, seps, pipes, emoji } = findTables(editor.document);
  editor.setDecorations(headerType, headers);
  editor.setDecorations(rowType, rows);
  editor.setDecorations(sepType, inline_enabled ? [] : seps);
  editor.setDecorations(pipeType, inline_enabled ? [] : pipes);
  for (const columns of emoji.keys()) {
    if (!emoji_decorations.has(columns)) {
      // The API has no width property for source text; use a fixed-width inline box.
      emoji_decorations.set(columns, vscode.window.createTextEditorDecorationType({
        textDecoration: `none; display: inline-block; width: ${columns}ch; text-align: center;`,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      }));
    }
  }
  for (const [columns, decoration] of emoji_decorations) editor.setDecorations(decoration, emoji.get(columns) || []);
}

function register(context) {
  createDecorationTypes();

  const update = (editor) => {
    if (editor && languages.has(editor.document.languageId)) {
      applyDecorations(editor);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(update)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('nnyjEditorStyling.inline.enabled')) return;
      createDecorationTypes();
      for (const editor of vscode.window.visibleTextEditors) update(editor);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      vscode.window.visibleTextEditors.filter(editor => editor.document === e.document).forEach(update);
    })
  );

  for (const editor of vscode.window.visibleTextEditors) {
    update(editor);
  }
}

function dispose() {
  disposeDecorationTypes();
}

module.exports = { register, dispose };
