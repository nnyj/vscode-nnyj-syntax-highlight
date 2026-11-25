# Maintenance

- [README](../README.md) covers features, settings, build commands, installation, and known limitations.

## Change rules

- **Small surface:**
  - Fix by removing state first. A new per-editor map, timer or retry needs a reason in its comment.
  - Each fact has one owner. The workbench patch owns hidden rows, the extension owns what renders.
  - Never derive render state from `visibleRanges`. A render moves the viewport, which loops.

- **Fallback:**
  - Patched workbench is the main path. Without it, plain decorations, no new workarounds for unpatched builds.
  - Running workbench without the current patch marker: tables use decorations, see `workbenchHidesRows`.

- **Workbench patch:**
  - Changed `vscode_workbench_patch.js`: bump `workbench_patch/package.json` version, the extension reruns the script on it.
  - Anchors match exactly once, the script fails on 0 or 2 matches.

- **Checks:**
  - Each inset bug fix adds an `inset_check.py` scenario that fails on the old code.
  - Do not add tests that only check mocks.

## Ownership

| Path                                               | Responsibility                                                 |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `src/extension.js`                                 | Custom styling registration and inline renderer enable/disable |
| `syntaxes/`                                        | TextMate syntax colors                                         |
| `src/indented_table.js`                            | Table row borders                                              |
| `src/shell_comment.js`                             | Shell comment colors                                           |
| `src/preview_highlight.js`, `preview/preview.css`  | Markdown preview colors                                        |
| `src/notebook_preview.js`                          | Notebook Markdown cell colors                                  |
| `src/inline/parser/`                               | Markdown recognition and normalized decoration offsets         |
| `src/inline/decorator/visibility-model.ts`         | Rendered, faint, and raw syntax states                         |
| `src/inline/decorations.ts`                        | Decoration appearance                                          |
| `src/inline/decorator/decoration-type-registry.ts` | Decoration type ownership and disposal                         |
| `src/inline/registration/`                         | Events and providers                                           |
| `src/inline/link-interactions/shared.ts`           | Shared link, hover, and click target resolution                |

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

## Insets

- `src/inline/decorator/editor_insets.ts` creates insets through `nnyj.nnyj-workbench-patch` (`workbench_patch/`), the only package declaring `enabledApiProposals`.
- Workbench patch extension missing, or `argv.json` lacking `"enable-proposed-api": ["nnyj.nnyj-workbench-patch"]`: renderers fall back to decorations.
- Inset lifecycle:
  - Keys hold the line. VS Code moves a zone on edits above, then puts it back at its creation line on the next fold or wrap change.
  - A new or closed editor group can reparent an editor's DOM. Its inset iframes reload blank, VS Code does not resend the html.
  - `EditorInsets` pings each inset every second and recreates an inset that misses 2 pings.
  - An inset disposed by VS Code triggers one more render per key while its editor shows.
  - A wheel gesture stays routed to the inset iframe after it scrolls away from the pointer. Insets forward wheel events, which stalls.

- Table rows:
  - The inset html holds `data-zone-rows`, `zone_bridge` hides the rows with `setHiddenAreas` under the source `nnyj-table-rows`. Every editor, background and split ones too, hides its own.
  - VS Code merges the sources, folds keep their own. VS Code keeps a source's ranges unmoved on edits, so `zone_bridge` resets them from model decorations on every content change.
  - A model flush drops the hidden areas, `zone_bridge` sets them again with `force`.
  - A disposed zone's rows show on the next frame, so a zone replaced in the same frame, e.g. after an edit above, leaves no gap. A cursor in the shown rows is revealed.
  - VS Code keeps the scroll top when a zone above the viewport is added, resized or removed. `zone_bridge` scrolls along, so the text stays.
  - VS Code leaves a cursor in hidden rows, e.g. set by Ctrl+G or Find. A selection with both ends in a table shows its source.
  - Tables render as insets only when the running workbench holds the `nnyj-table-rows` marker, read once at activation.

- Background editors render through `Decorator.redrawUnfocused`. Mermaid render tokens are per editor, so these renders keep the active editor's render.
- Mermaid decorations use one SVG slice per code block line, a single tall image vanishes once its first line scrolls off.

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
