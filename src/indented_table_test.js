import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { Range, Position } from './inline/test/__mocks__/vscode';

vi.useFakeTimers();

function load_tables(text, language = 'markdown') {
  let inline_enabled = true;
  const listeners = {};
  const ranges = new Map();
  const document = {
    languageId: language,
    text,
    get lineCount() { return this.text.split('\n').length; },
    lineAt(line) { return { text: this.text.split('\n')[line] }; },
    getText(range) { return this.lineAt(range.start.line).text.slice(range.start.character, range.end.character); },
    uri: { toString: () => 'file:///a.md' },
  };
  const editor = { document, setDecorations: (type, items) => ranges.set(type, items) };
  const listen = name => callback => {
    listeners[name] = callback;
    return { dispose() {} };
  };
  const vscode = {
    Range: class extends Range {
      constructor(start_line, start_column, end_line, end_column) {
        super(new Position(start_line, start_column), new Position(end_line, end_column));
      }
    },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    MarkdownString: class { constructor(value) { this.value = value; } },
    Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
    languages: { registerHoverProvider: (selector, provider) => (listeners.hover = provider, { dispose() {} }) },
    commands: { registerCommand: () => ({ dispose() {} }) },
    window: {
      visibleTextEditors: [editor],
      createTextEditorDecorationType: options => ({ options, dispose() { ranges.delete(this); } }),
      onDidChangeActiveTextEditor: listen('active'),
      onDidChangeVisibleTextEditors: listen('visible'),
    },
    workspace: {
      getConfiguration: () => ({ get: () => inline_enabled }),
      onDidChangeConfiguration: listen('config'),
      onDidChangeTextDocument: listen('document'),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('./indented_table.js', import.meta.url), 'utf8'), {
    module, require: () => vscode, setTimeout, clearTimeout,
  });
  module.exports.register({ subscriptions: [] });
  return {
    document, editor, listeners,
    emoji() {
      return [...ranges].flatMap(([type, items]) => {
        const width = /width: (\d+)ch/.exec(type.options.textDecoration || '');
        return width ? items.map(range => ({
          text: document.lineAt(range.start.line).text.slice(range.start.character, range.end.character),
          columns: Number(width[1]), line: range.start.line,
        })) : [];
      });
    },
    styled(option) {
      return [...ranges].flatMap(([type, items]) => type.options[option] ? items.map(range => [
        type.options[option],
        document.lineAt(range.start.line).text.slice(range.start.character, range.end.character),
      ]) : []);
    },
    set_inline(value) {
      inline_enabled = value;
      listeners.config({ affectsConfiguration: () => true });
    },
    dispose: () => module.exports.dispose(),
    hover: (line, character) => listeners.hover.provideHover(document, new Position(line, character)),
    flip_header: module.exports.flip_header,
  };
}

describe('table emoji display widths', () => {
  it('groups adjacent emoji and preserves joined, flag and variation graphemes', () => {
    const tables = load_tables('| Emoji |\n| --- |\n| a🔴🟢b👩‍💻 🇸🇬 🖼️ |');
    expect(tables.emoji().map(({ text, columns }) => [text, columns])).toEqual([
      ['🔴🟢', 4], ['👩‍💻', 2], ['🇸🇬', 2], ['🖼️', 2],
    ]);
    tables.dispose();
    expect(tables.emoji()).toEqual([]);
  });

  it('works without Tweaks and keeps widths while the inline renderer is toggled', () => {
    const tables = load_tables('| 🔴 |\n| --- |');
    const expected = tables.emoji();
    expect(expected).toHaveLength(1);
    tables.set_inline(false);
    expect(tables.emoji()).toEqual(expected);
    tables.set_inline(true);
    expect(tables.emoji()).toEqual(expected);
  });

  it.each(['markdown', 'mdx', 'quarto'])('supports %s tables with optional outer pipes', language => {
    const tables = load_tables('A | B\n--- | ---\n🔴 | 🟢', language);
    expect(tables.emoji().map(item => item.text)).toEqual(['🔴', '🟢']);
  });

  it('skips fenced examples and ordinary emoji outside tables', () => {
    const table = '| 🔴 |\n| --- |';
    const tables = load_tables('🟢\n````md\n' + table + '\n```\n' + table + '\n````\n\n' + table);
    expect(tables.emoji()).toEqual([{ text: '🔴', columns: 2, line: 9 }]);
  });

  it('debounces updates, refreshes background documents and clears ranges after a whole-document replacement', () => {
    const tables = load_tables('| A |\n| --- |\n| 🔴 |');
    tables.document.text = '| A |\n| --- |\n| 🟢🟢 |';
    tables.listeners.document({ document: tables.document });
    expect(tables.emoji()).toEqual([{ text: '🟢', columns: 2, line: 2 }]);
    vi.runAllTimers();
    expect(tables.emoji()).toEqual([{ text: '🟢🟢', columns: 4, line: 2 }]);
    tables.document.text = 'plain 中 é';
    tables.listeners.document({ document: tables.document });
    vi.runAllTimers();
    expect(tables.emoji()).toEqual([]);
  });
});

describe('table cell levels', () => {
  const red = 'rgba(239,68,68,0.5)';
  const yellow = 'rgba(234,179,8,0.5)';
  const green = 'rgba(34,197,94,0.5)';

  it('colors cells starting with a status circle', () => {
    const tables = load_tables('| A | B |\n| --- | --- |\n| 🟢 12 | x 🔴 |\n|🔴| 🟡 a |');
    expect(tables.styled('backgroundColor')).toEqual([[red, '🔴'], [yellow, ' 🟡 a '], [green, ' 🟢 12 ']]);
  });

  it('scales numeric columns red to green, flipped by a down arrow header', () => {
    const tables = load_tables('| Score | Latency ↓ | Name |\n| --- | --- | --- |\n| 10 | 1,000 ms | a |\n| 30 | 500 ms | b |\n| 20 | 🟡 x | c |');
    expect(tables.styled('backgroundColor')).toEqual([
      [red, ' 10 '], [red, ' 1,000 ms '], [yellow, ' 20 '], [yellow, ' 🟡 x '], [green, ' 30 '], [green, ' 500 ms '],
    ]);
  });

  it('skips empty and dash cells in numeric columns', () => {
    const tables = load_tables('| Score | Rival |\n| --- | --- |\n| 10 | - |\n| - | x |\n|  | - |\n| 30 | y |');
    expect(tables.styled('backgroundColor')).toEqual([[red, ' 10 '], [green, ' 30 ']]);
  });

  it('offers a scale flip on numeric headers only', () => {
    const tables = load_tables('| Score | Name |\n| ----- | ---- |\n| 10    | a    |\n| 30    | b    |');
    expect(tables.hover(0, 3).contents.value).toMatch(/^Green = higher value\. \[Flip ↕\]\(command:nnyjTables\.flipScale\?/);
    expect(tables.hover(0, 10)).toBeUndefined();
    expect(tables.hover(2, 3)).toBeUndefined();
  });

  it('adds and removes the down arrow while keeping the cell width', () => {
    expect(tables_flip(' Price    ')).toBe(' Price ↓  ');
    expect(tables_flip(' Price ↓  ')).toBe(' Price    ');
    expect(tables_flip(' Price ')).toBe(' Price ↓ ');
  });
});

function tables_flip(cell) {
  return load_tables('').flip_header(cell);
}
