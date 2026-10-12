import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import markdown_it from 'markdown-it';
import { preview_highlight, css_for_notebook } from './preview_highlight';

const render = text => markdown_it({ breaks: true }).use(preview_highlight).renderInline(text);

describe('preview_highlight', () => {
  it('wraps arrows', () => {
    expect(render('x -> y')).toBe('x <span class="nnyj-arrow">-&gt;</span> y');
  });

  it('colon match starting earlier wins over arrow', () => {
    expect(render('a -> b: c')).toBe('<span class="nnyj-colon">a -&gt; b:</span> c');
  });

  it('skips url colons at line start', () => {
    expect(render('http://x')).toBe('http://x');
  });

  it('wraps brackets around bold', () => {
    expect(render('(a **b**)')).toBe('<span class="nnyj-bracket">(a <strong>b</strong>)</span>');
  });

  it('closes a bracket before its parent tag closes', () => {
    expect(render('**a (b**')).toBe('<strong>a <span class="nnyj-bracket">(b</span></strong>');
  });

  it('wraps comment lines only', () => {
    expect(render('; a: b\nc')).toBe('<span class="nnyj-comment">; a: b</span><br>\nc');
  });

  it('wraps highlight and drops markers', () => {
    expect(render('==hot==')).toBe('<span class="nnyj-highlight">hot</span>');
  });

  it('leaves inline code alone', () => {
    expect(render('`a -> b:`')).toBe('<code>a -&gt; b:</code>');
  });

  it('colors __x__ as highlight like the editor grammar', () => {
    expect(render('__a__ **b**')).toBe('<strong class="nnyj-highlight">a</strong> <strong>b</strong>');
  });
});

describe('preview.css', () => {
  it('matches the README textMateRules colors', () => {
    const css = fs.readFileSync(new URL('../preview/preview.css', import.meta.url), 'utf8');
    const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const rules = [...readme.matchAll(/"scope": "markdown\.(\w+)",\s*"settings": \{ "foreground": "(#\w+)"/g)];
    expect(rules).toHaveLength(5);
    for (const [, name, color] of rules) expect(css).toMatch(new RegExp(`\\.nnyj-${name}[^{]*\\{\\s*color: ${color}`, 'i'));
  });
});

describe('css_for_notebook', () => {
  it('scopes every dark selector to the host theme', () => {
    const css = fs.readFileSync(new URL('../preview/preview.css', import.meta.url), 'utf8');
    const notebook_css = css_for_notebook(css);
    expect(notebook_css).toContain(':host-context(.vscode-dark) strong');
    expect(notebook_css).not.toMatch(/^\.vscode-dark/m);
  });
});
