import { MarkdownParser, DecorationRange } from '../../parser';

describe('MarkdownParser - Bold Text', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('asterisk bold (**text**)', () => {
    it('should hide markers and style bold text', () => {
      // Test with paragraph context (markdown-it needs paragraph for inline formatting)
      const markdown = 'Paragraph with **text** in it.';
      const result = parser.extractDecorations(markdown);
      
      expect(result.length).toBeGreaterThan(0);
      
      // Should have hide decorations for markers
      const hideDecs = result.filter((d: DecorationRange) => d.type === 'hide');
      expect(hideDecs.length).toBeGreaterThanOrEqual(2); // Opening and closing markers
      
      // Should have bold decoration for text
      const boldDecs = result.filter((d: DecorationRange) => d.type === 'bold');
      expect(boldDecs.length).toBeGreaterThanOrEqual(1);
      
      // Verify the bold text is correctly positioned
      const boldDec = boldDecs[0];
      expect(boldDec).toBeDefined();
      if (boldDec) {
        expect(boldDec.startPos).toBeGreaterThan(0);
        expect(boldDec.endPos).toBeLessThan(markdown.length);
        expect(boldDec.endPos).toBeGreaterThan(boldDec.startPos);
      }
      
      // Verify positions are valid
      result.forEach((dec: DecorationRange) => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });
  });

  describe('underscore bold (__text__)', () => {
    it('should hide markers and style bold text', () => {
      const markdown = '__text__';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 2,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 2,
        endPos: 6,
        type: 'bold'
      });
      expect(result).toContainEqual({
        startPos: 6,
        endPos: 8,
        type: 'hide'
      });
    });
  });

  describe('bold at start of line', () => {
    it('should handle bold at line start', () => {
      const markdown = '**bold** text';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold' && d.startPos === 2)).toBe(true);
      expect(result.some(d => d.type === 'hide' && d.startPos === 0)).toBe(true);
    });
  });

  describe('bold at end of line', () => {
    it('should handle bold at line end', () => {
      const markdown = 'text **bold**';
      const result = parser.extractDecorations(markdown);
      
      const boldDecorations = result.filter(d => d.type === 'bold');
      expect(boldDecorations.length).toBeGreaterThan(0);
      expect(boldDecorations[0]?.startPos).toBeGreaterThan(5);
    });
  });

  describe('bold in middle of text', () => {
    it('should handle bold in middle of text', () => {
      const markdown = 'start **bold** end';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold')).toBe(true);
      const boldDec = result.find(d => d.type === 'bold');
      expect(boldDec?.startPos).toBeGreaterThan(6);
      expect(boldDec?.endPos).toBeLessThan(16);
    });
  });

  describe('bold with punctuation', () => {
    it('should handle bold with punctuation', () => {
      const markdown = '**bold.**';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold')).toBe(true);
      const boldDec = result.find(d => d.type === 'bold');
      expect(boldDec?.startPos).toBe(2);
      expect(boldDec?.endPos).toBe(7); // includes the period
    });
  });

  describe('bold with numbers', () => {
    it('should handle bold with numbers', () => {
      const markdown = '**123**';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 2,
        endPos: 5,
        type: 'bold'
      });
    });
  });

  describe('bold with special characters', () => {
    it('should handle bold with special characters', () => {
      const markdown = '**text!@#**';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold')).toBe(true);
      const boldDec = result.find(d => d.type === 'bold');
      expect(boldDec?.startPos).toBe(2);
      expect(boldDec?.endPos).toBe(9); // "text!@#" is 7 chars: positions 2-8, endPos is exclusive
    });
  });

  describe('multiple bold in same line', () => {
    it('should handle multiple bold instances', () => {
      const markdown = '**one** and **two**';
      const result = parser.extractDecorations(markdown);
      
      const boldDecorations = result.filter(d => d.type === 'bold');
      expect(boldDecorations.length).toBe(2);
      
      // First bold: "one"
      expect(boldDecorations[0]?.startPos).toBe(2);
      expect(boldDecorations[0]?.endPos).toBe(5);
      
      // Second bold: "two"
      expect(boldDecorations[1]?.startPos).toBe(14);
      expect(boldDecorations[1]?.endPos).toBe(17);
    });
  });

  describe('bold spanning word boundary', () => {
    it('should handle bold at word boundary', () => {
      const markdown = '**word**text';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold')).toBe(true);
      const boldDec = result.find(d => d.type === 'bold');
      expect(boldDec?.startPos).toBe(2);
      expect(boldDec?.endPos).toBe(6);
    });
  });

  describe('bold inside code blocks', () => {
    it('should NOT parse bold inside fenced code blocks', () => {
      const markdown = '```\n**bold**\n```';
      const result = parser.extractDecorations(markdown);
      
      const boldDecs = result.filter(d => d.type === 'bold');
      expect(boldDecs.length).toBe(0);
    });

    it('should NOT parse bold inside inline code', () => {
      const markdown = '`**bold**`';
      const result = parser.extractDecorations(markdown);
      
      const boldDecs = result.filter(d => d.type === 'bold');
      expect(boldDecs.length).toBe(0);
    });

    it('should still parse bold outside code blocks', () => {
      const markdown = '```\ncode\n```\n**bold**';
      const result = parser.extractDecorations(markdown);
      
      const boldDecs = result.filter(d => d.type === 'bold');
      expect(boldDecs.length).toBe(1);
      expect(boldDecs[0].startPos).toBeGreaterThan(10); // After the code block
    });
  });
});

