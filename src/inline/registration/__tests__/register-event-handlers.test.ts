import * as vscode from 'vscode';
import { config } from '../../config';
import { registerEventHandlers } from '../register-event-handlers';

describe('registerEventHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers editor, workspace, and theme listeners', () => {
    const decorator = {
      setActiveEditor: vi.fn(),
      updateDecorationsForSelection: vi.fn(),
      updateDecorationsForDocument: vi.fn(),
      renameFile: vi.fn(),
      updateDiffViewDecorationSetting: vi.fn(),
      recreateGhostFaintDecorationType: vi.fn(),
      recreateFrontmatterDelimiterDecorationType: vi.fn(),
      recreateCodeBlockLanguageDecorationType: vi.fn(),
      recreateColorDependentTypes: vi.fn(),
      clearMathDecorationCache: vi.fn(),
    };
    const linkClickHandler = {
      setEnabled: vi.fn(),
    };

    const disposables = registerEventHandlers(decorator as any, linkClickHandler as any);

    expect(disposables).toHaveLength(10);
  });

  it('routes editor and workspace events to the decorator', () => {
    let activeEditorListener: ((editor: vscode.TextEditor | undefined) => void) | undefined;
    let selectionListener:
      | ((event: { kind: vscode.TextEditorSelectionChangeKind }) => void)
      | undefined;
    let documentChangeListener:
      | ((event: { document: vscode.TextDocument }) => void)
      | undefined;
    let renameListener:
      | ((event: { files: Array<{ oldUri: vscode.Uri; newUri: vscode.Uri }> }) => void)
      | undefined;

    vscode.window.onDidChangeActiveTextEditor = vi.fn((listener) => {
      activeEditorListener = listener;
      return { dispose: vi.fn() };
    }) as any;
    vscode.window.onDidChangeTextEditorSelection = vi.fn((listener) => {
      selectionListener = listener;
      return { dispose: vi.fn() };
    }) as any;
    vscode.workspace.onDidChangeTextDocument = vi.fn((listener) => {
      documentChangeListener = listener;
      return { dispose: vi.fn() };
    }) as any;
    vscode.workspace.onDidRenameFiles = vi.fn((listener) => {
      renameListener = listener;
      return { dispose: vi.fn() };
    }) as any;

    const document = new (vscode.TextDocument as any)(
      vscode.Uri.file('/test.md'),
      'markdown',
      1,
      '# Title'
    );
    const editor = new (vscode.TextEditor as any)(document, []);
    (vscode.window as any).activeTextEditor = editor;

    const decorator = {
      setActiveEditor: vi.fn(),
      updateDecorationsForSelection: vi.fn(),
      updateDecorationsForDocument: vi.fn(),
      renameFile: vi.fn(),
      updateDiffViewDecorationSetting: vi.fn(),
      recreateGhostFaintDecorationType: vi.fn(),
      recreateFrontmatterDelimiterDecorationType: vi.fn(),
      recreateCodeBlockLanguageDecorationType: vi.fn(),
      recreateColorDependentTypes: vi.fn(),
      clearMathDecorationCache: vi.fn(),
      tableCoordinator: { enterTable: vi.fn(() => false) },
    };

    registerEventHandlers(decorator as any, { setEnabled: vi.fn() } as any);

    activeEditorListener?.(editor);
    selectionListener?.({ kind: vscode.TextEditorSelectionChangeKind.Mouse });
    documentChangeListener?.({ document });
    renameListener?.({
      files: [{ oldUri: vscode.Uri.file('/old.md'), newUri: vscode.Uri.file('/new.md') }],
    });

    expect(decorator.setActiveEditor).toHaveBeenCalledWith(editor);
    expect(decorator.updateDecorationsForSelection).toHaveBeenCalledWith(
      vscode.TextEditorSelectionChangeKind.Mouse
    );
    expect(decorator.updateDecorationsForDocument).toHaveBeenCalledWith({ document });
    expect(decorator.renameFile).toHaveBeenCalledWith('file:///old.md', 'file:///new.md');
  });

  it('applies configuration and theme changes', () => {
    let configurationListener:
      | ((event: { affectsConfiguration: (section: string) => boolean }) => void)
      | undefined;
    let themeListener: (() => void) | undefined;

    vscode.workspace.onDidChangeConfiguration = vi.fn((listener) => {
      configurationListener = listener;
      return { dispose: vi.fn() };
    }) as any;
    vscode.window.onDidChangeActiveColorTheme = vi.fn((listener) => {
      themeListener = listener;
      return { dispose: vi.fn() };
    }) as any;

    vi.spyOn(config.diffView, 'applyDecorations').mockReturnValue(false);
    vi.spyOn(config.links, 'singleClickOpen').mockReturnValue(true);

    const decorator = {
      setActiveEditor: vi.fn(),
      updateDecorationsForSelection: vi.fn(),
      updateDecorationsForDocument: vi.fn(),
      renameFile: vi.fn(),
      updateDiffViewDecorationSetting: vi.fn(),
      recreateGhostFaintDecorationType: vi.fn(),
      recreateFrontmatterDelimiterDecorationType: vi.fn(),
      recreateCodeBlockLanguageDecorationType: vi.fn(),
      recreateColorDependentTypes: vi.fn(),
      clearMathDecorationCache: vi.fn(),
    };
    const linkClickHandler = {
      setEnabled: vi.fn(),
    };

    registerEventHandlers(decorator as any, linkClickHandler as any);

    const changedKeys = new Set([
      'markdownInlineEditor.defaultBehaviors.diffView.applyDecorations',
      'markdownInlineEditor.decorations.ghostFaintOpacity',
      'markdownInlineEditor.decorations.frontmatterDelimiterOpacity',
      'markdownInlineEditor.decorations.codeBlockLanguageOpacity',
      'markdownInlineEditor.links.singleClickOpen',
      'markdownInlineEditor.colors',
      'editor.fontSize',
      'editor.lineHeight',
    ]);

    configurationListener?.({
      affectsConfiguration: (section: string) => changedKeys.has(section),
    });
    themeListener?.();

    expect(decorator.updateDiffViewDecorationSetting).toHaveBeenCalledWith(true);
    expect(decorator.updateDecorationsForSelection).toHaveBeenCalled();
    expect(decorator.recreateGhostFaintDecorationType).toHaveBeenCalled();
    expect(decorator.recreateFrontmatterDelimiterDecorationType).toHaveBeenCalled();
    expect(decorator.recreateCodeBlockLanguageDecorationType).toHaveBeenCalled();
    expect(linkClickHandler.setEnabled).toHaveBeenCalledWith(true);
    expect(decorator.recreateColorDependentTypes).toHaveBeenCalledTimes(2);
    expect(decorator.clearMathDecorationCache).toHaveBeenCalledTimes(1);
  });

  it.each(['orderedLists', 'mentions', 'emojis', 'math'])('refreshes cached parsing when %s changes', section => {
    let config_listener: (event: { affectsConfiguration: (key: string) => boolean }) => void;
    vscode.workspace.onDidChangeConfiguration = vi.fn(listener => {
      config_listener = listener;
      return { dispose: vi.fn() };
    }) as any;
    const decorator = { clearCache: vi.fn(), updateDecorationsForSelection: vi.fn() };
    registerEventHandlers(decorator as any, { setEnabled: vi.fn() } as any);
    config_listener!({ affectsConfiguration: key => key === `markdownInlineEditor.${section}` });
    expect(decorator.clearCache).toHaveBeenCalledOnce();
    expect(decorator.updateDecorationsForSelection).toHaveBeenCalledOnce();
  });

  it('redraws a visible editor edited while unfocused, then restores the active editor', () => {
    let change_listener: (event: { document: vscode.TextDocument }) => void;
    vscode.workspace.onDidChangeTextDocument = vi.fn(listener => {
      change_listener = listener;
      return { dispose: vi.fn() };
    }) as any;
    const make_editor = (name: string) => new (vscode.TextEditor as any)(
      new (vscode.TextDocument as any)(vscode.Uri.file(name), 'markdown', 2, '# Title'), []);
    const background_editor = make_editor('/background.md');
    const active_editor = make_editor('/active.md');
    (vscode.window as any).visibleTextEditors = [background_editor, active_editor];
    const decorator = { redrawUnfocused: vi.fn(), updateDecorationsForDocument: vi.fn() };
    registerEventHandlers(decorator as any, { setEnabled: vi.fn() } as any);

    (vscode.window as any).activeTextEditor = active_editor;
    change_listener!({ document: background_editor.document });
    expect(decorator.redrawUnfocused.mock.calls).toEqual([[[background_editor]]]);
    expect(decorator.updateDecorationsForDocument).not.toHaveBeenCalled();
    change_listener!({ document: active_editor.document });
    expect(decorator.updateDecorationsForDocument).toHaveBeenCalledOnce();
    (vscode.window as any).visibleTextEditors = [];
  });

  it('clears an editor whose document stops being markdown and redraws it on change back', () => {
    let open_listener: (document: vscode.TextDocument) => void;
    vscode.workspace.onDidOpenTextDocument = vi.fn(listener => {
      open_listener = listener;
      return { dispose: vi.fn() };
    }) as any;
    const document = new (vscode.TextDocument as any)(vscode.Uri.file('/lang.md'), 'plaintext', 1, '# Title');
    const editor = new (vscode.TextEditor as any)(document, []);
    (vscode.window as any).visibleTextEditors = [editor];
    (vscode.window as any).activeTextEditor = editor;
    const decorator = { clearAllDecorations: vi.fn(), updateDecorationsForSelection: vi.fn() };
    registerEventHandlers(decorator as any, { setEnabled: vi.fn() } as any);

    open_listener!(document);
    expect(decorator.clearAllDecorations).toHaveBeenCalledWith(editor);
    document.languageId = 'markdown';
    open_listener!(document);
    expect(decorator.updateDecorationsForSelection).toHaveBeenCalledOnce();
    (vscode.window as any).visibleTextEditors = [];
  });

  it('redraws markdown editors that show without becoming active', () => {
    let visible_listener: (editors: vscode.TextEditor[]) => void;
    vscode.window.onDidChangeVisibleTextEditors = vi.fn(listener => {
      visible_listener = listener;
      return { dispose: vi.fn() };
    }) as any;
    const make_editor = (name: string, language: string) => new (vscode.TextEditor as any)(
      new (vscode.TextDocument as any)(vscode.Uri.file(name), language, 1, '# Title'), []);
    const active_editor = make_editor('/active.md', 'markdown');
    const shown_editor = make_editor('/shown.md', 'markdown');
    const text_editor = make_editor('/shown.txt', 'plaintext');
    (vscode.window as any).visibleTextEditors = [active_editor];
    (vscode.window as any).activeTextEditor = active_editor;
    const decorator = { redrawUnfocused: vi.fn() };
    registerEventHandlers(decorator as any, { setEnabled: vi.fn() } as any);

    visible_listener!([active_editor, shown_editor, text_editor]);
    expect(decorator.redrawUnfocused.mock.calls).toEqual([[[shown_editor]]]);
    visible_listener!([active_editor, shown_editor]);
    expect(decorator.redrawUnfocused).toHaveBeenCalledOnce();
    (vscode.window as any).visibleTextEditors = [];
  });

  it('drops the cached parse when a document closes', () => {
    let close_listener: (document: vscode.TextDocument) => void;
    vscode.workspace.onDidCloseTextDocument = vi.fn(listener => {
      close_listener = listener;
      return { dispose: vi.fn() };
    }) as any;
    const decorator = { clearCache: vi.fn() };
    registerEventHandlers(decorator as any, { setEnabled: vi.fn() } as any);
    close_listener!(new (vscode.TextDocument as any)(vscode.Uri.file('/closed.md'), 'markdown', 1, ''));
    expect(decorator.clearCache).toHaveBeenCalledWith('file:///closed.md');
  });
});
