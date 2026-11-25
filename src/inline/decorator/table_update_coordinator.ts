import { commands, env, Position, Selection, TextEditor, TextEditorSelectionChangeEvent, TextEditorSelectionChangeKind, Uri, window } from 'vscode';
import { readFileSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import type { TableBlock } from '../parser';
import type { MarkdownParseCache } from '../markdown-parse-cache';
import { cellLevels, LEVEL_COLORS } from '../parser/table_levels';
import { getEditorLineHeight } from '../mermaid/mermaid-renderer';
import { EditorInsets, InsetSpec, OpenBlocks, visualColumn } from './editor_insets';
import { resolveLinkTarget } from '../link-targets';
import { logWarn } from '../logging';

const MAX_MEASURED_TABLES = 200;

/**
 * Shows tables with wrapped cells as an html inset below the header line, Obsidian style.
 * The patched workbench hides the rows below the header while the inset shows, the header line's text is hidden, so
 * only the inset shows. A selection in the table, or a click on a cell, shows the source with the normal decorations.
 * Needs the workbench patch extension and a running workbench with the patch, else tables keep the decoration rendering.
 */
export class TableUpdateCoordinator {
  private insets = new Map<TextEditor, EditorInsets>();
  /** Heights in lines by indent and table: measured by an unpatched workbench, and of the zone for new insets. */
  private measuredLines = new Map<string, number>();
  private zoneLines = new Map<string, number>();
  private lastActive = new Map<TextEditor, Position>();
  private visibleRight = new Map<TextEditor, number>();
  private hidesRows = false;
  private readonly openBlocks = new OpenBlocks();
  private readonly hideHeader = window.createTextEditorDecorationType({ opacity: '0' });

  constructor(private readonly parseCache: MarkdownParseCache, private readonly onChange: () => void) {
    void workbenchHidesRows().then(hides => {
      this.hidesRows = hides;
      if (hides) onChange();
    });
  }

  /** Tables shown as insets for the current selections; their syntax decorations are skipped. */
  getRenderedTables(editor: TextEditor, tableBlocks: TableBlock[]): TableBlock[] {
    if (!this.hidesRows || !this.insetsFor(editor).supported) return [];
    const open = this.openBlocks.get(editor, tableBlocks);
    return tableBlocks.filter(block => block.endLine > block.startLine && !open.has(block.startLine));
  }

  /**
   * Keyboard moves over hidden table rows, a move past the whole table tells they were hidden. ArrowUp from the line
   * below a table lands on its header: moves on to the last row. ArrowDown from a header whose rows are not shown yet
   * lands below the table: moves back to the first row. A Shift selection skips the hidden rows as one line, so the
   * table stays an inset. True when it moved the cursor, the next selection event renders.
   */
  enterTable(event: TextEditorSelectionChangeEvent): boolean {
    const editor = event.textEditor;
    const previous = this.lastActive.get(editor);
    const selection = event.selections[0];
    this.lastActive.set(editor, selection.active);
    if (event.kind !== TextEditorSelectionChangeKind.Keyboard || event.selections.length !== 1 || !selection.isEmpty || !previous) return false;
    const line = selection.active.line;
    const tables = this.parseCache.get(editor.document).tableBlocks.filter(block => block.endLine > block.startLine);
    const fromBelow = tables.find(block => block.startLine === line && block.endLine + 1 === previous.line);
    const fromHeader = tables.find(block => block.startLine === previous.line && block.endLine + 1 === line);
    const targetLine = fromBelow ? fromBelow.endLine : fromHeader ? fromHeader.startLine + 1 : undefined;
    if (targetLine === undefined) return false;
    const target = new Position(targetLine, Math.min(previous.character, editor.document.lineAt(targetLine).text.length));
    editor.selection = new Selection(target, target);
    return true;
  }

  update(editor: TextEditor, rendered: TableBlock[]): void {
    for (const [other, insets] of this.insets) {
      if (other !== editor && !window.visibleTextEditors.includes(other)) {
        insets.dispose();
        this.insets.delete(other);
        this.visibleRight.delete(other);
        this.lastActive.delete(other);
      }
    }
    const lineHeight = getEditorLineHeight();
    const wanted = new Map<string, InsetSpec>();
    const visibleRight = this.visibleRight.get(editor) ?? 0;
    for (const block of rendered) {
      const header = editor.document.lineAt(block.startLine);
      const indent = visualColumn(editor, block.startLine, header.firstNonWhitespaceCharacterIndex);
      const rows = buildTableRows(block);
      const table = `${indent}|${rows}`;
      const measured = this.measuredLines.get(table);
      // Width stays out of the key: the webview follows resizes, only a height measured by an unpatched workbench
      // recreates the inset. The line stays in: VS Code moves a zone on edits above, then puts it back at its
      // creation line on the next fold or wrap change.
      wanted.set(`${block.startLine}|${measured ?? 0}|${table}`, {
        line: block.startLine,
        lines: measured ?? this.zoneLines.get(table) ?? block.rows.length + 1,
        indent,
        body: buildTableHtml(rows, indent, visibleRight),
        hiddenRows: block.endLine - block.startLine,
        onHeight: height => this.measured(table, Math.max(1, Math.ceil(height / lineHeight))),
        onZoneHeight: height => remember(this.zoneLines, table, Math.max(1, Math.ceil(height / lineHeight))),
        onClick: cell => this.reveal(editor, block, cell),
        onLink: href => openLink(href, editor.document.uri),
        onVisibleRight: right => this.visibleRight.set(editor, right),
      });
    }
    this.insetsFor(editor).sync(editor, wanted);
    editor.setDecorations(this.hideHeader, rendered.map(block => editor.document.lineAt(block.startLine).range));
  }

  clear(editor: TextEditor): void {
    this.insets.get(editor)?.dispose();
    editor.setDecorations(this.hideHeader, []);
  }

  dispose(): void {
    for (const insets of this.insets.values()) insets.dispose();
    this.insets.clear();
    this.visibleRight.clear();
    this.lastActive.clear();
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

  private measured(table: string, lines: number): void {
    if (remember(this.measuredLines, table, lines)) this.onChange();
  }

  /** Clicked cell gets the cursor and focus, the selection change then shows the source. */
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

/**
 * Running workbench hides table rows: patched by `inset resize` from vscode_workbench_patch.js, which adds this marker.
 * A file written after the extension host started is not running yet: the patch script writes it on the first start
 * of a new VS Code version, the window runs the old file until a restart.
 */
async function workbenchHidesRows(): Promise<boolean> {
  const hostStart = Date.now() - process.uptime() * 1000;
  try {
    const workbench = join(env.appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
    return (await stat(workbench)).mtimeMs < hostStart && (await readFile(workbench, 'utf8')).includes('nnyj-table-rows');
  } catch {
    return false;
  }
}

/** Sets `key` as the newest entry of a bounded cache, false when it already held `lines`. */
function remember(cache: Map<string, number>, key: string, lines: number): boolean {
  if (cache.get(key) === lines) return false;
  cache.delete(key);
  if (cache.size >= MAX_MEASURED_TABLES) cache.delete(cache.keys().next().value!);
  cache.set(key, lines);
  return true;
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
