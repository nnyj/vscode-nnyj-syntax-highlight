import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Italic Text', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('asterisk italic (*text*)', () => {
    it('should hide markers and style italic text', () => {
      const markdown = '*text*';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 1,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 1,
        endPos: 5,
        type: 'italic'
      });
      expect(result).toContainEqual({
        startPos: 5,
        endPos: 6,
        type: 'hide'
      });
    });
  });

  describe('underscore italic (_text_)', () => {
    it('should hide markers and style italic text', () => {
      const markdown = '_text_';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 1,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 1,
        endPos: 5,
        type: 'italic'
      });
      expect(result).toContainEqual({
        startPos: 5,
        endPos: 6,
        type: 'hide'
      });
    });
  });

  describe('italic at start of line', () => {
    it('should handle italic at line start', () => {
      const markdown = '*italic* text';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'italic' && d.startPos === 1)).toBe(true);
      expect(result.some(d => d.type === 'hide' && d.startPos === 0)).toBe(true);
    });
  });

  describe('italic at end of line', () => {
    it('should handle italic at line end', () => {
      const markdown = 'text *italic*';
      const result = parser.extractDecorations(markdown);
      
      const italicDecorations = result.filter(d => d.type === 'italic');
      expect(italicDecorations.length).toBeGreaterThan(0);
      expect(italicDecorations[0].startPos).toBeGreaterThan(5);
    });
  });

  describe('italic in middle of text', () => {
    it('should handle italic in middle of text', () => {
      const markdown = 'start *italic* end';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'italic')).toBe(true);
      const italicDec = result.find(d => d.type === 'italic');
      expect(italicDec?.startPos).toBeGreaterThan(6);
      expect(italicDec?.endPos).toBeLessThan(15);
    });
  });

  describe('italic with punctuation', () => {
    it('should handle italic with punctuation', () => {
      const markdown = '*italic.*';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'italic')).toBe(true);
      const italicDec = result.find(d => d.type === 'italic');
      expect(italicDec?.startPos).toBe(1);
      expect(italicDec?.endPos).toBe(8); // includes the period
    });
  });

  describe('multiple italic in same line', () => {
    it('should handle multiple italic instances', () => {
      const markdown = '*one* and *two*';
      const result = parser.extractDecorations(markdown);
      
      const italicDecorations = result.filter(d => d.type === 'italic');
      expect(italicDecorations.length).toBe(2);
      
      // First italic: "one"
      expect(italicDecorations[0].startPos).toBe(1);
      expect(italicDecorations[0].endPos).toBe(4);
      
      // Second italic: "two"
      expect(italicDecorations[1].startPos).toBe(11);
      expect(italicDecorations[1].endPos).toBe(14);
    });
  });

  describe('italic spanning word boundary', () => {
    it('should handle italic at word boundary', () => {
      const markdown = '*word*text';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'italic')).toBe(true);
      const italicDec = result.find(d => d.type === 'italic');
      expect(italicDec?.startPos).toBe(1);
      expect(italicDec?.endPos).toBe(5);
    });
  });

  describe('italic inside code blocks', () => {
    it('should NOT parse italic inside fenced code blocks', () => {
      const markdown = '```\n*italic*\n```';
      const result = parser.extractDecorations(markdown);
      
      const italicDecs = result.filter(d => d.type === 'italic');
      expect(italicDecs.length).toBe(0);
    });

    it('should NOT parse italic inside inline code', () => {
      const markdown = '`*italic*`';
      const result = parser.extractDecorations(markdown);
      
      const italicDecs = result.filter(d => d.type === 'italic');
      expect(italicDecs.length).toBe(0);
    });

    it('should still parse italic outside code blocks', () => {
      const markdown = '```\ncode\n```\n*italic*';
      const result = parser.extractDecorations(markdown);
      
      const italicDecs = result.filter(d => d.type === 'italic');
      expect(italicDecs.length).toBe(1);
      expect(italicDecs[0].startPos).toBeGreaterThan(10); // After the code block
    });
  });
});

