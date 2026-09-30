# NNYJ Inset Helper

Companion for [NNYJ Syntax Highlight](../README.md). With it, standalone images and Mermaid diagrams render at full size in a box below their Markdown lines, pushing text down. Without it, the main extension draws them over the lines.

It only wraps the proposed `editorInsets` API, which the Marketplace rejects, so it ships as a vsix.

## Setup

- Install `nnyj-inset-helper-*.vsix` from the GitHub release or `npm run package:helper`.
- `Preferences: Configure Runtime Arguments` opens `argv.json`, add `"enable-proposed-api": ["nnyj.nnyj-inset-helper"]`.
- Fully quit and reopen VS Code.
