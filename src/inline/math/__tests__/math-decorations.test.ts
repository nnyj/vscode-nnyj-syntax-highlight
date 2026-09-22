vi.mock('../math-renderer', () => ({
  renderMathToDataUri: vi.fn(() => 'data:image/svg+xml;base64,PHN2Zy8+'),
}));

import { window, workspace, ColorThemeKind } from 'vscode';
import { MathDecorations } from '../math-decorations';
import { renderMathToDataUri } from '../math-renderer';

describe('MathDecorations', () => {
  beforeEach(() => {
    window.activeColorTheme.kind = ColorThemeKind.Dark;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('uses (numLines + 2) * lineHeight for block regions', () => {
    vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
      get: <T>(key: string, defaultValue: T): T => {
        if (key === 'fontSize') return 14 as T;
        if (key === 'lineHeight') return 0 as T;
        return defaultValue;
      },
    } as unknown as ReturnType<typeof workspace.getConfiguration>);

    const editor = { setDecorations: vi.fn() } as any;
    const decorations = new MathDecorations();
    decorations.apply(editor, [
      {
        region: {
          startPos: 0,
          endPos: 10,
          source: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2}',
          displayMode: true,
          numLines: 3,
        },
        range: {} as any,
      },
    ]);

    const expectedLineHeight = process.platform === 'darwin' ? 21 : 19;
    expect(renderMathToDataUri).toHaveBeenCalledWith(
      '\\sum_{n=1}^{\\infty} \\frac{1}{n^2}',
      expect.objectContaining({
        displayMode: true,
        height: (3 + 2) * expectedLineHeight,
      })
    );
  });

  it('does not set block-only width/height auto styling on decoration before options', () => {
    vi.spyOn(window, 'createTextEditorDecorationType');
    window.activeColorTheme.kind = ColorThemeKind.Dark;

    const editor = { setDecorations: vi.fn() } as any;
    const decorations = new MathDecorations();
    decorations.apply(editor, [
      {
        region: {
          startPos: 0,
          endPos: 5,
          source: 'x',
          displayMode: true,
          numLines: 1,
        },
        range: {} as any,
      },
    ]);

    const options = vi.mocked(window.createTextEditorDecorationType).mock.calls[0][0];
    expect(options.before.width).toBeUndefined();
    expect(options.before.height).toBeUndefined();
  });

  it('renders repeated equal expressions once across cursor updates', () => {
    const editor = { setDecorations: vi.fn() } as any;
    const decorations = new MathDecorations();
    const region = {
      startPos: 0,
      endPos: 3,
      source: 'x',
      displayMode: false,
    };
    const first_range = {} as any;
    const second_range = {} as any;

    decorations.apply(editor, [
      { region, range: first_range },
      { region, range: second_range },
    ]);
    decorations.apply(editor, [{ region, range: first_range }]);
    decorations.apply(editor, [{ region, range: null }]);
    decorations.apply(editor, [{ region, range: first_range }]);

    expect(renderMathToDataUri).toHaveBeenCalledTimes(1);
    expect(window.createTextEditorDecorationType).toHaveBeenCalledTimes(1);
    expect(editor.setDecorations.mock.calls[0][1]).toEqual([first_range, second_range]);
  });

  it('renders again when height, theme, or source changes', () => {
    let font_size = 14;
    vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
      get: <T>(key: string, defaultValue: T): T => {
        if (key === 'fontSize') return font_size as T;
        if (key === 'lineHeight') return 0 as T;
        return defaultValue;
      },
    } as unknown as ReturnType<typeof workspace.getConfiguration>);

    const editor = { setDecorations: vi.fn() } as any;
    const decorations = new MathDecorations();
    const range = {} as any;
    const apply = (source: string) =>
      decorations.apply(editor, [
        {
          region: { startPos: 0, endPos: 3, source, displayMode: false },
          range,
        },
      ]);

    apply('x');
    font_size = 20;
    apply('x');
    window.activeColorTheme.kind = ColorThemeKind.Light;
    apply('x');
    apply('y');

    expect(renderMathToDataUri).toHaveBeenCalledTimes(4);
    expect(renderMathToDataUri).toHaveBeenNthCalledWith(
      2,
      'x',
      expect.objectContaining({ height: 24 })
    );
    expect(renderMathToDataUri).toHaveBeenNthCalledWith(
      3,
      'x',
      expect.objectContaining({ foregroundColor: '#3c3c3c' })
    );
  });

  it('keeps all active formulas when they exceed the retained cache bound', () => {
    const editor = { setDecorations: vi.fn() } as any;
    const decorations = new MathDecorations(1);
    const first_range = {} as any;
    const second_range = {} as any;
    const first_region = {
      startPos: 0,
      endPos: 3,
      source: 'x',
      displayMode: false,
    };
    const second_region = {
      startPos: 4,
      endPos: 7,
      source: 'y',
      displayMode: false,
    };

    decorations.apply(editor, [
      { region: first_region, range: first_range },
      { region: second_region, range: second_range },
    ]);
    const first_decoration = vi.mocked(window.createTextEditorDecorationType).mock.results[0].value;
    const second_decoration = vi.mocked(window.createTextEditorDecorationType).mock.results[1].value;
    expect(first_decoration.dispose).not.toHaveBeenCalled();
    expect(second_decoration.dispose).not.toHaveBeenCalled();
    expect(editor.setDecorations).toHaveBeenCalledWith(first_decoration, [first_range]);
    expect(editor.setDecorations).toHaveBeenCalledWith(second_decoration, [second_range]);

    decorations.apply(editor, [{ region: second_region, range: second_range }]);
    expect(first_decoration.dispose).toHaveBeenCalledTimes(1);
    expect(second_decoration.dispose).not.toHaveBeenCalled();
    expect(renderMathToDataUri).toHaveBeenCalledTimes(2);
  });

  it('disposes evicted and explicitly disposed decoration types', () => {
    const editor = { setDecorations: vi.fn() } as any;
    const decorations = new MathDecorations(1);
    const apply = (source: string) =>
      decorations.apply(editor, [
        {
          region: { startPos: 0, endPos: 3, source, displayMode: false },
          range: {} as any,
        },
      ]);

    apply('x');
    const first_decoration = vi.mocked(window.createTextEditorDecorationType).mock.results[0].value;
    apply('y');
    const second_decoration = vi.mocked(window.createTextEditorDecorationType).mock.results[1].value;
    expect(first_decoration.dispose).toHaveBeenCalledTimes(1);

    decorations.dispose();
    expect(second_decoration.dispose).toHaveBeenCalledTimes(1);
  });
});
