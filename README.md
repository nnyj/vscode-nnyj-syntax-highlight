# NNYJ Syntax Highlight

Custom TextMate grammar injections for VS Code.

## Markdown Injections

| Grammar | What it highlights |
|---|---|
| `markdown.arrow` | Arrow operators (`->`, `<-`, `-->`, `<--`) |
| `markdown.bracket` | Parenthesized expressions `(...)` |
| `markdown.colon` | Colon-terminated labels and key-value patterns |
| `markdown.comment` | Lines starting with `;` or `//` |
| `markdown.highlight` | `==highlighted==` and `__underlined__` text |

## Terraform HCL Injection

| Grammar | What it highlights |
|---|---|
| `yaml.heredoc.hcl` | YAML syntax inside `<<YAML` / `<<-YAML` heredoc blocks |

## Install

```sh
npm run package
code --install-extension nnyj-syntax-highlight-0.0.1.vsix
```

## Customizing Colors

Add `editor.tokenColorCustomizations` to your `settings.json`:

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": "markdown.highlight",
        "settings": { "foreground": "#e2c08d" }
      },
      {
        "scope": "markdown.comment",
        "settings": { "foreground": "#6a9955" }
      }
    ]
  }
}
```
