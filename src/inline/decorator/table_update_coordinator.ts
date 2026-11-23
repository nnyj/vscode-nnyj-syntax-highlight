import { commands, FoldingRange, FoldingRangeProvider, env, Position, Selection, TextDocument, TextDocumentChangeEvent, TextDocumentContentChangeEvent, TextEditor, TextEditorRevealType, TextEditorSelectionChangeEvent, TextEditorSelectionChangeKind, Uri, window, workspace } from 'vscode';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { TableBlock } from '../parser';
import type { MarkdownParseCache } from '../markdown-parse-cache';
import { cellLevels, LEVEL_COLORS } from '../parser/table_levels';
import { getEditorLineHeight } from '../mermaid/mermaid-renderer';
import { EditorInsets, InsetSpec, OpenBlocks, visualColumn } from './editor_insets';
import { resolveLinkTarget } from '../link-targets';
import { logWarn } from '../logging';

const MAX_MEASURED_TABLES = 200;
/** Covers VS Code's own unfold of a cursor in folded rows, which runs about 200ms after the move. */
const REVEAL_WINDOW_MS = 600;
const FOLD_RETRY_MS = 500;

/**
 * Folding ranges for tables, header row to last row, so the coordinator can fold the rows under its inset.
 * Remembers the ranges last given to VS Code: folding a line VS Code has no table range for folds the enclosing
 * section instead.
 */
export class TableFoldingProvider implements FoldingRangeProvider {
  private provided = new Map<string, Set<string>>();

  /** onProvided gets whether the ranges changed. */
  constructor(private readonly parseCache: MarkdownParseCache, private readonly onProvided: (changed: boolean) => void) {}

  provideFoldingRanges(document: TextDocument): FoldingRange[] {
    const blocks = this.parseCache.get(document).tableBlocks.filter(block => block.endLine > block.startLine);
    const ranges = new Set(blocks.map(rangeKey));
    const previous = this.provided.get(document.uri.toString());
    this.provided.set(document.uri.toString(), ranges);
    const changed = !previous || [...ranges].some(range => !previous.has(range));
    // VS Code applies the ranges after this returns, so re-render on the next tick
    setTimeout(() => this.onProvided(changed), 0);
    return blocks.map(block => new FoldingRange(block.startLine, block.endLine));
  }

  /** False until VS Code asks for the ranges, which it never does while another provider is the default. */
  hasRanges(document: TextDocument): boolean {
    return this.provided.has(document.uri.toString());
  }

  isFoldable(document: TextDocument, block: TableBlock): boolean {
    return !!this.provided.get(document.uri.toString())?.has(rangeKey(block));
  }

  /** Start lines of the table ranges VS Code has, current after line shifts unlike lines stored at fold time. */
  foldableLines(document: TextDocument): number[] {
    return [...this.provided.get(document.uri.toString()) ?? []].map(range => Number(range.split(':')[0]));
  }
}

/**
 * Shows tables with wrapped cells as an html inset below the header line, Obsidian style.
 * Rows below the header are folded and the header line's text is hidden, so only the inset shows.
 * An empty cursor in the table, or a click on a cell, unfolds the table for editing with the normal decorations.
 * Needs the inset helper and provider-based folding, else tables keep the decoration rendering.
 */
export class TableUpdateCoordinator {
  readonly foldingProvider: TableFoldingProvider;
  private insets = new Map<TextEditor, EditorInsets>();
  /** blocks: rendered tables to fold, open: start lines of tables shown as source. */
  private folded = new Map<TextEditor, { version: number; blocks: TableBlock[]; open: number[]; unfoldKey: string }>();
  /** Heights in lines by indent and table: measured by an unpatched workbench, and of the zone for new insets. */
  private measuredLines = new Map<string, number>();
  private zoneLines = new Map<string, number>();
  private lastActive = new Map<TextEditor, Position>();
  private visibleRight = new Map<TextEditor, number>();
  private shownRows = new Map<TextEditor, string>();
  private revealUntil = new Map<TextEditor, number>();
  /** Start lines of the tables last folded, and of broken tables whose rows may still be folded. */
  private foldStarts = new Map<TextEditor, number[]>();
  /** Start lines of tables shown as source after their fold missed twice, until the editor state changes. */
  private missedFolds = new Map<TextEditor, { state: string; lines: number[] }>();
  private readonly openBlocks = new OpenBlocks();
  private readonly hideHeader = window.createTextEditorDecorationType({ opacity: '0' });

  constructor(private readonly parseCache: MarkdownParseCache, private readonly onChange: () => void) {
    // A new folding model, e.g. after editor.folding is turned back on, asks again: retry missed folds
    this.foldingProvider = new TableFoldingProvider(parseCache, changed => {
      if (!changed && this.missedFolds.size === 0) return;
      this.missedFolds.clear();
      onChange();
    });
  }

  /** Tables shown as insets for the current selections; their syntax decorations are skipped. */
  getRenderedTables(editor: TextEditor, tableBlocks: TableBlock[]): TableBlock[] {
    const folding = workspace.getConfiguration('editor', editor.document);
    if (!this.insetsFor(editor).supported || !folding.get<boolean>('folding', true) ||
      folding.get<string>('foldingStrategy', 'auto') !== 'auto' || !this.foldingProvider.hasRanges(editor.document)) return [];
    const shown = this.shownRowTables(editor, tableBlocks);
    this.shownRows.set(editor, shown.map(rangeKey).join(','));
    const missed = this.missedFolds.get(editor);
    if (missed && missed.state !== editorState(editor)) this.missedFolds.delete(editor);
    const source = this.missedFolds.get(editor)?.lines ?? [];
    const open = this.openBlocks.get(editor, tableBlocks);
    return tableBlocks.filter(block => block.endLine > block.startLine && !shown.includes(block) && !source.includes(block.startLine) &&
      !open.has(block.startLine));
  }

  /**
   * Keyboard moves that skip folded table rows. ArrowUp from the line below a rendered table lands on its header,
   * where the fold starts: moves on to the last row. ArrowDown from a header whose rows are not unfolded yet lands
   * below the table: moves back to the first row. A Shift selection skips the folded rows as one line, so the table
   * stays folded. True when it moved the cursor, the next selection event renders.
   */
  enterTable(event: TextEditorSelectionChangeEvent): boolean {
    const editor = event.textEditor;
    const previous = this.lastActive.get(editor);
    const selection = event.selections[0];
    this.lastActive.set(editor, selection.active);
    if (event.kind !== TextEditorSelectionChangeKind.Keyboard || event.selections.length !== 1 || !selection.isEmpty || !previous) return false;
    const line = selection.active.line;
    const folded = this.folded.get(editor);
    const fromBelow = folded?.version === editor.document.version
      ? folded.blocks.find(block => block.startLine === line && block.endLine + 1 === previous.line)
      : undefined;
    const fromHeader = this.parseCache.get(editor.document).tableBlocks
      .find(block => block.endLine > block.startLine && block.startLine === previous.line && block.endLine + 1 === line);
    const targetLine = fromBelow ? fromBelow.endLine : fromHeader ? fromHeader.startLine + 1 : undefined;
    if (targetLine === undefined) return false;
    const target = new Position(targetLine, Math.min(previous.character, editor.document.lineAt(targetLine).text.length));
    editor.selection = new Selection(target, target);
    return true;
  }

  /** A background editor's visible ranges changed which tables show their rows, so it needs a redraw. */
  rowsShownChanged(editor: TextEditor): boolean {
    const previous = this.shownRows.get(editor);
    if (previous === undefined) return false;
    return previous !== this.shownRowTables(editor, this.parseCache.get(editor.document).tableBlocks).map(rangeKey).join(',');
  }

  /**
   * Tables in a background editor whose first row shows, kept as source until the editor is active again.
   * An external write over a table unfolds its rows, and editor.fold only reaches the active editor.
   */
  private shownRowTables(editor: TextEditor, tableBlocks: TableBlock[]): TableBlock[] {
    if (editor === window.activeTextEditor) return [];
    return tableBlocks.filter(block => isLineShown(editor, block.startLine + 1));
  }

  update(editor: TextEditor, rendered: TableBlock[], tableBlocks: TableBlock[]): void {
    // Removing the zone and unfolding the rows of an entered table can scroll the cursor away, e.g. Ctrl+G into
    // a table whose header is above the viewport
    const previous = this.folded.get(editor);
    const entered = previous?.version === editor.document.version &&
      previous.blocks.some(block => !rendered.some(other => other.startLine === block.startLine));
    if (entered && editor === window.activeTextEditor) this.revealUntil.set(editor, Date.now() + REVEAL_WINDOW_MS);
    for (const [other, insets] of this.insets) {
      if (other !== editor && !window.visibleTextEditors.includes(other)) {
        insets.dispose();
        this.insets.delete(other);
        this.folded.delete(other);
        this.visibleRight.delete(other);
        this.shownRows.delete(other);
        this.foldStarts.delete(other);
        this.missedFolds.delete(other);
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
      // A zone created above the viewport scrolls the text by its height minus the folded rows, keep that near 0
      const zoneLines = isLineShown(editor, block.startLine) ? this.zoneLines.get(table) : undefined;
      wanted.set(`${block.startLine}|${measured ?? 0}|${table}`, {
        line: block.startLine,
        lines: measured ?? zoneLines ?? block.rows.length + 1,
        indent,
        body: buildTableHtml(rows, indent, visibleRight),
        onHeight: height => this.measured(table, Math.max(1, Math.ceil(height / lineHeight))),
        onZoneHeight: height => remember(this.zoneLines, table, Math.max(1, Math.ceil(height / lineHeight))),
        onClick: cell => this.reveal(editor, block, cell),
        onLink: href => openLink(href, editor.document.uri),
        onVisibleRight: right => this.visibleRight.set(editor, right),
      });
    }
    this.insetsFor(editor).sync(editor, wanted);
    editor.setDecorations(this.hideHeader, rendered.map(block => editor.document.lineAt(block.startLine).range));
    const isFoldable = (block: TableBlock) => this.foldingProvider.isFoldable(editor.document, block);
    this.syncFolds(editor, rendered.filter(isFoldable), tableBlocks.filter(block => !rendered.includes(block) && isFoldable(block)));
  }

  clear(editor: TextEditor): void {
    this.insets.get(editor)?.dispose();
    editor.setDecorations(this.hideHeader, []);
    this.shownRows.delete(editor);
    // editor.unfold reaches only the active editor, a background editor unfolds on a later clear or render
    if (editor !== window.activeTextEditor) return;
    this.unfoldAll(editor);
    this.folded.delete(editor);
    this.foldStarts.delete(editor);
    this.missedFolds.delete(editor);
  }

  /** Editors still folded stay so, a later activation unfolds the tables it does not render. */
  dispose(): void {
    const active = window.activeTextEditor;
    if (active) this.unfoldAll(active);
    for (const insets of this.insets.values()) insets.dispose();
    this.insets.clear();
    this.folded.clear();
    this.foldStarts.clear();
    this.visibleRight.clear();
    this.shownRows.clear();
    this.revealUntil.clear();
    this.missedFolds.clear();
    this.lastActive.clear();
    this.hideHeader.dispose();
  }

  private unfoldAll(editor: TextEditor): void {
    const lines = this.foldingProvider.foldableLines(editor.document);
    if (this.folded.has(editor) && lines.length > 0) {
      void commands.executeCommand('editor.unfold', { levels: 1, selectionLines: lines });
    }
  }

  private insetsFor(editor: TextEditor): EditorInsets {
    let insets = this.insets.get(editor);
    if (!insets) {
      insets = new EditorInsets(this.onChange);
      this.insets.set(editor, insets);
    }
    return insets;
  }

  /**
   * Unfold only on change: editor.unfold with empty selectionLines unfolds the whole file.
   * Only lines with a table range: on other lines VS Code folds or unfolds the enclosing section.
   */
  private syncFolds(editor: TextEditor, fold: TableBlock[], unfold: TableBlock[]): void {
    if (editor !== window.activeTextEditor || !this.insetsFor(editor).supported) return;
    const unfoldLines = unfold.map(block => block.startLine);
    const unfoldKey = unfoldLines.join(',');
    const previous = this.folded.get(editor);
    if (previous?.unfoldKey !== unfoldKey && unfoldLines.length > 0) {
      void commands.executeCommand('editor.unfold', { levels: 1, selectionLines: unfoldLines });
    }
    this.folded.set(editor, { version: editor.document.version, blocks: fold, open: unfoldLines, unfoldKey });
    this.unfoldBroken(editor, fold);
    // An external write over folded rows can hide every line below them with no visible range change
    if (previous?.version !== editor.document.version && fold.length > 0) {
      this.fold(editor, fold);
    } else {
      this.refold(editor);
    }
  }

  /**
   * Folds rendered tables whose header and first row show in the viewport.
   * VS Code has no fold state API or event: Unfold All or a recursive unfold open the rows, and the visible
   * range change that follows calls this again.
   * Unpatched, editor.fold scrolls to an off-screen cursor, so tables then refold only while the cursor shows.
   */
  refold(editor: TextEditor): void {
    const isShown = (line: number) => isLineShown(editor, line);
    const revealUntil = this.revealUntil.get(editor);
    if (revealUntil !== undefined && Date.now() > revealUntil) this.revealUntil.delete(editor);
    else if (revealUntil !== undefined && !isShown(editor.selection.active.line)) {
      editor.revealRange(editor.selection, TextEditorRevealType.InCenterIfOutsideViewport);
    }
    const folded = this.folded.get(editor);
    // Lines from an older version may point at other text, folding there folds the enclosing section
    if (editor !== window.activeTextEditor || !folded || folded.version !== editor.document.version) return;
    this.unfoldBroken(editor, folded.blocks);
    // A reopened file restores its saved folds after the first render, also over a table the cursor is in
    const foldedOpen = folded.open.filter(line => isFoldedAt(editor, line));
    if (foldedOpen.length > 0) void commands.executeCommand('editor.unfold', { levels: 1, selectionLines: foldedOpen });
    if (!foldKeepsScroll() && !isShown(editor.selection.active.line)) return;
    // A header above the viewport counts as shown: VS Code applies new ranges after the first fold, which then misses
    const firstVisible = editor.visibleRanges[0]?.start.line ?? 0;
    const fold = folded.blocks.filter(block => (isShown(block.startLine) || block.startLine < firstVisible) &&
      areRowsShown(editor, block) && this.foldingProvider.isFoldable(editor.document, block));
    if (fold.length > 0) this.fold(editor, fold);
  }

  /**
   * editor.fold goes to the focused code editor widget, e.g. the Debug Console input, so it can miss the active editor.
   * VS Code also applies new ranges late, so a missed fold retries once. Missed again, the table shows as source until
   * the next edit or cursor move.
   */
  private fold(editor: TextEditor, blocks: TableBlock[], retry = false): void {
    const shown = blocks.filter(block => areRowsShown(editor, block));
    const done = commands.executeCommand('editor.fold', { levels: 1, selectionLines: blocks.map(block => block.startLine) });
    done.then(() => {
      const state = editorState(editor);
      const missed = shown.filter(block => areRowsShown(editor, block));
      if (editor !== window.activeTextEditor || missed.length === 0) return;
      if (!retry) {
        setTimeout(() => {
          if (editor === window.activeTextEditor && editorState(editor) === state) this.fold(editor, missed, true);
        }, FOLD_RETRY_MS);
        return;
      }
      const previous = this.missedFolds.get(editor);
      const lines = previous?.state === state ? previous.lines : [];
      this.missedFolds.set(editor, { state, lines: [...lines, ...missed.map(block => block.startLine)] });
      this.onChange();
    }, () => undefined);
  }

  /**
   * VS Code keeps a collapsed table range after an edit breaks the table, which hides the rows below raw text.
   * Unfolds a former table line once the viewport shows it folded. Lines shift with documentChanged.
   */
  private unfoldBroken(editor: TextEditor, fold: TableBlock[]): void {
    const tableStarts = new Set(this.parseCache.get(editor.document).tableBlocks.map(block => block.startLine));
    const broken = (this.foldStarts.get(editor) ?? []).filter(line => !tableStarts.has(line));
    const unfoldLines = broken.filter(line => isFoldedAt(editor, line));
    if (unfoldLines.length > 0) void commands.executeCommand('editor.unfold', { levels: 1, selectionLines: unfoldLines });
    // Shown and open needs nothing, off-screen waits for a later visible range change
    const pending = broken.filter(line => !isLineShown(editor, line));
    this.foldStarts.set(editor, [...fold.map(block => block.startLine), ...pending]);
  }

  /** Keeps foldStarts on their text across edits. */
  documentChanged(event: TextDocumentChangeEvent): void {
    for (const [editor, lines] of this.foldStarts) {
      if (editor.document !== event.document) continue;
      this.foldStarts.set(editor, lines.map(line => shiftLine(line, event.contentChanges)).filter(line => line >= 0));
    }
  }

  private measured(table: string, lines: number): void {
    if (remember(this.measuredLines, table, lines)) this.onChange();
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

let foldKeepsScrollCached: boolean | undefined;

/**
 * Workbench patched with `fold no reveal` from vscode_workbench_patch.js, which adds this marker.
 * A file written after the extension host started is not running yet: the patch script writes it on the first start
 * of a new VS Code version, the window runs the old file until a reload.
 */
function foldKeepsScroll(): boolean {
  const workbench = join(env.appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  try {
    const hostStart = Date.now() - process.uptime() * 1000;
    foldKeepsScrollCached ??= statSync(workbench).mtimeMs < hostStart && readFileSync(workbench, 'utf8').includes('selectionLines&&');
  } catch {
    foldKeepsScrollCached = false;
  }
  return foldKeepsScrollCached;
}

function isLineShown(editor: TextEditor, line: number): boolean {
  return editor.visibleRanges.some(range => range.start.line <= line && range.end.line >= line);
}

/** Sets `key` as the newest entry of a bounded cache, false when it already held `lines`. */
function remember(cache: Map<string, number>, key: string, lines: number): boolean {
  if (cache.get(key) === lines) return false;
  cache.delete(key);
  if (cache.size >= MAX_MEASURED_TABLES) cache.delete(cache.keys().next().value!);
  cache.set(key, lines);
  return true;
}

function areRowsShown(editor: TextEditor, block: TableBlock): boolean {
  return editor.visibleRanges.some(range => range.start.line <= block.endLine && range.end.line > block.startLine);
}

/** Changes on an edit or a cursor move. */
function editorState(editor: TextEditor): string {
  return `${editor.document.version}|${editor.selections.map(selection => `${selection.anchor.line}:${selection.anchor.character}:${selection.active.line}:${selection.active.character}`).join(',')}`;
}

/** Rows below `line` hidden: a visible range ends on it and a later one starts after the gap. */
function isFoldedAt(editor: TextEditor, line: number): boolean {
  return editor.visibleRanges.some(range => range.end.line === line) &&
    editor.visibleRanges.some(range => range.start.line > line + 1);
}

/** `line` after the changes, -1 when a change removed its start. Change ranges are in the old document. */
function shiftLine(line: number, changes: readonly TextDocumentContentChangeEvent[]): number {
  let shift = 0;
  for (const { range, text } of changes) {
    const added = text.split('\n').length - 1;
    if (range.end.line < line || (range.end.line === line && range.end.character === 0 && !range.isEmpty)) {
      shift += added - (range.end.line - range.start.line);
    } else if (range.isEmpty && range.start.line === line && range.start.character === 0) {
      shift += added;
    } else if (range.start.line < line) {
      return -1;
    }
  }
  return line + shift;
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
