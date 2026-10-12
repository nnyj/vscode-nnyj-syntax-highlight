import { preview_highlight, css_for_notebook } from './preview_highlight';
import preview_css from '../preview/preview.css';

export async function activate(ctx) {
  const markdown_renderer = await ctx.getRenderer('vscode.markdown-it-renderer');
  if (!markdown_renderer) throw new Error("Could not load 'vscode.markdown-it-renderer'");
  // Add styles first, each cell copies markdown-style nodes once when created.
  const style = document.createElement('style');
  style.textContent = css_for_notebook(preview_css);
  const template = document.createElement('template');
  template.classList.add('markdown-style');
  template.content.appendChild(style);
  document.head.appendChild(template);
  markdown_renderer.extendMarkdownIt(md => md.use(preview_highlight));
}
