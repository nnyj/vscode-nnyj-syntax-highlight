// Markdown preview spans mirroring the syntaxes/markdown.*.json injections.
// Earliest match wins, ties go to the first rule, like TextMate injections.
const rules = [
  { name: 'arrow', re: /-*>|<-*/g },
  { name: 'bracket_open', re: /\(/g },
  { name: 'bracket_close', re: /\)/g },
  { name: 'colon', re: /^[^|[\]:=*]+:(?!\\)(?!\/)/g, line_start: true },
  { name: 'colon', re: /[^`'"|:=*]*:(?=\s|$)/g },
  { name: 'highlight', re: /==(?=\S)(.*?\S)==/g },
];
const comment_re = /^(;|\/\/)/;

function find_next(text, pos, at_line_start) {
  let best;
  for (const rule of rules) {
    if (rule.line_start && !(pos === 0 && at_line_start)) continue;
    rule.re.lastIndex = pos;
    const match = rule.re.exec(text);
    if (match && (!best || match.index < best.match.index)) best = { rule, match };
  }
  return best;
}

function preview_highlight(md) {
  md.core.ruler.push('nnyj_preview_highlight', state => {
    for (const block of state.tokens) {
      if (block.type === 'inline' && block.children) block.children = wrap_children(state, block.children);
    }
  });
}

function wrap_children(state, children) {
  const out = [];
  const bracket_levels = [];
  let level = 0;
  let line_start = true;
  let comment_open = false;

  const push_text = content => {
    if (!content) return;
    const token = new state.Token('text', '', 0);
    token.content = content;
    out.push(token);
  };
  const push_html = content => {
    const token = new state.Token('html_inline', '', 0);
    token.content = content;
    out.push(token);
  };
  const push_span = (name, content) => {
    push_html(`<span class="nnyj-${name}">`);
    push_text(content);
    push_html('</span>');
  };
  const close_comment = () => {
    if (comment_open) push_html('</span>');
    comment_open = false;
  };

  const scan = (text, at_line_start) => {
    let pos = 0;
    while (pos < text.length) {
      const next = find_next(text, pos, at_line_start);
      if (!next) break;
      const { rule, match } = next;
      push_text(text.slice(pos, match.index));
      if (rule.name === 'bracket_open') {
        push_html('<span class="nnyj-bracket">');
        push_text('(');
        bracket_levels.push(level);
      } else if (rule.name === 'bracket_close') {
        push_text(')');
        if (bracket_levels.at(-1) === level) {
          bracket_levels.pop();
          push_html('</span>');
        }
      } else if (rule.name === 'highlight') {
        push_html('<span class="nnyj-highlight">');
        scan(match[1], false);
        push_html('</span>');
      } else {
        push_span(rule.name, match[0]);
      }
      pos = match.index + match[0].length;
    }
    push_text(text.slice(pos));
  };

  for (const child of children) {
    if (child.type === 'softbreak' || child.type === 'hardbreak') {
      close_comment();
      out.push(child);
      line_start = true;
      continue;
    }
    if (child.type === 'text' && !comment_open && line_start && comment_re.test(child.content)) {
      push_html('<span class="nnyj-comment">');
      comment_open = true;
    }
    if (child.type === 'text' && !comment_open) {
      scan(child.content, line_start);
    } else {
      // Close brackets opened inside a tag before that tag closes.
      if (child.nesting < 0) {
        while (bracket_levels.length && bracket_levels.at(-1) >= level) {
          bracket_levels.pop();
          push_html('</span>');
        }
      }
      out.push(child);
      level += child.nesting;
    }
    line_start = false;
  }
  for (const _ of bracket_levels) push_html('</span>');
  close_comment();
  return out;
}

// Notebook cells render in a shadow root, so the body theme class needs :host-context.
function css_for_notebook(css) {
  return css.replace(/^\.vscode-dark /gm, ':host-context(.vscode-dark) ');
}

module.exports = { preview_highlight, css_for_notebook };
