import { commands, FoldingRange, FoldingRangeProvider, Position, Selection, TextDocument, TextEditor, Uri, window, workspace } from 'vscode';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { TableBlock } from '../parser';
import type { MarkdownParseCache } from '../markdown-parse-cache';
import { cellLevels, LEVEL_COLORS } from '../parser/table_levels';
import { getEditorLineHeight } from '../mermaid/mermaid-renderer';
import { EditorInsets, InsetSpec, visualColumn } from './editor_insets';
import { resolveLinkTarget } from '../link-targets';
import { logWarn } from '../logging';

const MAX_MEASURED_TABLES = 200;

/**
 * Folding ranges for tables, header row to last row, so the coordinator can fold the rows under its inset.
 * Remembers the ranges last given to VS Code: folding a line VS Code has no table range for folds the enclosing
 * section instead.
 */
export class TableFoldingProvider implements FoldingRangeProvider {
  private provided = new Map<string, Set<string>>();

  constructor(private readonly parseCache: MarkdownParseCache, private readonly onProvided: () => void) {}

  provideFoldingRanges(document: TextDocument): FoldingRange[] {
    const blocks = this.parseCache.get(document).tableBlocks.filter(block => block.endLine > block.startLine);
    const ranges = new Set(blocks.map(rangeKey));
    const previous = this.provided.get(document.uri.toString());
    this.provided.set(document.uri.toString(), ranges);
    if (!previous || [...ranges].some(range => !previous.has(range))) {
      // VS Code applies the ranges after this returns, so re-render on the next tick
      setTimeout(this.onProvided, 0);
    }
    return blocks.map(block => new FoldingRange(block.startLine, block.endLine));
  }

  isFoldable(document: TextDocument, block: TableBlock): boolean {
    return !!this.provided.get(document.uri.toString())?.has(rangeKey(block));
  }
}

/**
 * Shows tables with wrapped cells as an html inset below the header line, Obsidian style.
 * Rows below the header are folded and the header line's text is hidden, so only the inset shows.
 * Cursor in the table, or a click on a cell, unfolds the table for editing with the normal decorations.
 * Needs the inset helper and provider-based folding, else tables keep the decoration rendering.
 */
export class TableUpdateCoordinator {
  readonly foldingProvider: TableFoldingProvider;
  private insets = new Map<TextEditor, EditorInsets>();
  private folds = new Map<TextEditor, { key: string; folded: number[] }>();
  private measuredLines = new Map<string, number>();
  private visibleRight = new Map<TextEditor, number>();
  private readonly hideHeader = window.createTextEditorDecorationType({ opacity: '0' });

  constructor(parseCache: MarkdownParseCache, private readonly onChange: () => void) {
    this.foldingProvider = new TableFoldingProvider(parseCache, onChange);
  }

  /** Tables shown as insets for the current selections; their syntax decorations are skipped. */
  getRenderedTables(editor: TextEditor, tableBlocks: TableBlock[]): TableBlock[] {
    const folding = workspace.getConfiguration('editor', editor.document);
    if (!this.insetsFor(editor).supported || !folding.get<boolean>('folding', true) ||
      folding.get<string>('foldingStrategy', 'auto') !== 'auto') return [];
    return tableBlocks.filter(block => block.endLine > block.startLine && !editor.selections.some(selection =>
      selection.start.line <= block.endLine && selection.end.line >= block.startLine));
  }

  update(editor: TextEditor, rendered: TableBlock[], tableBlocks: TableBlock[]): void {
    for (const [other, insets] of this.insets) {
      if (other !== editor && !window.visibleTextEditors.includes(other)) {
        insets.dispose();
        this.insets.delete(other);
        this.folds.delete(other);
        this.visibleRight.delete(other);
      }
    }
    const lineHeight = getEditorLineHeight();
    const wanted = new Map<string, InsetSpec>();
    const visibleRight = this.visibleRight.get(editor) ?? 0;
    for (const block of rendered) {
      const header = editor.document.lineAt(block.startLine);
      const indent = visualColumn(header.text, header.firstNonWhitespaceCharacterIndex);
      const table = buildTableRows(block);
      const lines = this.measuredLines.get(table) ?? block.rows.length + 1;
      // Width stays out of the key: the webview follows resizes itself, only a new height recreates the inset
      wanted.set(`${block.startLine}|${indent}|${lines}|${table}`, {
        line: block.startLine,
        lines,
        indent,
        body: buildTableHtml(table, indent, visibleRight),
        onHeight: height => this.measured(table, Math.max(1, Math.ceil(height / lineHeight))),
        onClick: cell => this.reveal(editor, block, cell),
        onLink: href => openLink(href, editor.document.uri),
        onVisibleRight: right => this.visibleRight.set(editor, right),
      });
    }
    this.insetsFor(editor).sync(editor, wanted);
    editor.setDecorations(this.hideHeader, rendered.map(block => editor.document.lineAt(block.startLine).range));
    this.syncFolds(editor, rendered.filter(block => this.foldingProvider.isFoldable(editor.document, block)),
      tableBlocks.filter(block => !rendered.includes(block)));
  }

  clear(editor: TextEditor): void {
    this.insets.get(editor)?.dispose();
    editor.setDecorations(this.hideHeader, []);
    const folded = this.folds.get(editor)?.folded ?? [];
    if (folded.length > 0 && editor === window.activeTextEditor) {
      void commands.executeCommand('editor.unfold', { levels: 1, selectionLines: folded });
    }
    this.folds.delete(editor);
  }

  dispose(): void {
    for (const insets of this.insets.values()) insets.dispose();
    this.insets.clear();
    this.hideHeader.dispose();
  }

  private insetsFor(editor: TextEditor): EditorInsets {
    let insets = this.insets.get(editor);
    if (!insets) {
      insets = new EditorInsets(this.onChange);
      this.insets.set(editor, insets);
    }
    return insets;
  }

  /** Fold and unfold only on change: editor.fold with empty selectionLines folds the whole file. */
  private syncFolds(editor: TextEditor, fold: TableBlock[], unfold: TableBlock[]): void {
    if (editor !== window.activeTextEditor) return;
    const foldLines = fold.map(block => block.startLine);
    const unfoldLines = unfold.map(block => block.startLine);
    const key = `${foldLines.join(',')}|${unfoldLines.join(',')}`;
    if (this.folds.get(editor)?.key === key) return;
    this.folds.set(editor, { key, folded: foldLines });
    if (unfoldLines.length > 0) void commands.executeCommand('editor.unfold', { levels: 1, selectionLines: unfoldLines });
    if (foldLines.length > 0) void commands.executeCommand('editor.fold', { levels: 1, selectionLines: foldLines });
  }

  private measured(body: string, lines: number): void {
    if (this.measuredLines.get(body) === lines) return;
    this.measuredLines.delete(body);
    if (this.measuredLines.size >= MAX_MEASURED_TABLES) this.measuredLines.delete(this.measuredLines.keys().next().value!);
    this.measuredLines.set(body, lines);
    this.onChange();
  }

  /** Clicked cell gets the cursor and focus, the selection change then unfolds the table. */
  private reveal(editor: TextEditor, block: TableBlock, cell: string): void {
    const [row, column] = cell.split(',').map(Number);
    const target = block.rows[row]?.[column];
    if (!target) return;
    const position = new Position(target.line, target.character);
    void window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, selection: new Selection(position, position) });
  }
}

function openLink(href: string, documentUri: Uri): void {
  const target = resolveLinkTarget(href, documentUri);
  if (!target) return;
  const opened = target.kind === 'command'
    ? commands.executeCommand(target.command, ...target.args)
    : commands.executeCommand('vscode.open', target.uri);
  opened.then(undefined, error => logWarn('Failed to open link', error));
}

function rangeKey(block: TableBlock): string {
  return `${block.startLine}:${block.endLine}`;
}

function buildTableRows(block: TableBlock): string {
  const [header, ...body] = block.rows;
  const { levels } = cellLevels(header.map(cell => cell.text), body.map(row => row.map(cell => cell.text)));
  return block.rows.map((cells, row) => {
    const tag = row === 0 ? 'th' : 'td';
    return '<tr>' + cells.map((cell, column) => {
      const align = block.align[column];
      const level = row > 0 ? levels[row - 1][column] : undefined;
      const style = (align ? `text-align: ${align};` : '') +
        (level !== undefined ? `background: ${LEVEL_COLORS[level]};` : '');
      return `<${tag} data-cell="${row},${column}"${style ? ` style="${style}"` : ''}>${cell.html}</${tag}>`;
    }).join('') + '</tr>';
  }).join('');
}

/** visibleRight 0 = not measured yet, the table then spans the zone until the webview measures it. */
function buildTableHtml(rows: string, indent: number, visibleRight: number): string {
  const maxWidth = visibleRight > 0 ? `calc(${visibleRight}px - ${indent}ch - 16px)` : '100%';
  // Markdown preview colors mirror the editor's textMateRules, dist/ sits beside preview/
  previewCss ??= readFileSync(join(__dirname, '..', 'preview', 'preview.css'), 'utf8');
  return `<style>${previewCss}${TABLE_CSS}</style>` +
    `<table data-visible-right="${visibleRight}" style="max-width: ${maxWidth};">${rows}</table>`;
}

let previewCss: string | undefined;

// UI font fits more text per row, code keeps the editor font
const TABLE_CSS = `
  table { border-collapse: collapse; margin: 2px 0; color: var(--vscode-editor-foreground); line-height: 1.4;
    font-family: var(--vscode-font-family); }
  th, td { border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.35)); padding: 2px 8px;
    vertical-align: top; text-align: left; overflow-wrap: break-word; cursor: text; }
  th { font-weight: bold; background: rgba(128,128,128,0.12); }
  tr:nth-child(odd) td { background: rgba(128,128,128,0.04); }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); border-radius: 3px; padding: 0 3px; }
  a { color: var(--vscode-textLink-foreground); }
`;
