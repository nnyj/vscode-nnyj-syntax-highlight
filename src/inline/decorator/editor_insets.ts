import { randomBytes } from 'crypto';
import { commands, Event, extensions, TextEditor, ViewColumn, Webview, WebviewOptions, window, workspace } from 'vscode';
import { getEditorLineHeight } from '../mermaid/mermaid-renderer';
import { logWarn } from '../logging';

/**
 * Inset below 0-based `line`, `lines` tall, body shifted right by `indent` columns.
 * onHeight gets the body height in px when the zone does not follow it, onZoneHeight the height the webview asks the
 * zone for, onClick the `data-cell` of a double-clicked element, onLink the `data-href` of a clicked link.
 * A `data-visible-right` element in the body is capped to the editor's visible area inside the webview, since the
 * zone spans the editor's scroll width. onVisibleRight gets the new right edge in px when it moves over 4px.
 */
export type InsetSpec = {
  line: number;
  lines: number;
  indent: number;
  body: string;
  onHeight?: (height: number) => void;
  onZoneHeight?: (height: number) => void;
  onClick?: (cell: string) => void;
  onLink?: (href: string) => void;
  onVisibleRight?: (right: number) => void;
};

/** Companion extension in workbench_patch/, wraps the proposed editorInsets API that the Marketplace rejects. */
const WORKBENCH_PATCH_ID = 'nnyj.nnyj-workbench-patch';

type WebviewEditorInset = { readonly webview: Webview; readonly onDidDispose: Event<void>; dispose(): void };
type WorkbenchPatchApi = {
  createInset(editor: TextEditor, line: number, height: number, options?: WebviewOptions): WebviewEditorInset;
};
/** missed: unanswered pings, undefined until the webview's first message. */
type LiveInset = { inset: WebviewEditorInset; spec: InsetSpec; missed?: number };
/** Insets of one editor, with the viewColumn and font they were created for. */
type EditorEntry = { insets: Map<string, LiveInset>; viewColumn: ViewColumn | undefined; font: string };

const PING_INTERVAL_MS = 1000;
const MAX_MISSED_PINGS = 2;

/**
 * Keyed webview insets per visible editor, created through the workbench patch extension.
 * Unchanged keys keep their inset, so cursor moves don't flicker.
 * Wheel over an inset is forwarded to the editor as a fallback. It stalls once the inset scrolls away from
 * the pointer, since VS Code keeps routing the gesture to the inset iframe.
 */
export class EditorInsets {
  private failed = false;
  private activating = false;
  private editors = new Map<TextEditor, EditorEntry>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private rerendered = new Set<string>();

  /** onChange re-renders callers: after the workbench patch extension activates, or once insets fail and decorations take over. */
  constructor(private readonly onChange: () => void) {}

  /** Workbench patch extension installed and not failed. Callers render with insets, otherwise with decorations. */
  get supported(): boolean {
    return !this.failed && !!extensions.getExtension(WORKBENCH_PATCH_ID);
  }

  sync(editor: TextEditor, wanted: Map<string, InsetSpec>): void {
    if (!this.supported) return;
    for (const other of [...this.editors.keys()]) {
      if (other !== editor && !window.visibleTextEditors.includes(other)) this.dispose(other);
    }
    const font = insetFont();
    let entry = this.editors.get(editor);
    // A moved editor group reparents the inset iframes, which reload blank. The html holds the font.
    if (entry && (entry.viewColumn !== editor.viewColumn || entry.font !== font)) {
      this.dispose(editor);
      entry = undefined;
    }
    if (!entry) {
      entry = { insets: new Map(), viewColumn: editor.viewColumn, font };
      this.editors.set(editor, entry);
    }
    for (const [key, live] of entry.insets) {
      if (!wanted.has(key)) {
        entry.insets.delete(key);
        live.inset.dispose();
      }
    }
    for (const [key, spec] of wanted) {
      if (!entry.insets.has(key) && !this.create(editor, entry.insets, key, spec)) return;
    }
  }

  private create(editor: TextEditor, insets: Map<string, LiveInset>, key: string, spec: InsetSpec): boolean {
    const patch_extension = extensions.getExtension<WorkbenchPatchApi>(WORKBENCH_PATCH_ID);
    if (!patch_extension) return false;
    if (!patch_extension.isActive) {
      if (!this.activating) {
        this.activating = true;
        patch_extension.activate().then(() => this.onChange(), error => this.fail(error));
      }
      return false;
    }
    // The API throws for a hidden editor, which says nothing about insets support
    if (!window.visibleTextEditors.includes(editor)) return false;
    let inset: WebviewEditorInset;
    try {
      // API takes a 0-based line and places the zone below it
      inset = patch_extension.exports.createInset(editor, spec.line, spec.lines, { enableScripts: true });
    } catch (error) {
      this.fail(error);
      return false;
    }
    inset.webview.html = buildInsetHtml(spec);
    const live: LiveInset = { inset, spec };
    let scroll_remainder = 0;
    type InsetMessage = { delta?: number; height?: number; zoneHeight?: number; cell?: string; link?: string; visibleRight?: number };
    inset.webview.onDidReceiveMessage((message: InsetMessage) => {
      live.missed = 0;
      if (message.zoneHeight !== undefined) return spec.onZoneHeight?.(message.zoneHeight);
      if (message.height !== undefined) return spec.onHeight?.(message.height);
      if (message.link !== undefined) return spec.onLink?.(message.link);
      if (message.visibleRight !== undefined) return spec.onVisibleRight?.(message.visibleRight);
      if (message.cell !== undefined) return spec.onClick?.(message.cell);
      if (message.delta === undefined) return;
      const lineHeight = getEditorLineHeight();
      scroll_remainder += message.delta;
      const lines = Math.trunc(scroll_remainder / lineHeight);
      if (lines === 0) return;
      scroll_remainder -= lines * lineHeight;
      void commands.executeCommand('editorScroll', { to: lines > 0 ? 'down' : 'up', by: 'line', value: Math.abs(lines) });
    });
    inset.onDidDispose(() => {
      if (insets.get(key) !== live) return;
      insets.delete(key);
      // Disposed by VS Code, not by sync: render once more while the editor shows
      if (window.visibleTextEditors.includes(editor) && !this.rerendered.has(key)) {
        this.rerendered.add(key);
        this.onChange();
      }
    });
    insets.set(key, live);
    this.pingTimer ??= setInterval(() => this.ping(), PING_INTERVAL_MS);
    return true;
  }

  /**
   * Recreates insets that stop answering pings. A new editor group or a closed one can rebuild the grid around
   * the editor without changing its viewColumn. The reparented iframe reloads blank, VS Code never resends its html.
   */
  private ping(): void {
    const entries = [...this.editors].filter(([, entry]) => entry.insets.size > 0);
    if (entries.length === 0) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
      return;
    }
    for (const [editor, { insets }] of entries) {
      for (const [key, live] of [...insets]) {
        if (live.missed === undefined) continue;
        if (live.missed >= MAX_MISSED_PINGS) {
          insets.delete(key);
          live.inset.dispose();
          if (!this.create(editor, insets, key, live.spec)) return;
          continue;
        }
        live.missed++;
        live.inset.webview.postMessage({ ping: true }).then(undefined, () => undefined);
      }
    }
  }

  private fail(error: unknown): void {
    logWarn(`Editor insets unavailable, falling back to decorations. Add "enable-proposed-api": ["${WORKBENCH_PATCH_ID}"] to argv.json`, error);
    this.failed = true;
    this.dispose();
    this.onChange();
  }

  /** Disposes the insets of `editor`, or of every editor. */
  dispose(editor?: TextEditor): void {
    const editors = editor ? [editor] : [...this.editors.keys()];
    for (const other of editors) {
      const entry = this.editors.get(other);
      this.editors.delete(other);
      const insets = [...entry?.insets.values() ?? []];
      // Emptied first, so onDidDispose tells these from insets VS Code disposed
      entry?.insets.clear();
      for (const live of insets) live.inset.dispose();
    }
  }
}

/**
 * Blocks shown as source instead of their inset, by start line. Only empty cursors open or close a block: a non-empty
 * selection, e.g. a mouse drag, Shift+arrow or Ctrl+A, keeps the last state, so selecting never changes line heights.
 */
export class OpenBlocks {
  private open = new WeakMap<TextEditor, Set<number>>();

  get(editor: TextEditor, blocks: readonly { startLine: number; endLine: number }[]): Set<number> {
    const kept = this.open.get(editor);
    if (kept && editor.selections.some(selection => !selection.isEmpty)) return kept;
    const lines = editor.selections.map(selection => selection.active.line);
    const next = new Set(blocks.filter(block => lines.some(line => line >= block.startLine && line <= block.endLine))
      .map(block => block.startLine));
    this.open.set(editor, next);
    return next;
  }
}

/** Visual column of `character` on 0-based `line`, tabs expanded to the editor's tab size. */
export function visualColumn(editor: TextEditor, line: number, character: number): number {
  const line_text = editor.document.lineAt(line).text;
  const tab_size = Number(editor.options.tabSize) || 4;
  let column = 0;
  for (let i = 0; i < character && i < line_text.length; i++) {
    column = line_text[i] === '\t' ? column + tab_size - (column % tab_size) : column + 1;
  }
  return column;
}

/** Editor font as inline css, the ch unit in it matches editor columns. */
function insetFont(): string {
  const editor_config = workspace.getConfiguration('editor');
  return `font-family: ${editor_config.get<string>('fontFamily', 'monospace').replace(/[<>"]/g, '')}; font-size: ${editor_config.get<number>('fontSize', 14)}px;`;
}

function buildInsetHtml(spec: InsetSpec): string {
  const nonce = randomBytes(16).toString('base64');
  return '<!DOCTYPE html><html><head>' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">` +
    `</head><body style="margin: 0; padding: 0; overflow: hidden; ${insetFont()}">` +
    `<div style="padding-left: ${spec.indent}ch;">${spec.body}</div>` +
    `<script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      addEventListener('wheel', event => {
        event.preventDefault();
        vscode.postMessage({ delta: event.deltaY });
      }, { passive: false });
      const sized = document.querySelector('[data-visible-right]');
      // Patched workbench (inset resize) sizes the zone from zoneHeight at once.
      // Unpatched, the zone keeps its height, so the extension gets the height after 300ms and recreates the inset.
      let height_timer;
      new ResizeObserver(() => {
        const height = document.body.scrollHeight;
        vscode.postMessage({ zoneHeight: height });
        clearTimeout(height_timer);
        height_timer = setTimeout(() => {
          if (Math.abs(innerHeight - document.body.scrollHeight) > 1) vscode.postMessage({ height: document.body.scrollHeight });
        }, 300);
      }).observe(document.body);
      // Click opens a link, double click jumps to the cell source
      const handle_click = (target, detail) => {
        const link = target?.closest('[data-href]');
        if (link && detail === 1) return vscode.postMessage({ link: link.dataset.href });
        const cell = target?.closest('[data-cell]');
        if (cell && detail === 2) vscode.postMessage({ cell: cell.dataset.cell });
      };
      addEventListener('click', event => handle_click(event.target, event.detail));
      // Patched workbench relays presses as zoneMouse, since the zone never takes the mouse itself
      if (sized) vscode.postMessage({ zoneMouse: true });
      let anchor;
      addEventListener('message', event => {
        if (event.data?.ping) return vscode.postMessage({ pong: true });
        const mouse = event.data?.zoneMouse;
        if (!mouse) return;
        const selection = getSelection();
        if (mouse.type === 'clear') return selection.removeAllRanges();
        const caret = document.caretRangeFromPoint(mouse.x, mouse.y);
        if (mouse.type === 'down') {
          anchor = caret;
          if (!caret) return selection.removeAllRanges();
          selection.collapse(caret.startContainer, caret.startOffset);
        } else if (mouse.type === 'move' && anchor && caret) {
          selection.setBaseAndExtent(anchor.startContainer, anchor.startOffset, caret.startContainer, caret.startOffset);
        } else if (mouse.type === 'up') {
          anchor = undefined;
          const text = selection.toString();
          vscode.postMessage({ zoneSelection: text });
          if (!text) handle_click(document.elementFromPoint(mouse.x, mouse.y), mouse.detail);
        }
      });
      if (sized) {
        // Ancestor clipping crosses iframes, so the intersection is the part of the zone the editor shows
        const probe = document.body.appendChild(document.createElement('div'));
        probe.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 1px; pointer-events: none;';
        new IntersectionObserver(([entry]) => {
          const right = Math.round(entry.intersectionRect.right);
          if (entry.intersectionRect.width === 0) return;
          sized.style.maxWidth = (right - sized.getBoundingClientRect().left - 16) + "px";
          if (Math.abs(right - Number(sized.dataset.visibleRight)) > 4) {
            sized.dataset.visibleRight = right;
            vscode.postMessage({ visibleRight: right });
          }
        }, { threshold: Array.from({ length: 101 }, (_, i) => i / 100) }).observe(probe);
      }
    </script></body></html>`;
}
