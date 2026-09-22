import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Bold-Italic Text', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('asterisk bold-italic (***text***)', () => {
    it('should detect nested emphasis and create boldItalic', () => {
      const markdown = '***text***';
      const result = parser.extractDecorations(markdown);
      
      // Should have hide decorations for markers
      expect(result.some(d => d.type === 'hide')).toBe(true);
      
      // Should have boldItalic decoration for the text
      const boldItalicDec = result.find(d => d.type === 'boldItalic');
      expect(boldItalicDec).toBeDefined();
      expect(boldItalicDec?.startPos).toBeGreaterThan(0);
      expect(boldItalicDec?.endPos).toBeLessThan(markdown.length);
    });
  });

  describe('underscore bold-italic (___text___)', () => {
    it('should detect nested emphasis with underscores', () => {
      const markdown = '___text___';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'hide')).toBe(true);
      const boldItalicDec = result.find(d => d.type === 'boldItalic');
      expect(boldItalicDec).toBeDefined();
    });
  });

  describe('bold-italic at start of line', () => {
    it('should handle bold-italic at line start', () => {
      const markdown = '***bold-italic*** text';
      const result = parser.extractDecorations(markdown);
      
      const boldItalicDec = result.find(d => d.type === 'boldItalic');
      expect(boldItalicDec).toBeDefined();
      expect(boldItalicDec?.startPos).toBeGreaterThan(0);
    });
  });

  describe('bold-italic at end of line', () => {
    it('should handle bold-italic at line end', () => {
      const markdown = 'text ***bold-italic***';
      const result = parser.extractDecorations(markdown);
      
      const boldItalicDec = result.find(d => d.type === 'boldItalic');
      expect(boldItalicDec).toBeDefined();
      expect(boldItalicDec?.startPos).toBeGreaterThan(5);
    });
  });

  describe('bold-italic in middle of text', () => {
    it('should handle bold-italic in middle of text', () => {
      const markdown = 'start ***bold-italic*** end';
      const result = parser.extractDecorations(markdown);
      
      const boldItalicDec = result.find(d => d.type === 'boldItalic');
      expect(boldItalicDec).toBeDefined();
      expect(boldItalicDec?.startPos).toBeGreaterThan(6);
      expect(boldItalicDec?.endPos).toBeLessThan(25);
    });
  });

  describe('bold containing italic', () => {
    it('should create boldItalic for italic part inside bold', () => {
      const markdown = '**bold *italic* bold**';
      const result = parser.extractDecorations(markdown);
      
      // Should have bold decoration for the whole bold section
      const boldDec = result.find(d => d.type === 'bold');
      expect(boldDec).toBeDefined();
      
      // Should have boldItalic for the italic part
      const boldItalicDec = result.find(d => d.type === 'boldItalic');
      expect(boldItalicDec).toBeDefined();
      
      // The italic part should be styled as boldItalic
      expect(boldItalicDec?.startPos).toBeGreaterThan(7);
      expect(boldItalicDec?.endPos).toBeLessThanOrEqual(14);
    });
  });

  describe('italic containing bold', () => {
    it('should create boldItalic for bold part inside italic', () => {
      const markdown = '*italic **bold** italic*';
      const result = parser.extractDecorations(markdown);
      
      // Should have italic decoration for the whole italic section
      const italicDec = result.find(d => d.type === 'italic');
      expect(italicDec).toBeDefined();
      
      // Should have boldItalic for the bold part
      const boldItalicDec = result.find(d => d.type === 'boldItalic');
      expect(boldItalicDec).toBeDefined();
      
      // The bold part should be styled as boldItalic
      expect(boldItalicDec?.startPos).toBeGreaterThan(8);
      expect(boldItalicDec?.endPos).toBeLessThanOrEqual(14);
    });
  });
});

