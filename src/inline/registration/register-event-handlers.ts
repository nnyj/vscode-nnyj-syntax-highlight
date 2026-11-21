import * as vscode from 'vscode';
import { config } from '../config';
import { Decorator } from '../decorator';
import { LinkClickHandler } from '../link-click-handler';
import { isSupportedMarkdownLanguage } from '../language-support';

export function registerEventHandlers(
  decorator: Decorator,
  linkClickHandler: LinkClickHandler
): vscode.Disposable[] {
  let visibleEditors = new Set(vscode.window.visibleTextEditors);
  return [
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      decorator.setActiveEditor(editor);
    }),
    // A markdown editor can show without ever becoming active, e.g. once a webview tab above it moves away
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      const shown = editors.filter(editor => !visibleEditors.has(editor) && editor !== vscode.window.activeTextEditor &&
        isSupportedMarkdownLanguage(editor.document.languageId));
      visibleEditors = new Set(editors);
      if (shown.length > 0) {
        decorator.redrawUnfocused(shown);
      }
    }),
    // Re-renders insets, see EditorInsets.sync
    vscode.window.onDidChangeTextEditorViewColumn(() => {
      decorator.updateDecorationsForSelection();
    }),
    // Fires on fold and unfold too, see TableUpdateCoordinator.refold
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      // An external write unfolds table rows after its document change event
      if (event.textEditor !== vscode.window.activeTextEditor && decorator.tableCoordinator.rowsShownChanged(event.textEditor)) {
        decorator.redrawUnfocused([event.textEditor]);
      }
      decorator.tableCoordinator.refold(event.textEditor);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (decorator.tableCoordinator.enterTable(event)) {
        return;
      }
      decorator.updateDecorationsForSelection(event.kind);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      decorator.tableCoordinator.documentChanged(event);
      // Debounced, then redraws the document's other editors too
      if (event.document === vscode.window.activeTextEditor?.document) {
        decorator.updateDecorationsForDocument(event);
        return;
      }
      // Unfocused edits, e.g. by an agent, would leave VS Code shifting the old ranges into wrong text
      const editors = vscode.window.visibleTextEditors.filter(editor => editor.document === event.document);
      if (editors.length > 0) {
        decorator.redrawUnfocused(editors);
      }
    }),
    // A reopened document restarts at version 1, so a cached parse of the old text would match
    vscode.workspace.onDidCloseTextDocument((document) => {
      decorator.clearCache(document.uri.toString());
    }),
    // Fires on a language change too, the decorator skips non-markdown documents
    vscode.workspace.onDidOpenTextDocument((document) => {
      for (const editor of vscode.window.visibleTextEditors.filter(visible => visible.document === document)) {
        if (!isSupportedMarkdownLanguage(document.languageId)) {
          decorator.clearAllDecorations(editor);
        } else if (editor === vscode.window.activeTextEditor) {
          decorator.updateDecorationsForSelection();
        } else {
          decorator.redrawUnfocused([editor]);
        }
      }
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      for (const { oldUri, newUri } of event.files) {
        decorator.renameFile(oldUri.toString(), newUri.toString());
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (['orderedLists', 'mentions', 'emojis', 'math'].some(section =>
        event.affectsConfiguration(`markdownInlineEditor.${section}`))) {
        decorator.clearCache();
        decorator.updateDecorationsForSelection();
      }
      if (event.affectsConfiguration('markdownInlineEditor.defaultBehaviors.diffView.applyDecorations')) {
        const diffViewApplyDecorations = config.diffView.applyDecorations();
        decorator.updateDiffViewDecorationSetting(!diffViewApplyDecorations);
        decorator.updateDecorationsForSelection();
      }

      if (event.affectsConfiguration('markdownInlineEditor.decorations.ghostFaintOpacity')) {
        decorator.recreateGhostFaintDecorationType();
      }

      if (event.affectsConfiguration('markdownInlineEditor.decorations.frontmatterDelimiterOpacity')) {
        decorator.recreateFrontmatterDelimiterDecorationType();
      }

      if (event.affectsConfiguration('markdownInlineEditor.decorations.codeBlockLanguageOpacity')) {
        decorator.recreateCodeBlockLanguageDecorationType();
      }

      if (event.affectsConfiguration('markdownInlineEditor.links.singleClickOpen')) {
        linkClickHandler.setEnabled(config.links.singleClickOpen());
      }

      if (event.affectsConfiguration('markdownInlineEditor.links.showEmoji')) {
        decorator.recreateLinkDecorationType();
      }

      if (event.affectsConfiguration('markdownInlineEditor.colors')) {
        decorator.recreateColorDependentTypes();
      }

      // Tables render only with provider folding, see TableUpdateCoordinator.getRenderedTables
      if (event.affectsConfiguration('editor.folding') || event.affectsConfiguration('editor.foldingStrategy')) {
        decorator.updateDecorationsForSelection();
      }

      if (event.affectsConfiguration('editor.fontSize') || event.affectsConfiguration('editor.fontFamily') ||
        event.affectsConfiguration('editor.lineHeight')) {
        decorator.clearMathDecorationCache();
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      decorator.recreateColorDependentTypes();
    }),
  ];
}
