import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Math regions', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  function getMathRegions(text: string) {
    const result = parser.extractDecorationsWithScopes(text);
    return result.mathRegions;
  }

  describe('inline math', () => {
    it('detects one inline region for $E = mc^2$', () => {
      const regions = getMathRegions('$E = mc^2$');
      expect(regions).toHaveLength(1);
      expect(regions[0]).toEqual({
        startPos: 0,
        endPos: 10,
        source: 'E = mc^2',
        displayMode: false,
      });
    });

    it('detects two inline regions for $x$ and $y$', () => {
      const regions = getMathRegions('$x$ and $y$');
      expect(regions).toHaveLength(2);
      expect(regions[0].source).toBe('x');
      expect(regions[0].displayMode).toBe(false);
      expect(regions[1].source).toBe('y');
      expect(regions[1].displayMode).toBe(false);
    });

    it('allows optional whitespace after opening $ and before closing $; content is trimmed', () => {
      const regions = getMathRegions('$  x$');
      expect(regions).toHaveLength(1);
      expect(regions[0].source).toBe('x');
      expect(regions[0].displayMode).toBe(false);
    });

    it('inline with spaces around content (e.g. integral) is one region with trimmed source', () => {
      const text = '$ f(x)=\\int_{-\\infty}^{\\infty}e^{-x^2}dx $';
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].source).toBe('f(x)=\\int_{-\\infty}^{\\infty}e^{-x^2}dx');
      expect(regions[0].displayMode).toBe(false);
    });

    it('$100$ and $200$ are valid inline (content is digits)', () => {
      const regions = getMathRegions('$100$ and $200$');
      expect(regions).toHaveLength(2);
      expect(regions[0].source).toBe('100');
      expect(regions[1].source).toBe('200');
    });
  });

  describe('block math', () => {
    it('detects one block region for $$...$$', () => {
      const regions = getMathRegions('$$\\int_0^\\infty$$');
      expect(regions).toHaveLength(1);
      expect(regions[0]).toEqual({
        startPos: 0,
        endPos: 17,
        source: '\\int_0^\\infty',
        displayMode: true,
      });
    });

    it('detects two block regions for $$a$$ $$b$$', () => {
      const regions = getMathRegions('$$a$$ $$b$$');
      expect(regions).toHaveLength(2);
      expect(regions[0].source).toBe('a');
      expect(regions[0].displayMode).toBe(true);
      expect(regions[1].source).toBe('b');
      expect(regions[1].displayMode).toBe(true);
    });

    it('whitespace-only between $$ does not create region', () => {
      const regions = getMathRegions('$$   $$');
      expect(regions).toHaveLength(0);
    });

    it('block can span multiple lines', () => {
      const text = '$$\na\n+\nb\n$$';
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].displayMode).toBe(true);
      expect(regions[0].source).toBe('a\n+\nb');
    });

    it('multi-line block has correct position bounds', () => {
      const text = '$$\n\\int_0^\\infty\n$$';
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].startPos).toBe(0);
      expect(regions[0].endPos).toBe(text.length);
    });
  });

  describe('no false positives', () => {
    it('Price is $10 produces no region (single $, no closing $)', () => {
      const regions = getMathRegions('Price is $10');
      expect(regions).toHaveLength(0);
    });

    it('$ 50 produces no region (no closing $)', () => {
      const regions = getMathRegions('$ 50');
      expect(regions).toHaveLength(0);
    });

    it('escaped \\$ does not start math', () => {
      const regions = getMathRegions('\\$x$');
      expect(regions).toHaveLength(0);
    });

    it('Use \\$ for dollars produces no region', () => {
      const regions = getMathRegions('Use \\$ for dollars');
      expect(regions).toHaveLength(0);
    });

    it('empty content between $ $ produces no region', () => {
      const regions = getMathRegions('$ $');
      expect(regions).toHaveLength(0);
    });

    it('single $ with no pair produces no region', () => {
      const regions = getMathRegions('Cost: $50 and nothing else');
      expect(regions).toHaveLength(0);
    });
  });

  describe('position bounds', () => {
    it('positions are 0-based inclusive start, exclusive end', () => {
      const text = 'a $x$ b';
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].startPos).toBe(2);
      expect(regions[0].endPos).toBe(5);
      expect(text.slice(regions[0].startPos, regions[0].endPos)).toBe('$x$');
    });

    it('block positions include opening and closing $$', () => {
      const text = '$$y$$';
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].startPos).toBe(0);
      expect(regions[0].endPos).toBe(5);
      expect(text.slice(regions[0].startPos, regions[0].endPos)).toBe('$$y$$');
    });
  });

  describe('unclosed delimiters', () => {
    it('unclosed inline $ produces no region', () => {
      const regions = getMathRegions('hello $x world');
      expect(regions).toHaveLength(0);
    });

    it('unclosed block $$ produces no region', () => {
      const regions = getMathRegions('$$x\n\n');
      expect(regions).toHaveLength(0);
    });
  });

  describe('precedence', () => {
    it('$$ at start is block first, not two inline', () => {
      const regions = getMathRegions('$$a$$');
      expect(regions).toHaveLength(1);
      expect(regions[0].displayMode).toBe(true);
      expect(regions[0].source).toBe('a');
    });
  });

  describe('math fences', () => {
    it('detects ```math fence body as display math', () => {
      const text = '```math\n\\begin{align}\na&=b\n\\end{align}\n```';
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].displayMode).toBe(true);
      expect(regions[0].source).toBe('\\begin{align}\na&=b\n\\end{align}\n');
      expect(regions[0].numLines).toBe(3);
      expect(text.slice(regions[0].startPos, regions[0].endPos)).toBe(text);
    });

    it('accepts latex and tex fence languages (case and whitespace normalized)', () => {
      const latex = '``` LaTeX \nE = mc^2\n```';
      const tex = '``` tex numbered\nx+y\n```';
      const latexRegions = getMathRegions(latex);
      const texRegions = getMathRegions(tex);

      expect(latexRegions).toHaveLength(1);
      expect(latexRegions[0].displayMode).toBe(true);
      expect(latexRegions[0].source).toBe('E = mc^2\n');
      expect(latexRegions[0].numLines).toBe(1);
      expect(latex.slice(latexRegions[0].startPos, latexRegions[0].endPos)).toBe(latex);

      expect(texRegions).toHaveLength(1);
      expect(texRegions[0].displayMode).toBe(true);
      expect(texRegions[0].source).toBe('x+y\n');
      expect(texRegions[0].numLines).toBe(1);
      expect(tex.slice(texRegions[0].startPos, texRegions[0].endPos)).toBe(tex);
    });

    it('does not treat non-math fence content as math', () => {
      const text = '```js\nconst price = "$100";\nconst eq = "$x$";\n```';
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(0);
    });

    it('keeps delimiter math outside fences unchanged in mixed documents', () => {
      const text = [
        'Outside $x$',
        '```js',
        'const y = "$y$";',
        '```',
        '$$z$$',
        '```math',
        '\\frac{1}{2}',
        '```',
      ].join('\n');

      const regions = getMathRegions(text);
      expect(regions).toHaveLength(3);
      expect(regions[0].source).toBe('x');
      expect(regions[0].displayMode).toBe(false);
      expect(regions[1].source).toBe('z');
      expect(regions[1].displayMode).toBe(true);
      expect(regions[2].source).toBe('\\frac{1}{2}\n');
      expect(regions[2].displayMode).toBe(true);
      expect(regions[2].numLines).toBe(1);
    });

    it('ignores unclosed and whitespace-only math fences', () => {
      const unclosed = '```math\nx+y';
      const whitespaceOnly = '```math\n   \n\t\n```';
      expect(getMathRegions(unclosed)).toHaveLength(0);
      expect(getMathRegions(whitespaceOnly)).toHaveLength(0);
    });

    it('mixed js and math fences: only math fences produce math regions', () => {
      const text = [
        '```js',
        'const a = 1;',
        '```',
        '```math',
        'E=mc^2',
        '```',
        '```javascript',
        '""',
        '```',
      ].join('\n');
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].source).toBe('E=mc^2\n');
      expect(regions[0].displayMode).toBe(true);
    });
  });

  describe('large document (FR-007: no line-count limit)', () => {
    it('detects math regions in a document with >500 lines', () => {
      const lines: string[] = [];
      for (let i = 0; i < 501; i++) {
        lines.push(`Line ${i + 1}`);
      }
      lines[250] = 'With math $E = mc^2$ here';
      const text = lines.join('\n');
      const regions = getMathRegions(text);
      expect(regions).toHaveLength(1);
      expect(regions[0].source).toBe('E = mc^2');
    });
  });
});
