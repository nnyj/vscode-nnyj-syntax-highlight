import { type TextEditor, window, Uri, type Range, ColorThemeKind, workspace } from 'vscode';
import type { MathRegion } from '../parser';
import { renderMathToDataUri } from './math-renderer';

/** Default editor foreground colors by theme (VS Code defaults). */
const DEFAULT_FOREGROUND = {
  dark: '#d4d4d4',
  light: '#3c3c3c',
} as const;

/** Compute line height from editor settings, aligned with mermaid sizing fallback. */
function getEditorHeights(): { blockHeight: number; inlineHeight: number; lineHeight: number } {
  const editorConfig = workspace.getConfiguration('editor');
  const fontSize = editorConfig.get<number>('fontSize', 14);
  const lineHeightSetting = editorConfig.get<number>('lineHeight', 0);
  let lineHeight: number;
  if (lineHeightSetting === 0 || lineHeightSetting < 8) {
    const multiplier = process.platform === 'darwin' ? 1.5 : 1.35;
    lineHeight = Math.round(fontSize * multiplier);
    if (lineHeight < 8) {
      lineHeight = 8;
    }
  } else if (lineHeightSetting >= 10) {
    lineHeight = Math.round(lineHeightSetting);
  } else {
    lineHeight = Math.round(fontSize * lineHeightSetting);
  }
  const inlineHeight = Math.round(fontSize * 1.2);
  return { blockHeight: lineHeight, inlineHeight, lineHeight };
}

type MathDecorationEntry = {
  decorationType: ReturnType<typeof window.createTextEditorDecorationType>;
  lastUsed: number;
};

/** Creates a cache key from every value that affects rendered output. */
function contentKey(
  source: string,
  displayMode: boolean,
  height: number,
  foreground_color: string,
  theme_kind: ColorThemeKind
): string {
  return `${displayMode ? 'block' : 'inline'}:${theme_kind}:${height}:${foreground_color}:${source}`;
}

export class MathDecorations {
  private cache = new Map<string, MathDecorationEntry>();
  private usageCounter = 0;

  constructor(private maxEntries: number = 100) {}

  /**
   * Apply math decorations for the given regions. Renders LaTeX to data URIs,
   * caches decoration types by content key, and applies to editor ranges.
   * Regions whose range is null (e.g. selection intersects) are skipped.
   */
  apply(
    editor: TextEditor,
    regionsWithRanges: Array<{ region: MathRegion; range: Range | null }>
  ): void {
    const usedKeys = new Set<string>();
    const isDarkTheme =
      window.activeColorTheme.kind === ColorThemeKind.Dark ||
      window.activeColorTheme.kind === ColorThemeKind.HighContrast;

    const foregroundColor = DEFAULT_FOREGROUND[isDarkTheme ? 'dark' : 'light'];
    const { blockHeight, inlineHeight, lineHeight } = getEditorHeights();

    const byKey = new Map<
      string,
      { ranges: Range[]; source: string; displayMode: boolean; height: number }
    >();
    for (const { region, range } of regionsWithRanges) {
      if (!range) continue;
      const height =
        region.displayMode && region.numLines !== undefined && region.numLines !== null
          ? (region.numLines + 2) * lineHeight
          : region.displayMode
            ? blockHeight
            : inlineHeight;
      const key = contentKey(
        region.source,
        region.displayMode,
        height,
        foregroundColor,
        window.activeColorTheme.kind
      );
      const existing = byKey.get(key);
      if (existing) {
        existing.ranges.push(range);
      } else {
        byKey.set(key, {
          ranges: [range],
          source: region.source,
          displayMode: region.displayMode,
          height,
        });
      }
    }

    for (const [key, { ranges, source, displayMode, height }] of byKey.entries()) {
      const entry = this.getOrCreateEntry(key, () =>
        renderMathToDataUri(source, {
          displayMode,
          height,
          foregroundColor,
        })
      );
      if (!entry) continue;
      usedKeys.add(key);
      editor.setDecorations(entry.decorationType, ranges);
    }

    this.clear_unused(editor, usedKeys);
    this.evictIfNeeded(usedKeys);
  }

  clear(editor: TextEditor): void {
    for (const entry of this.cache.values()) {
      editor.setDecorations(entry.decorationType, []);
      entry.decorationType.dispose();
    }
    this.cache.clear();
  }

  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.decorationType.dispose();
    }
    this.cache.clear();
  }

  private getOrCreateEntry(
    key: string,
    render: () => string | null
  ): MathDecorationEntry | undefined {
    const existing = this.cache.get(key);
    if (existing) {
      existing.lastUsed = ++this.usageCounter;
      return existing;
    }
    const data_uri = render();
    if (!data_uri) return undefined;
    const displayMode = key.startsWith('block:');
    const decorationType = window.createTextEditorDecorationType({
      color: 'transparent',
      textDecoration: 'none; display: inline-block; width: 0;',
      before: {
        contentIconPath: Uri.parse(data_uri),
        textDecoration: 'none;',
      },
      ...(displayMode
        ? { rangeBehavior: 1 as const /* TrackedRangeStickiness.NeverGrowWhenTypingAtEdges */ }
        : {}),
    });
    const entry: MathDecorationEntry = {
      decorationType,
      lastUsed: ++this.usageCounter,
    };
    this.cache.set(key, entry);
    return entry;
  }

  private clear_unused(editor: TextEditor, usedKeys: Set<string>): void {
    for (const [key, entry] of this.cache.entries()) {
      if (usedKeys.has(key)) continue;
      editor.setDecorations(entry.decorationType, []);
    }
  }

  private evictIfNeeded(usedKeys: Set<string>): void {
    while (this.cache.size > this.maxEntries) {
      let lruKey: string | undefined;
      let lruAccess = Infinity;
      for (const [key, entry] of this.cache.entries()) {
        if (!usedKeys.has(key) && entry.lastUsed < lruAccess) {
          lruAccess = entry.lastUsed;
          lruKey = key;
        }
      }
      if (!lruKey) return;
      this.cache.get(lruKey)?.decorationType.dispose();
      this.cache.delete(lruKey);
    }
  }
}
