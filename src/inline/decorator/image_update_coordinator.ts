import { Disposable, Range, TextEditor, Uri, workspace } from 'vscode';
import type { ImageBlock } from '../parser';
import { resolveImageTarget } from '../link-targets';
import { getEditorLineHeight } from '../mermaid/mermaid-renderer';
import { svgToDataUriBase64 } from '../mermaid/svg-processor';
import { logWarn } from '../logging';
import { MermaidDiagramDecorations } from './mermaid-diagram-decorations';
import { createRange, isSelectionOrCursorInsideOffsets } from './editor-decoration-applier';
import { EditorInsets, InsetSpec, visualColumn } from './editor_insets';

type LoadedImage = { data_uri: string; width?: number; height?: number };

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const MAX_LOADED_IMAGES = 100;
const MAX_INSET_LINES = 25;
const UNKNOWN_SIZE_INSET_LINES = 10;

/**
 * Renders standalone Markdown images inline.
 * Inset mode (inset helper extension installed and enabled): webview zone below the image line pushes text down.
 * Fallback: Mermaid-style decoration, height = covered lines × line height, blank lines below enlarge it.
 * Rendering is synchronous from cache; uncached images load async, then onLoaded re-runs the update.
 */
export class ImageUpdateCoordinator {
  private loaded = new Map<string, LoadedImage | null>();
  private loading = new Set<string>();
  private generation = 0;
  private readonly watcher: Disposable;
  private readonly insets: EditorInsets;

  constructor(
    private readonly imageDecorations: MermaidDiagramDecorations,
    private readonly onLoaded: () => void
  ) {
    const watcher = workspace.createFileSystemWatcher(`**/*.{${Object.keys(MIME_BY_EXT).join(',')}}`, true, false, true);
    watcher.onDidChange(uri => {
      if (this.loaded.delete(uri.toString())) this.onLoaded();
    });
    this.watcher = watcher;
    this.insets = new EditorInsets(onLoaded);
  }

  /** Blocks rendered as images for the current selections; their raw syntax decorations are skipped. */
  getRenderedBlocks(editor: TextEditor, imageBlocks: ImageBlock[], normalizedText: string): ImageBlock[] {
    if (this.insets.supported) return [];
    return imageBlocks.filter(block => {
      const uri = resolveImageTarget(block.url, editor.document.uri);
      return uri && this.loaded.get(uri.toString()) &&
        !isSelectionOrCursorInsideOffsets(block.startPos, block.endPos, normalizedText, editor.selections, editor.document);
    });
  }

  update(editor: TextEditor, imageBlocks: ImageBlock[], normalizedText: string): void {
    const lineHeight = getEditorLineHeight();
    const fontSize = workspace.getConfiguration('editor').get<number>('fontSize', 14);
    const maxWidth = Math.round(fontSize * 0.6 * 120);
    const rangesByKey = new Map<string, Range[]>();
    const dataUrisByKey = new Map<string, string>();
    const wanted_insets = new Map<string, InsetSpec>();

    for (const block of imageBlocks) {
      const uri = resolveImageTarget(block.url, editor.document.uri);
      if (!uri) continue;
      const uriKey = uri.toString();
      if (!this.loaded.has(uriKey)) {
        this.load(uri, uriKey);
        continue;
      }
      const image = this.loaded.get(uriKey);
      if (!image) continue;
      if (this.insets.supported) {
        const range = createRange(editor, block.startPos, block.endPos, normalizedText);
        if (!range) continue;
        const indent = visualColumn(editor.document.lineAt(range.start.line).text, range.start.character);
        const { lines, body } = buildInsetBody(image, lineHeight, maxWidth);
        wanted_insets.set(`${range.end.line}|${indent}|${uriKey}|${lines}`, { line: range.end.line, lines, indent, body });
        continue;
      }
      if (isSelectionOrCursorInsideOffsets(block.startPos, block.endPos, normalizedText, editor.selections, editor.document)) {
        continue;
      }
      const range = createRange(editor, block.startPos, block.endPos, normalizedText);
      if (!range) continue;

      const height = block.numLines * lineHeight;
      const key = `${uriKey}|${height}|${maxWidth}`;
      if (!dataUrisByKey.has(key)) {
        dataUrisByKey.set(key, wrapImageSvg(image, height, maxWidth));
      }
      const ranges = rangesByKey.get(key) ?? [];
      ranges.push(range);
      rangesByKey.set(key, ranges);
    }

    this.insets.sync(editor, wanted_insets);
    this.imageDecorations.apply(editor, rangesByKey, dataUrisByKey);
  }

  clear(editor: TextEditor): void {
    this.insets.dispose();
    this.imageDecorations.clear(editor);
  }

  dispose(): void {
    this.generation++;
    this.loaded.clear();
    this.loading.clear();
    this.watcher.dispose();
    this.insets.dispose();
    this.imageDecorations.dispose();
  }

  private load(uri: Uri, uriKey: string): void {
    if (this.loading.has(uriKey)) return;
    this.loading.add(uriKey);
    const generation = this.generation;
    void loadImage(uri).then(image => {
      if (generation !== this.generation) return;
      this.loading.delete(uriKey);
      if (this.loaded.size >= MAX_LOADED_IMAGES) {
        this.loaded.delete(this.loaded.keys().next().value!);
      }
      this.loaded.set(uriKey, image);
      if (image) this.onLoaded();
    });
  }
}

async function loadImage(uri: Uri): Promise<LoadedImage | null> {
  try {
    let bytes: Uint8Array;
    let mime: string | undefined;
    if (uri.scheme === 'http' || uri.scheme === 'https') {
      const response = await fetch(uri.toString(true), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error(`image over ${MAX_IMAGE_BYTES} bytes`);
      mime = response.headers.get('content-type')?.split(';')[0].trim();
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      bytes = await workspace.fs.readFile(uri);
    }
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image over ${MAX_IMAGE_BYTES} bytes`);

    const ext = uri.path.split('.').pop()?.toLowerCase() ?? '';
    mime = MIME_BY_EXT[ext] ?? (mime?.startsWith('image/') ? mime : undefined);
    if (!mime) return null;
    const size = readImageSize(bytes, mime);
    return {
      data_uri: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      width: size?.width,
      height: size?.height,
    };
  } catch (error) {
    logWarn(`Image load failed: ${uri.toString(true)}`, error);
    return null;
  }
}

/** Inset height in lines and img html, image scaled down to maxWidth × MAX_INSET_LINES, never up. */
function buildInsetBody(image: LoadedImage, lineHeight: number, maxWidth: number): { lines: number; body: string } {
  let size_style = `max-width: ${maxWidth}px; max-height: ${UNKNOWN_SIZE_INSET_LINES * lineHeight}px;`;
  let lines = UNKNOWN_SIZE_INSET_LINES;
  if (image.width && image.height) {
    const scale = Math.min(1, maxWidth / image.width, (MAX_INSET_LINES * lineHeight) / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    size_style = `width: ${width}px; height: ${height}px;`;
    lines = Math.max(1, Math.ceil(height / lineHeight));
  }
  return { lines, body: `<img src="${image.data_uri}" style="display: block; ${size_style}">` };
}

/**
 * Wraps the image in a fixed-size SVG, since contentIconPath renders images at natural size.
 * Scales down to fit height × maxWidth, never up.
 */
function wrapImageSvg(image: LoadedImage, maxHeight: number, maxWidth: number): string {
  let width = maxWidth;
  let height = maxHeight;
  if (image.width && image.height) {
    const scale = Math.min(1, maxHeight / image.height, maxWidth / image.width);
    width = Math.max(1, Math.round(image.width * scale));
    height = Math.max(1, Math.round(image.height * scale));
  }
  const href = image.data_uri.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">` +
    `<image width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet" href="${href}" xlink:href="${href}"/></svg>`;
  return svgToDataUriBase64(svg);
}

function readImageSize(bytes: Uint8Array, mime: string): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  try {
    if (mime === 'image/png' && ascii(12, 16) === 'IHDR') {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mime === 'image/gif') {
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (mime === 'image/bmp') {
      return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return undefined;
        const marker = bytes[offset + 1];
        // SOF0-SOF15 except DHT (C4), JPG (C8), DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
      return undefined;
    }
    if (mime === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
      const chunk = ascii(12, 16);
      if (chunk === 'VP8 ') {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width, height };
      }
      return undefined;
    }
    if (mime === 'image/svg+xml') {
      const head = new TextDecoder().decode(bytes.subarray(0, 4096));
      const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
      if (!tag) return undefined;
      const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag)?.[1];
      const width = parseFloat(attr('width') ?? '');
      const height = parseFloat(attr('height') ?? '');
      if (width > 0 && height > 0) return { width, height };
      const view_box = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number);
      if (view_box?.length === 4 && view_box[2] > 0 && view_box[3] > 0) {
        return { width: view_box[2], height: view_box[3] };
      }
    }
  } catch {
    // Truncated or malformed header, fall back to box fit
  }
  return undefined;
}
