const vscode = require('vscode');

const RE_ROW = /^\s*\|(.+)\|\s*$/;
const RE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const emoji_pattern = /\p{Emoji_Presentation}|\uFE0F|\u20E3/u;
const emoji_decorations = new Map();
const languages = new Set(['markdown', 'mdx', 'quarto']);
const numeric_heads = new WeakMap();
// Cell backgrounds from red (level 0) to green (level 4).
const level_colors = ['rgba(239,68,68,0.5)', 'rgba(249,115,22,0.5)', 'rgba(234,179,8,0.5)', 'rgba(132,204,22,0.5)', 'rgba(34,197,94,0.5)'];
const circle_levels = { '🔴': 0, '🟡': 2, '🟢': 4 };
const RE_NUMBER = /^[-+]?\d[\d,]*(\.\d+)?\s*[%a-zA-Z]*$/;
const RE_PLACEHOLDER = /^(-+|–|—)$/;

const BORDER = {
  borderWidth: '0 0 1px 0',
  borderStyle: 'solid',
  borderColor: 'rgba(128,128,128,0.3)',
};

let headerType, rowType, sepType, pipeType, level_types = [];
let inline_enabled;
let update_timer;

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
  level_types = level_colors.map(color => vscode.window.createTextEditorDecorationType({ backgroundColor: color }));
}

function disposeDecorationTypes() {
  headerType?.dispose();
  rowType?.dispose();
  sepType?.dispose();
  pipeType?.dispose();
  level_types.forEach(decoration => decoration.dispose());
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

function cells(text) {
  const pipes = [...text.matchAll(/(?<!\\)\|/g)].map(match => match.index);
  return pipes.slice(1).map((end, k) => ({ start: pipes[k] + 1, end, text: text.slice(pipes[k] + 1, end).trim() }));
}

// Circle cells take the circle's level. Numeric columns scale min..max to red..green, `↓` in the header flips it.
function cell_levels(doc, start, sepNum, end, levels, heads) {
  const rows = [];
  for (let n = sepNum + 1; n <= end; n++) rows.push(cells(doc.lineAt(n).text).map(cell => ({ ...cell, line: n })));
  cells(doc.lineAt(start).text).forEach((head, col) => {
    const column = rows.map(row => row[col]).filter(cell => cell?.text && !RE_PLACEHOLDER.test(cell.text));
    const plain = column.filter(cell => circle_levels[[...cell.text][0]] === undefined);
    const push = (cell, level) => levels[level].push(new vscode.Range(cell.line, cell.start, cell.line, cell.end));
    column.filter(cell => !plain.includes(cell)).forEach(cell => push(cell, circle_levels[[...cell.text][0]]));
    if (!plain.length || !plain.every(cell => RE_NUMBER.test(cell.text))) return;
    heads.push(new vscode.Range(start, head.start, start, head.end));
    const values = plain.map(cell => parseFloat(cell.text.replace(/,/g, '')));
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) return;
    plain.forEach((cell, k) => {
      const level = Math.round((values[k] - min) / (max - min) * 4);
      push(cell, head.text.includes('↓') ? 4 - level : level);
    });
  });
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
  const levels = level_colors.map(() => []);
  const heads = [];

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
      cell_levels(doc, start, sepNum, end, levels, heads);

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

  return { headers, rows, seps, pipes, emoji, levels, heads };
}

function applyDecorations(editor) {
  const { headers, rows, seps, pipes, emoji, levels, heads } = findTables(editor.document);
  numeric_heads.set(editor.document, heads);
  editor.setDecorations(headerType, headers);
  editor.setDecorations(rowType, rows);
  editor.setDecorations(sepType, inline_enabled ? [] : seps);
  editor.setDecorations(pipeType, inline_enabled ? [] : pipes);
  level_types.forEach((decoration, level) => editor.setDecorations(decoration, levels[level]));
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

const FLIP_COMMAND = 'nnyjTables.flipScale';

// Adds or removes ` ↓`, taking or giving back trailing padding so the pipes stay put.
function flip_header(cell) {
  if (cell.includes(' ↓')) return cell.replace(' ↓', '') + '  ';
  const content = cell.trimEnd();
  const padding = cell.slice(content.length);
  return content + ' ↓' + padding.slice(Math.min(2, Math.max(0, padding.length - 1)));
}

function scale_hover(doc, position) {
  const head = numeric_heads.get(doc)?.find(range => range.contains(position));
  if (!head) return;
  const state = doc.getText(head).includes('↓') ? 'lower' : 'higher';
  const args = encodeURIComponent(JSON.stringify([head.start.line, head.start.character, head.end.character]));
  const markdown = new vscode.MarkdownString(`Green = ${state} value. [Flip ↕](command:${FLIP_COMMAND}?${args})`);
  markdown.isTrusted = { enabledCommands: [FLIP_COMMAND] };
  return new vscode.Hover(markdown, head);
}

// The hover link only opens in the active editor, so no document uri is passed.
function flip_scale(line, start, end) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const range = new vscode.Range(line, start, line, end);
  return editor.edit(builder => builder.replace(range, flip_header(editor.document.getText(range))));
}

function register(context) {
  createDecorationTypes();

  const update = (editor) => {
    if (editor && languages.has(editor.document.languageId)) {
      applyDecorations(editor);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(update)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('nnyjEditorStyling.inline.enabled')) return;
      createDecorationTypes();
      for (const editor of vscode.window.visibleTextEditors) update(editor);
    })
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider([...languages].map(language => ({ language })), { provideHover: scale_hover }),
    vscode.commands.registerCommand(FLIP_COMMAND, flip_scale),
    vscode.workspace.onDidChangeTextDocument(e => {
      clearTimeout(update_timer);
      update_timer = setTimeout(() => {
        vscode.window.visibleTextEditors.filter(editor => editor.document === e.document).forEach(update);
      }, 100);
    })
  );

  for (const editor of vscode.window.visibleTextEditors) {
    update(editor);
  }
}

function dispose() {
  clearTimeout(update_timer);
  disposeDecorationTypes();
}

module.exports = { register, dispose, flip_header };
