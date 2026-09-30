import * as vscode from 'vscode';
import { shouldSkipInDiffView } from './diff-context';
import { MarkdownParseCache } from './markdown-parse-cache';
import { mapNormalizedToOriginal } from './position-mapping';

const COPIED_MS = 1500;
let copied: { uri: string; line: number } | undefined;
let copied_timer: ReturnType<typeof setTimeout> | undefined;

/** Fence line whose button shows the copied state. */
export function isCopiedFence(uri: string, line: number): boolean {
  return copied?.uri === uri && copied.line === line;
}

/**
 * Copies a code block when the `⎘` after its opening fence line is clicked.
 * Clicks on injected text land at line end, so any click right of the fence text also copies.
 * `refresh` re-renders decorations so the button flips to its copied state and back.
 */
export function registerCodeBlockCopy(parseCache: MarkdownParseCache, refresh: () => void): vscode.Disposable {
  const listener = vscode.window.onDidChangeTextEditorSelection(event => {
    const { textEditor: { document }, selections } = event;
    if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse || selections.length !== 1 || !selections[0].isEmpty) return;
    const position = selections[0].active;
    if (document.languageId !== 'markdown' || shouldSkipInDiffView(document)) return;
    if (position.character !== document.lineAt(position.line).text.length) return;
    const { decorations, text } = parseCache.get(document);
    for (const decoration of decorations) {
      if (decoration.type !== 'codeBlock') continue;
      const start_line = document.positionAt(mapNormalizedToOriginal(decoration.startPos, text)).line;
      if (start_line !== position.line) continue;
      const end_line = document.positionAt(mapNormalizedToOriginal(decoration.endPos, text)).line;
      const lines: string[] = [];
      for (let line = start_line; line <= end_line; line++) lines.push(document.lineAt(line).text);
      void vscode.env.clipboard.writeText(codeBlockContent(lines));
      copied = { uri: document.uri.toString(), line: start_line };
      clearTimeout(copied_timer);
      copied_timer = setTimeout(() => {
        copied = undefined;
        refresh();
      }, COPIED_MS);
      refresh();
      return;
    }
  });
  return { dispose: () => {
    clearTimeout(copied_timer);
    listener.dispose();
  } };
}

// Strips the fence indent from each content line, like CommonMark does for fenced code.
export function codeBlockContent(lines: string[]): string {
  const indent = /^[ \t]*/.exec(lines[0])![0].length;
  return lines.slice(1, -1)
    .map(line => line.slice(Math.min(indent, /^[ \t]*/.exec(line)![0].length)))
    .join('\n');
}
