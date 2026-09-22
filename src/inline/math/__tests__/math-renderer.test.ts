import { renderMathToDataUri } from '../math-renderer';

describe('math-renderer', () => {
  describe('valid LaTeX', () => {
    it('returns data URI for valid inline LaTeX', () => {
      const result = renderMathToDataUri('E = mc^2', { displayMode: false });
      expect(result).not.toBeNull();
      expect(result).toMatch(/^data:image\/svg\+xml;/);
    });

    it('applies foregroundColor to SVG so currentColor matches theme', () => {
      const result = renderMathToDataUri('x^2', {
        displayMode: false,
        foregroundColor: '#ff0000',
      });
      expect(result).not.toBeNull();
      expect(result).toMatch(/^data:image\/svg\+xml;base64,/);

      const base64 = result!.split(',', 2)[1];
      const svg = Buffer.from(base64, 'base64').toString('utf8');
      expect(svg).toMatch(/color:\s*#ff0000/i);
    });

    it('returns data URI for valid block LaTeX', () => {
      const result = renderMathToDataUri('\\int_0^\\infty e^{-x^2} dx', { displayMode: true });
      expect(result).not.toBeNull();
      expect(result).toMatch(/^data:image\/svg\+xml;/);
    });

    it('uses displayMode false for inline', () => {
      const result = renderMathToDataUri('x^2', { displayMode: false });
      expect(result).not.toBeNull();
    });

    it('uses displayMode true for block', () => {
      const result = renderMathToDataUri('\\frac{1}{2}', { displayMode: true });
      expect(result).not.toBeNull();
    });

    it('renders block LaTeX with newlines in source', () => {
      const result = renderMathToDataUri('a\n+\nb', { displayMode: true });
      expect(result).not.toBeNull();
    });

    it('renders fenced-body style align environment source', () => {
      const result = renderMathToDataUri('\\begin{align}\na&=b\n\\end{align}\n', {
        displayMode: true,
      });
      expect(result).not.toBeNull();
    });

    it('preserves requested block height in output SVG metadata', () => {
      const result = renderMathToDataUri('\\sum_{n=1}^{\\infty} \\frac{1}{n^2}', {
        displayMode: true,
        height: 60,
      });
      expect(result).not.toBeNull();
      const base64 = result!.split(',', 2)[1];
      const svg = Buffer.from(base64, 'base64').toString('utf8');
      expect(svg).toContain('height="60px"');
    });
  });

  describe('invalid LaTeX', () => {
    it('returns null for invalid LaTeX', () => {
      const result = renderMathToDataUri('\\invalid{', { displayMode: false });
      expect(result).toBeNull();
    });

    it('returns null for invalid fenced-body style LaTeX', () => {
      const result = renderMathToDataUri('\\begin{align}\na&=b', { displayMode: true });
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = renderMathToDataUri('', { displayMode: false });
      expect(result).toBeNull();
    });

    it('trims whitespace and renders valid LaTeX', () => {
      const result = renderMathToDataUri('  E = mc^2  ', { displayMode: false });
      expect(result).not.toBeNull();
    });
  });

  describe('fence body error path', () => {
    it('returns null for fence body with invalid LaTeX (display mode)', () => {
      const result = renderMathToDataUri('\\invalid{', { displayMode: true });
      expect(result).toBeNull();
    });
  });
});
