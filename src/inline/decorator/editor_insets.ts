import { randomBytes } from 'crypto';
import { commands, Event, extensions, TextEditor, Webview, WebviewOptions, workspace } from 'vscode';
import { getEditorLineHeight } from '../mermaid/mermaid-renderer';
import { logWarn } from '../logging';

/**
 * Inset below 0-based `line`, `lines` tall, body shifted right by `indent` columns.
 * onHeight gets the body height in px when the zone does not follow it, onClick the `data-cell` of a double-clicked element,
 * onLink the `data-href` of a clicked link.
 * A `data-visible-right` element in the body is capped to the editor's visible area inside the webview, since the
 * zone spans the editor's scroll width. onVisibleRight gets the new right edge in px when it moves over 4px.
 */
export type InsetSpec = {
  line: number;
  lines: number;
  indent: number;
  body: string;
  onHeight?: (height: number) => void;
  onClick?: (cell: string) => void;
  onLink?: (href: string) => void;
  onVisibleRight?: (right: number) => void;
};

/** Companion extension in inset_helper/, wraps the proposed editorInsets API that the Marketplace rejects. */
const INSET_HELPER_ID = 'nnyj.nnyj-inset-helper';

type WebviewEditorInset = { readonly webview: Webview; readonly onDidDispose: Event<void>; dispose(): void };
type InsetHelperApi = {
  createInset(editor: TextEditor, line: number, height: number, options?: WebviewOptions): WebviewEditorInset;
};

/**
 * Keyed webview insets for one editor at a time, created through the inset helper extension.
 * Unchanged keys keep their inset, so cursor moves don't flicker.
 * Wheel over an inset is forwarded to the editor as a fallback. It stalls once the inset scrolls away from
 * the pointer, since VS Code keeps routing the gesture to the inset iframe.
 */
export class EditorInsets {
  private failed = false;
  private activating = false;
  private insets = new Map<string, WebviewEditorInset>();
  private editor: TextEditor | undefined;

  /** onChange re-renders callers: after the helper activates, or once insets fail and decorations take over. */
  constructor(private readonly onChange: () => void) {}

  /** Helper installed and not failed. Callers render with insets, otherwise with decorations. */
  get supported(): boolean {
    return !this.failed && !!extensions.getExtension(INSET_HELPER_ID);
  }

  sync(editor: TextEditor, wanted: Map<string, InsetSpec>): void {
    if (!this.supported) return;
    if (editor !== this.editor) {
      this.dispose();
      this.editor = editor;
    }
    for (const [key, inset] of this.insets) {
      if (!wanted.has(key)) {
        this.insets.delete(key);
        inset.dispose();
      }
    }
    for (const [key, spec] of wanted) {
      if (!this.insets.has(key) && !this.create(editor, key, spec)) return;
    }
  }

  private create(editor: TextEditor, key: string, spec: InsetSpec): boolean {
    const helper = extensions.getExtension<InsetHelperApi>(INSET_HELPER_ID);
    if (!helper) return false;
    if (!helper.isActive) {
      if (!this.activating) {
        this.activating = true;
        helper.activate().then(() => this.onChange(), error => this.fail(error));
      }
      return false;
    }
    let inset: WebviewEditorInset;
    try {
      // API takes a 0-based line and places the zone below it
      inset = helper.exports.createInset(editor, spec.line, spec.lines, { enableScripts: true });
    } catch (error) {
      this.fail(error);
      return false;
    }
    inset.webview.html = buildInsetHtml(spec);
    let scroll_remainder = 0;
    type InsetMessage = { delta?: number; height?: number; cell?: string; link?: string; visibleRight?: number };
    inset.webview.onDidReceiveMessage((message: InsetMessage) => {
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
      if (this.insets.get(key) === inset) this.insets.delete(key);
    });
    this.insets.set(key, inset);
    return true;
  }

  private fail(error: unknown): void {
    logWarn(`Editor insets unavailable, falling back to decorations. Add "enable-proposed-api": ["${INSET_HELPER_ID}"] to argv.json`, error);
    this.failed = true;
    this.dispose();
    this.onChange();
  }

  dispose(): void {
    const insets = [...this.insets.values()];
    this.insets.clear();
    for (const inset of insets) inset.dispose();
  }
}

/** Visual column of `character` on `line_text`, tabs expanded to editor.tabSize. */
export function visualColumn(line_text: string, character: number): number {
  const tab_size = workspace.getConfiguration('editor').get<number>('tabSize', 4);
  let column = 0;
  for (let i = 0; i < character && i < line_text.length; i++) {
    column = line_text[i] === '\t' ? column + tab_size - (column % tab_size) : column + 1;
  }
  return column;
}

function buildInsetHtml(spec: InsetSpec): string {
  const nonce = randomBytes(16).toString('base64');
  const editor_config = workspace.getConfiguration('editor');
  // ch unit in the editor font matches editor columns
  const font = `font-family: ${editor_config.get<string>('fontFamily', 'monospace').replace(/[<>"]/g, '')}; font-size: ${editor_config.get<number>('fontSize', 14)}px;`;
  return '<!DOCTYPE html><html><head>' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">` +
    `</head><body style="margin: 0; padding: 0; overflow: hidden; ${font}">` +
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
