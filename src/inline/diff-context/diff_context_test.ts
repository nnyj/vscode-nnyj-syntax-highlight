import { TabInputTextDiff, TextDocument, TextEditor, Uri, window, workspace } from '../test/__mocks__/vscode';
import { isDiffLikeUri, is_diff_editor, shouldSkipInDiffView } from '../diff-context';

describe('diff detection', () => {
  beforeEach(() => {
    (window as any).tabGroups = { all: [] };
    (window as any).visibleTextEditors = [];
    workspace.getConfiguration = (() => ({ get: () => false })) as any;
  });

  it.each(['git', 'vscode-merge', 'vscode-diff'])('recognizes %s documents', scheme => {
    expect(isDiffLikeUri(Uri.parse(`${scheme}:/note.md`) as any)).toBe(true);
  });

  it.each(['diff.md', 'merge-result.md', 'prose_compare_20260922/samples.txt'])('keeps ordinary %s decorated', name => {
    const document = new TextDocument(Uri.file(`/Temp/${name}`), 'markdown', 1, '# Note');
    expect(shouldSkipInDiffView(document as any)).toBe(false);
  });

  it('detects the modified side from its editor group without affecting another group', () => {
    const original = Uri.parse('git:/note.md');
    const modified = Uri.file('/note.md');
    const document = new TextDocument(modified, 'markdown', 1, '# Note');
    const diff_editor = Object.assign(new TextEditor(document, []), { viewColumn: 1 });
    const normal_editor = Object.assign(new TextEditor(document, []), { viewColumn: 2 });
    (window as any).tabGroups = { all: [
      { viewColumn: 1, activeTab: { input: new TabInputTextDiff(original, modified) } },
      { viewColumn: 2, activeTab: { input: { uri: modified } } },
    ] };
    expect(is_diff_editor(diff_editor as any)).toBe(true);
    expect(is_diff_editor(normal_editor as any)).toBe(false);
  });

  it('honors decoration opt-in for real diffs', () => {
    const document = new TextDocument(Uri.parse('git:/note.md'), 'markdown', 1, '# Note');
    expect(shouldSkipInDiffView(document as any)).toBe(true);
    workspace.getConfiguration = (() => ({ get: () => true })) as any;
    expect(shouldSkipInDiffView(document as any)).toBe(false);
  });
});
