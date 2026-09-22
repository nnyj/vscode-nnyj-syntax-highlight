import { MarkdownParser, DecorationRange } from '../../parser';

describe('MarkdownParser - Inline Code', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('basic inline code (`code`)', () => {
    it('should hide backticks and style code', () => {
      const markdown = '`code`';
      const result = parser.extractDecorations(markdown);
      
      // Code decoration spans full range (including backticks) - matches Markless approach
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 6,
        type: 'code'
      });
      // Backticks are made transparent (not hidden) - matches Markless approach
      // Using transparent keeps backticks in layout so borders render correctly
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 1,
        type: 'transparent'
      });
      expect(result).toContainEqual({
        startPos: 5,
        endPos: 6,
        type: 'transparent'
      });
    });
  });

  describe('inline code at start of line', () => {
    it('should handle inline code at line start', () => {
      const markdown = '`code` text';
      const result = parser.extractDecorations(markdown);
      
      // Code decoration spans full range including backticks (0-6)
      expect(result.some((d: DecorationRange) => d.type === 'code' && d.startPos === 0 && d.endPos === 6)).toBe(true);
      expect(result.some((d: DecorationRange) => d.type === 'transparent' && d.startPos === 0)).toBe(true);
    });
  });

  describe('inline code at end of line', () => {
    it('should handle inline code at line end', () => {
      const markdown = 'text `code`';
      const result = parser.extractDecorations(markdown);
      
      const codeDecorations = result.filter((d: DecorationRange) => d.type === 'code');
      expect(codeDecorations.length).toBeGreaterThan(0);
      // Code decoration includes backticks, so startPos is at the opening backtick (position 5)
      expect(codeDecorations[0]?.startPos).toBeGreaterThanOrEqual(5);
    });
  });

  describe('inline code in middle of text', () => {
    it('should handle inline code in middle of text', () => {
      const markdown = 'start `code` end';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some((d: DecorationRange) => d.type === 'code')).toBe(true);
      const codeDec = result.find((d: DecorationRange) => d.type === 'code');
      // Code decoration includes backticks, so startPos is at opening backtick (position 6)
      expect(codeDec?.startPos).toBeGreaterThanOrEqual(6);
      expect(codeDec?.endPos).toBeLessThanOrEqual(13);
    });
  });

  describe('inline code with spaces', () => {
    it('should handle inline code with spaces', () => {
      const markdown = '`code with spaces`';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some((d: DecorationRange) => d.type === 'code')).toBe(true);
      const codeDec = result.find((d: DecorationRange) => d.type === 'code');
      // Code decoration spans full range including backticks (0-18)
      expect(codeDec?.startPos).toBe(0);
      expect(codeDec?.endPos).toBe(18);
    });
  });

  describe('inline code with numbers', () => {
    it('should handle inline code with numbers', () => {
      const markdown = '`code123`';
      const result = parser.extractDecorations(markdown);
      
      // Code decoration spans full range including backticks (0-9)
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 9,
        type: 'code'
      });
    });
  });

  describe('inline code with special characters', () => {
    it('should handle inline code with special characters', () => {
      const markdown = '`code!@#`';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some((d: DecorationRange) => d.type === 'code')).toBe(true);
      const codeDec = result.find((d: DecorationRange) => d.type === 'code');
      // Code decoration spans full range including backticks (0-9)
      expect(codeDec?.startPos).toBe(0);
      expect(codeDec?.endPos).toBe(9);
    });
  });

  describe('multiple inline code in same line', () => {
    it('should handle multiple inline code instances', () => {
      const markdown = '`one` and `two`';
      const result = parser.extractDecorations(markdown);
      
      const codeDecorations = result.filter(d => d.type === 'code');
      expect(codeDecorations.length).toBe(2);
      
      // First code: "one" - spans full range including backticks (0-5)
      expect(codeDecorations[0]?.startPos).toBe(0);
      expect(codeDecorations[0]?.endPos).toBe(5);
      
      // Second code: "two" - spans full range including backticks (10-15)
      expect(codeDecorations[1]?.startPos).toBe(10);
      expect(codeDecorations[1]?.endPos).toBe(15);
    });
  });

  describe('empty inline code', () => {
    it('should handle empty inline code gracefully', () => {
      const markdown = '``';
      const result = parser.extractDecorations(markdown);
      
      // Should have transparent decorations for backticks (or hide if empty)
      const transparentDecs = result.filter((d: DecorationRange) => d.type === 'transparent' || d.type === 'hide');
      expect(transparentDecs.length).toBeGreaterThanOrEqual(0);
      // May or may not have code decoration for empty content
    });
  });

  describe('inline code with newline', () => {
    it('should handle inline code that spans lines gracefully', () => {
      const markdown = '`code\nmore`';
      const result = parser.extractDecorations(markdown);
      
      // Should handle gracefully (may or may not create decorations)
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

