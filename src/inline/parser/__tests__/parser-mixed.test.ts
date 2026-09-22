import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Mixed Features', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('bold and italic on same line (separate)', () => {
    it('should handle bold and italic as separate features', () => {
      const markdown = '**bold** and *italic*';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'italic')).toBe(true);
      
      const boldDec = result.find(d => d.type === 'bold');
      const italicDec = result.find(d => d.type === 'italic');
      
      expect(boldDec?.startPos).toBeLessThan(italicDec?.startPos || Infinity);
    });
  });

  describe('bold and code on same line', () => {
    it('should handle bold and inline code together', () => {
      const markdown = '**bold** and `code`';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'code')).toBe(true);
    });
  });

  describe('heading and bold', () => {
    it('should handle heading with bold text', () => {
      const markdown = '# Heading with **bold**';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'bold')).toBe(true);
      
      const headingDec = result.find(d => d.type === 'heading1');
      const boldDec = result.find(d => d.type === 'bold');
      
      expect(headingDec?.startPos).toBeLessThan(boldDec?.startPos || Infinity);
    });
  });

  describe('multiple different features in one line', () => {
    it('should handle multiple different features', () => {
      const markdown = '# Heading **bold** *italic* `code`';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'italic')).toBe(true);
      expect(result.some(d => d.type === 'code')).toBe(true);
    });
  });

  describe('features across multiple lines', () => {
    it('should handle features across multiple lines', () => {
      const markdown = '# Heading\n**bold** text\n*italic* text';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'italic')).toBe(true);
    });
  });

  describe('heading with link', () => {
    it('should handle heading containing link', () => {
      const markdown = '# Heading with [link](url)';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'link')).toBe(true);
    });
  });

  describe('bold with strikethrough', () => {
    it('should handle bold and strikethrough together', () => {
      const markdown = '**bold** and ~~strikethrough~~';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'strikethrough')).toBe(true);
    });
  });
});

