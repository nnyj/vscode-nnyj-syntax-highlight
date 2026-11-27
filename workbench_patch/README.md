# NNYJ Workbench Patch

Companion for [NNYJ Syntax Highlight](../README.md). With it, standalone images and Mermaid diagrams render at full size in a box below their Markdown lines, pushing text down, and tables render with wrapped cells. Without it, the main extension draws them over the lines.

It wraps the proposed `editorInsets` API, which the Marketplace rejects, so it ships as a vsix. On the first start of each new VS Code or extension version it runs `vscode_workbench_patch.js` on the running install, then asks to quit and reopen.

## Setup

- Install `nnyj-workbench-patch-*.vsix` from the GitHub release, or run `npm run install:patch`.
- `Preferences: Configure Runtime Arguments` opens `argv.json`, add `"enable-proposed-api": ["nnyj.nnyj-workbench-patch"]`.
- Fully quit and reopen VS Code.
- WSL and other remote windows: both extensions run on the Windows side, install them there, not in WSL.

## Workbench patch

- `vscode_workbench_patch.js` patches the workbench bundle: inset scroll, table no-wrap, inset resize. Inset resize also hides the table rows below a table inset.
- Run by hand: `node vscode_workbench_patch.js [install dir]`, then quit and reopen VS Code.
- Restore: copy the `.bak` files over `workbench.desktop.main.js` and `product.json`.

## Inset check

- `python inset_check/inset_check.py` runs 42 checks in a VS Code instance on a hidden desktop, Windows only, needs `playwright`.
- Build `dist/` first. `--code-exe` runs a copied install instead of the user install.
