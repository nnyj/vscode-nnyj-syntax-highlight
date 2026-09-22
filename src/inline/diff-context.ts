import { TabInputTextDiff, window, type TextDocument, type TextEditor, type Uri } from 'vscode';
import { config } from './config';

const DIFF_SCHEMES = new Set(['git', 'vscode-merge', 'vscode-diff']);

export function isDiffLikeUri(uri: Uri): boolean {
  return DIFF_SCHEMES.has(uri.scheme);
}

export function is_diff_editor(editor: TextEditor): boolean {
  if (isDiffLikeUri(editor.document.uri)) return true;
  const group = window.tabGroups?.all.find(group => group.viewColumn === editor.viewColumn);
  const input = group?.activeTab?.input;
  if (!(input instanceof TabInputTextDiff)) return false;
  const uri = editor.document.uri.toString();
  return input.original.toString() === uri || input.modified.toString() === uri;
}

export function shouldSkipInDiffView(document: TextDocument): boolean {
  if (config.diffView.applyDecorations()) return false;
  return isDiffLikeUri(document.uri) || window.visibleTextEditors.some(editor =>
    editor.document === document && is_diff_editor(editor));
}
