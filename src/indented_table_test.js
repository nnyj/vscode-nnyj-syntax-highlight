import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { Range, Position } from './inline/test/__mocks__/vscode';

function load_tables(text, language = 'markdown') {
  let inline_enabled = true;
  const listeners = {};
  const ranges = new Map();
  const document = {
    languageId: language,
    text,
    get lineCount() { return this.text.split('\n').length; },
    lineAt(line) { return { text: this.text.split('\n')[line] }; },
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
    module, require: () => vscode,
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
    set_inline(value) {
      inline_enabled = value;
      listeners.config({ affectsConfiguration: () => true });
    },
    dispose: () => module.exports.dispose(),
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

  it('refreshes background documents and clears ranges after a whole-document replacement', () => {
    const tables = load_tables('| A |\n| --- |\n| 🔴 |');
    tables.document.text = '| A |\n| --- |\n| 🟢🟢 |';
    tables.listeners.document({ document: tables.document });
    expect(tables.emoji()).toEqual([{ text: '🟢🟢', columns: 4, line: 2 }]);
    tables.document.text = 'plain 中 é';
    tables.listeners.document({ document: tables.document });
    expect(tables.emoji()).toEqual([]);
  });
});
