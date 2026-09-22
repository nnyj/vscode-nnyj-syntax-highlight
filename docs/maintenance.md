# Maintenance

- [README](../README.md) covers features, settings, build commands, installation, and known limitations.

## Ownership

| Path | Responsibility |
|------|----------------|
| `src/extension.js` | Custom styling registration and inline renderer enable/disable |
| `syntaxes/` | TextMate syntax colors |
| `src/indented_table.js` | Table row borders |
| `src/shell_comment.js` | Shell comment colors |
| `src/inline/parser/` | Markdown recognition and normalized decoration offsets |
| `src/inline/decorator/visibility-model.ts` | Rendered, faint, and raw syntax states |
| `src/inline/decorations.ts` | Decoration appearance |
| `src/inline/decorator/decoration-type-registry.ts` | Decoration type ownership and disposal |
| `src/inline/registration/` | Events and providers |
| `src/inline/link-interactions/shared.ts` | Shared link, hover, and click target resolution |

## Parsing and positions

- Selection updates reuse `MarkdownParseCache.get(document)` instead of reparsing unchanged text.
- Cache entries use document URI and version; settings that affect parsing also require invalidation.
- Parser offsets use normalized LF text; convert with `mapNormalizedToOriginal(offset, originalText)` before `document.positionAt()`.
- Keep math rendering behind its content cache; eviction must preserve decorations still visible in the current document.

## Lifecycle

- Inherit `ExtensionContext` with separate subscriptions; spreading the context evaluates getters that can require proposed APIs.
- Disabling inline rendering disposes its providers, commands, decorations, timers, and pending renders.
- Async render results must be ignored after editor changes, disable, or disposal.
- Each `setDecorations()` array must contain only ranges or only decoration options; convert mixed arrays before applying them.

## Mermaid

- Mermaid requires a DOM, supplied by the bundled script in a background webview.
- Wait for the webview's ready message before sending render requests.
- Gantt rendering needs an explicit container width even while the webview is hidden; fixing the SVG viewBox cannot repair broken geometry.
- The hover provider's SVG size cutoff is an extension heuristic, not a guaranteed VS Code API limit.

## Troubleshooting

- Missing decorations: check the document language mode, including for `.txt` files, then the inline master setting and per-file toggle.
- Files outside the workspace can render; diff detection belongs in `diff-context.ts`, not filename substring checks.
- Links use Ctrl+Click or Cmd+Click by default; `markdownInlineEditor.links.singleClickOpen` enables plain clicks.
- Bare issue references need repository context from `origin`; `markdownInlineEditor.mentions.linksEnabled` can disable their links.
- `markdownInlineEditor.debug.logging.enabled` and `markdownInlineEditor.debug.performance.enabled` write to the `Markdown Inline Editor` output channel.

## Verification

- Parser tests use `await MarkdownParser.create()` for the ESM dependencies.
- Position changes need LF and CRLF cases, including a file outside the workspace.
- Decoration changes need rendered, active-line, selection, and toggle checks in real VS Code; mocks cannot verify wrapping or CSS layout.
- Mermaid checks need an actual SVG result, not just a parsed code block.
- Activation checks need master disable/re-enable and disposal, including pending rendering work.
- Keep VS Code mocks faithful to the API, especially context getters, range text, and CRLF offsets.

## Sources

- Adapted from upstream [agent guide](https://github.com/SeardnaSchmid/markdown-inline-editor-vscode/blob/4572a53/AGENTS.md), [contributing guide](https://github.com/SeardnaSchmid/markdown-inline-editor-vscode/blob/4572a53/CONTRIBUTING.md), [FAQ](https://github.com/SeardnaSchmid/markdown-inline-editor-vscode/blob/4572a53/docs/FAQ.md), and architecture notes; checked against this fork's source.
