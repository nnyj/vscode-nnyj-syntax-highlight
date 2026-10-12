import { describe, it, expect } from 'vitest';
import markdown_it from 'markdown-it';
import { preview_highlight } from './preview_highlight';

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
});
