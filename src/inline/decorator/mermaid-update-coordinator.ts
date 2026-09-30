import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import { ColorThemeKind, Position, Range, TextEditor, window, workspace } from 'vscode';
import type { MermaidBlock } from '../parser';
import { mapNormalizedToOriginal } from '../position-mapping';
import {
  renderMermaidSvg,
  renderMermaidSvgNatural,
  svgToDataUri,
  svgToDataUriBase64,
  createErrorSvg,
  getEditorLineHeight,
} from '../mermaid/mermaid-renderer';
import { processSvg } from '../mermaid/svg-processor';
import { LRUCache } from '../utils/lru-cache';
import { MermaidDiagramDecorations } from './mermaid-diagram-decorations';
import { createRange, isSelectionOrCursorInsideOffsets } from './editor-decoration-applier';
import { EditorInsets, InsetSpec, visualColumn } from './editor_insets';
import { logWarn } from '../logging';

type MermaidBlockKeyCacheEntry = {
  theme: 'default' | 'dark';
  fontFamily?: string;
  numLines: number;
  key: string;
};

/** Natural-size diagram, scaled down to maxWidth only. */
type SizedSvg = { svg: string; width: number; height: number };

const mermaidBlockKeyCache = new WeakMap<MermaidBlock, MermaidBlockKeyCacheEntry>();

function getMermaidBlockCacheKey(
  block: MermaidBlock,
  theme: 'default' | 'dark',
  fontFamily?: string
): string {
  const cached = mermaidBlockKeyCache.get(block);
  if (
    cached &&
    cached.theme === theme &&
    cached.fontFamily === fontFamily &&
    cached.numLines === block.numLines
  ) {
    return cached.key;
  }

  const keySource = `${block.source}\n${theme}\n${fontFamily ?? ''}\n${block.numLines}`;
  const key = createHash('sha256').update(keySource).digest('hex');
  mermaidBlockKeyCache.set(block, { theme, fontFamily, numLines: block.numLines, key });
  return key;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  };

  const concurrency = Math.max(1, Math.min(maxConcurrency, items.length));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function errorMessageOf(error: unknown): string {
  const message = error instanceof Error
    ? (error.message || error.toString() || 'Rendering failed')
    : (typeof error === 'string' ? error : String(error) || 'Rendering failed');
  return message.trim().length > 0 ? message : 'Unknown rendering error occurred';
}

function sizeSvg(naturalSvg: string, maxWidth: number): SizedSvg | undefined {
  const viewBox = /<svg\b[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i.exec(naturalSvg)?.[1].trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !(viewBox[2] > 0) || !(viewBox[3] > 0)) {
    return undefined;
  }
  const scale = Math.min(1, maxWidth / viewBox[2]);
  const height = Math.max(1, Math.round(viewBox[3] * scale));
  return { svg: processSvg(naturalSvg, height, maxWidth), width: Math.round(viewBox[2] * scale), height };
}

/** Horizontal slice [from, from + height) px of a sized SVG, cut by shrinking its viewBox. */
function cropSvg(sized: SizedSvg, from: number, height: number): string {
  const $ = cheerio.load(sized.svg, { xmlMode: true });
  const svgNode = $('svg').first();
  const viewBox = (svgNode.attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4) {
    return sized.svg;
  }
  const unitsPerPx = viewBox[3] / sized.height;
  svgNode.attr('viewBox', `${viewBox[0]} ${viewBox[1] + from * unitsPerPx} ${viewBox[2]} ${height * unitsPerPx}`);
  svgNode.attr('height', `${height}px`);
  return svgNode.toString();
}

/**
 * Renders Mermaid blocks.
 * Inset mode (inset helper extension installed and enabled): the natural-size diagram covers the code block lines,
 * overflow continues in an inset below the closing fence, pushing text down.
 * Cursor inside the block shows raw code, with the full diagram in the inset as a live preview.
 * Fallback: diagram squeezed into the code block lines.
 */
export class MermaidUpdateCoordinator {
  private mermaidUpdateToken = 0;
  private readonly insets: EditorInsets;
  private readonly naturalSvgCache = new LRUCache<string, Promise<string>>(50);

  cancel(): void {
    this.mermaidUpdateToken++;
  }

  constructor(
    private readonly mermaidDecorations: MermaidDiagramDecorations,
    private readonly maxConcurrency: number,
    onInsetsChange: () => void
  ) {
    this.insets = new EditorInsets(onInsetsChange);
  }

  clear(editor: TextEditor): void {
    this.insets.dispose();
    this.mermaidDecorations.clear(editor);
  }

  dispose(): void {
    this.cancel();
    this.insets.dispose();
    this.mermaidDecorations.dispose();
  }

  async update(
    editor: TextEditor,
    mermaidBlocks: MermaidBlock[],
    normalizedText: string,
    documentVersion: number,
    hoverIndicatorDecorationType: { dispose(): void } & { key?: string },
  ): Promise<void> {
    const token = ++this.mermaidUpdateToken;
    if (mermaidBlocks.length === 0) {
      this.insets.dispose();
      this.mermaidDecorations.clear(editor);
      editor.setDecorations(hoverIndicatorDecorationType as never, []);
      return;
    }

    const theme = window.activeColorTheme.kind === ColorThemeKind.Dark ||
      window.activeColorTheme.kind === ColorThemeKind.HighContrast
      ? 'dark'
      : 'default';
    const fontFamily = workspace.getConfiguration('editor').get<string>('fontFamily');

    if (this.insets.supported) {
      await this.updateWithInsets(editor, mermaidBlocks, normalizedText, documentVersion, token, theme, fontFamily, hoverIndicatorDecorationType);
      return;
    }

    const rangesByKey = new Map<string, Range[]>();
    const dataUrisByKey = new Map<string, string>();
    const indicatorRanges: Range[] = [];
    const originalText = editor.document.getText();
    const dataUriPromisesByKey = new Map<string, Promise<string>>();

    const results = await mapWithConcurrency(
      mermaidBlocks,
      this.maxConcurrency,
      async (block): Promise<{ key: string; range: Range; dataUri: string; indicatorRange: Range } | null> => {
        if (token !== this.mermaidUpdateToken || editor.document.version !== documentVersion) {
          return null;
        }

        if (isSelectionOrCursorInsideOffsets(block.startPos, block.endPos, normalizedText, editor.selections, editor.document)) {
          return null;
        }

        const range = createRange(editor, block.startPos, block.endPos, normalizedText);
        if (!range) {
          return null;
        }

        const blockStart = mapNormalizedToOriginal(block.startPos, originalText);
        const openingFenceLineEnd = originalText.indexOf('\n', blockStart);
        const contentStart = openingFenceLineEnd !== -1 ? openingFenceLineEnd + 1 : blockStart;
        const contentStartPos = editor.document.positionAt(contentStart);
        const line = editor.document.lineAt(contentStartPos.line);
        const indicatorEndChar = Math.min(contentStartPos.character + 1, line.text.length);
        const indicatorRange = new Range(
          contentStartPos,
          new Position(contentStartPos.line, indicatorEndChar)
        );

        const key = getMermaidBlockCacheKey(block, theme, fontFamily);
        let dataUriPromise = dataUriPromisesByKey.get(key);
        if (!dataUriPromise) {
          dataUriPromise = (async () => {
            try {
              const svg = await renderMermaidSvg(block.source, { theme, fontFamily, numLines: block.numLines });
              return svgToDataUri(svg);
            } catch (error) {
              logWarn('Mermaid render failed', error);
              const errorSvg = createErrorSvg(
                errorMessageOf(error),
                Math.max(400, block.numLines * 20),
                block.numLines * 20,
                theme === 'dark'
              );
              return svgToDataUri(errorSvg);
            }
          })();
          dataUriPromisesByKey.set(key, dataUriPromise);
        }

        const dataUri = await dataUriPromise;
        if (token !== this.mermaidUpdateToken || editor.document.version !== documentVersion) {
          return null;
        }

        return { key, range, dataUri, indicatorRange };
      }
    );

    for (const result of results) {
      if (!result) {
        continue;
      }
      dataUrisByKey.set(result.key, result.dataUri);
      const ranges = rangesByKey.get(result.key) || [];
      ranges.push(result.range);
      rangesByKey.set(result.key, ranges);
      indicatorRanges.push(result.indicatorRange);
    }

    if (token !== this.mermaidUpdateToken || editor.document.version !== documentVersion) {
      return;
    }

    this.mermaidDecorations.apply(editor, rangesByKey, dataUrisByKey);
    editor.setDecorations(hoverIndicatorDecorationType as never, indicatorRanges);
  }

  private async updateWithInsets(
    editor: TextEditor,
    mermaidBlocks: MermaidBlock[],
    normalizedText: string,
    documentVersion: number,
    token: number,
    theme: 'default' | 'dark',
    fontFamily: string | undefined,
    hoverIndicatorDecorationType: { dispose(): void } & { key?: string },
  ): Promise<void> {
    const isStale = () => token !== this.mermaidUpdateToken || editor.document.version !== documentVersion;
    const lineHeight = getEditorLineHeight();
    const fontSize = workspace.getConfiguration('editor').get<number>('fontSize', 14);
    const maxWidth = Math.round(fontSize * 0.6 * 200);
    const rangesByKey = new Map<string, Range[]>();
    const dataUrisByKey = new Map<string, string>();
    const wantedInsets = new Map<string, InsetSpec>();

    await mapWithConcurrency(mermaidBlocks, this.maxConcurrency, async (block) => {
      if (isStale()) return;
      const range = createRange(editor, block.startPos, block.endPos, normalizedText);
      if (!range) return;

      const key = getMermaidBlockCacheKey(block, theme, fontFamily);
      let sized: SizedSvg | undefined;
      try {
        sized = sizeSvg(await this.getNaturalSvg(key, block.source, theme, fontFamily), maxWidth);
      } catch (error) {
        logWarn('Mermaid render failed', error);
        const width = Math.max(400, block.numLines * 20);
        const height = Math.max(3, block.numLines) * 20;
        sized = { svg: createErrorSvg(errorMessageOf(error), width, height, theme === 'dark'), width, height };
      }
      if (!sized || isStale()) return;

      const document = editor.document;
      const fenceEndLine = document.positionAt(mapNormalizedToOriginal(block.endPos - 1, normalizedText)).line;
      const indent = visualColumn(document.lineAt(range.start.line).text, range.start.character);
      const blockHeight = (block.numLines + 2) * lineHeight;
      const cursorInside = isSelectionOrCursorInsideOffsets(block.startPos, block.endPos, normalizedText, editor.selections, document);
      const insetFrom = cursorInside ? 0 : blockHeight;

      if (!cursorInside) {
        // One slice per code block line: a single tall image on the first line vanishes once that line scrolls off
        const topHeight = Math.min(sized.height, blockHeight);
        for (let offset = 0, line = range.start.line; offset < topHeight && line < document.lineCount; offset += lineHeight, line++) {
          const sliceHeight = Math.min(lineHeight, topHeight - offset);
          const decorationKey = `${key}|slice|${offset}|${sliceHeight}`;
          if (!dataUrisByKey.has(decorationKey)) {
            dataUrisByKey.set(decorationKey, svgToDataUri(cropSvg(sized, offset, sliceHeight)));
          }
          const ranges = rangesByKey.get(decorationKey) ?? [];
          ranges.push(document.lineAt(line).range);
          rangesByKey.set(decorationKey, ranges);
        }
      }

      if (sized.height > insetFrom) {
        const insetHeight = sized.height - insetFrom;
        const dataUri = svgToDataUriBase64(insetFrom === 0 ? sized.svg : cropSvg(sized, insetFrom, insetHeight));
        wantedInsets.set(`${fenceEndLine}|${indent}|${key}|${insetFrom}`, {
          line: fenceEndLine,
          lines: Math.ceil(insetHeight / lineHeight),
          indent,
          body: `<img src="${dataUri}" style="display: block;">`,
        });
      }
    });

    if (isStale()) return;
    this.insets.sync(editor, wantedInsets);
    this.mermaidDecorations.apply(editor, rangesByKey, dataUrisByKey);
    editor.setDecorations(hoverIndicatorDecorationType as never, []);
  }

  private getNaturalSvg(key: string, source: string, theme: 'default' | 'dark', fontFamily?: string): Promise<string> {
    let promise = this.naturalSvgCache.get(key);
    if (!promise) {
      promise = renderMermaidSvgNatural(source, { theme, fontFamily });
      this.naturalSvgCache.set(key, promise);
      promise.catch(() => this.naturalSvgCache.delete(key));
    }
    return promise;
  }
}
