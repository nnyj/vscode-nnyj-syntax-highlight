import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../parser';
import { mapNormalizedToOriginal } from '../position-mapping';
import { filterDecorationsForEditor } from './visibility-model';
import { TextDocument, TextEditor, Selection, Position, Uri, Range } from '../test/__mocks__/vscode';

async function filter_link(text: string, active_line: number) {
  const parser = await MarkdownParser.create();
  const parsed = parser.extractDecorationsWithScopes(text);
  const document = new TextDocument(Uri.file('test.md'), 'markdown', 1, text);
  const cursor = new Position(active_line, 0);
  const editor = new TextEditor(document, [new Selection(cursor, cursor)]);
  const range_factory = (start: number, end: number) => new Range(
    document.positionAt(mapNormalizedToOriginal(start, text)),
    document.positionAt(mapNormalizedToOriginal(end, text)),
  );
  const scopes = parsed.scopes.map(scope => ({ ...scope, range: range_factory(scope.startPos, scope.endPos) }));
  const filtered = filterDecorationsForEditor(editor as any, parsed.decorations, scopes, text, range_factory);
  const hidden = filtered.get('hide') ?? [];
  return { hidden, document, projected: hidden.filter(item => 'renderOptions' in item) as any[] };
}

describe('link punctuation', () => {
  it.each(['\n', '\r\n'])('keeps punctuation at label end without changing source (%j)', async newline => {
    const text = `Above${newline}[Read this](https://example.com/long/path).!?${newline}Cursor`;
    const { hidden, document, projected } = await filter_link(text, 2);
    expect(projected).toHaveLength(1);
    expect(projected[0].renderOptions.before.contentText).toBe('.!?');
    expect(hidden.every(item => 'range' in item)).toBe(true);
    expect(document.getText(projected[0].range)).toBe(']');
    expect(hidden.some(item => document.getText('range' in item ? item.range : item) === '.!?')).toBe(true);
    expect(document.getText()).toBe(text);
  });

  it('restores punctuation while editing the link line', async () => {
    const { hidden, projected, document } = await filter_link('[Read](https://example.com).\nCursor', 0);
    expect(projected).toHaveLength(0);
    expect(hidden.some(item => document.getText('range' in item ? item.range : item) === '.')).toBe(false);
  });

  it.each(['https://example.com.', '<https://example.com>.', '[Read](https://example.com) next'])
    ('leaves bare links, autolinks, and following words unchanged: %s', async text => {
      expect((await filter_link(text + '\nCursor', 1)).projected).toHaveLength(0);
    });

  it('leaves punctuation in rendered table cells', async () => {
    const text = '| Link |\n| --- |\n| [Read](https://example.com). |\n\nCursor';
    expect((await filter_link(text, 4)).projected.filter(item => item.renderOptions.before?.contentText === '.')).toHaveLength(0);
  });
});
