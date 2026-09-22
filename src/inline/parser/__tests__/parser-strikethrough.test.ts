import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Strikethrough Text', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('basic strikethrough (~~text~~)', () => {
    it('should hide markers and style strikethrough text', () => {
      const markdown = '~~text~~';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 2,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 2,
        endPos: 6,
        type: 'strikethrough'
      });
      expect(result).toContainEqual({
        startPos: 6,
        endPos: 8,
        type: 'hide'
      });
    });
  });

  describe('strikethrough at start of line', () => {
    it('should handle strikethrough at line start', () => {
      const markdown = '~~strikethrough~~ text';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'strikethrough' && d.startPos === 2)).toBe(true);
      expect(result.some(d => d.type === 'hide' && d.startPos === 0)).toBe(true);
    });
  });

  describe('strikethrough at end of line', () => {
    it('should handle strikethrough at line end', () => {
      const markdown = 'text ~~strikethrough~~';
      const result = parser.extractDecorations(markdown);
      
      const strikethroughDecorations = result.filter(d => d.type === 'strikethrough');
      expect(strikethroughDecorations.length).toBeGreaterThan(0);
      expect(strikethroughDecorations[0].startPos).toBeGreaterThan(5);
    });
  });

  describe('strikethrough in middle of text', () => {
    it('should handle strikethrough in middle of text', () => {
      const markdown = 'start ~~strikethrough~~ end';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'strikethrough')).toBe(true);
      const strikeDec = result.find(d => d.type === 'strikethrough');
      expect(strikeDec?.startPos).toBeGreaterThan(6);
      expect(strikeDec?.endPos).toBeLessThan(25);
    });
  });

  describe('strikethrough with punctuation', () => {
    it('should handle strikethrough with punctuation', () => {
      const markdown = '~~strikethrough.~~';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'strikethrough')).toBe(true);
      const strikeDec = result.find(d => d.type === 'strikethrough');
      expect(strikeDec?.startPos).toBe(2);
      expect(strikeDec?.endPos).toBe(16); // includes the period
    });
  });

  describe('multiple strikethrough in same line', () => {
    it('should handle multiple strikethrough instances', () => {
      const markdown = '~~one~~ and ~~two~~';
      const result = parser.extractDecorations(markdown);
      
      const strikethroughDecorations = result.filter(d => d.type === 'strikethrough');
      expect(strikethroughDecorations.length).toBe(2);
      
      // First strikethrough: "one"
      expect(strikethroughDecorations[0].startPos).toBe(2);
      expect(strikethroughDecorations[0].endPos).toBe(5);
      
      // Second strikethrough: "two"
      expect(strikethroughDecorations[1].startPos).toBe(14);
      expect(strikethroughDecorations[1].endPos).toBe(17);
    });
  });

  describe('single tilde should not be strikethrough', () => {
    it('should not treat single tilde as strikethrough', () => {
      const markdown = '~not strikethrough~';
      const result = parser.extractDecorations(markdown);
      
      // Should not have any strikethrough decorations
      const strikethroughDecorations = result.filter(d => d.type === 'strikethrough');
      expect(strikethroughDecorations.length).toBe(0);
    });

    it('should distinguish between single and double tilde', () => {
      const markdown = '~single~ and ~~double~~';
      const result = parser.extractDecorations(markdown);
      
      // Should only have one strikethrough decoration (for double tilde)
      const strikethroughDecorations = result.filter(d => d.type === 'strikethrough');
      expect(strikethroughDecorations.length).toBe(1);
      
      // Should be for "double", not "single"
      expect(strikethroughDecorations[0].startPos).toBeGreaterThan(10);
    });
  });

  describe('strikethrough inside code blocks', () => {
    it('should NOT parse strikethrough inside fenced code blocks', () => {
      const markdown = '```\n~~strikethrough~~\n```';
      const result = parser.extractDecorations(markdown);
      
      const strikethroughDecs = result.filter(d => d.type === 'strikethrough');
      expect(strikethroughDecs.length).toBe(0);
    });

    it('should NOT parse strikethrough inside inline code', () => {
      const markdown = '`~~strikethrough~~`';
      const result = parser.extractDecorations(markdown);
      
      const strikethroughDecs = result.filter(d => d.type === 'strikethrough');
      expect(strikethroughDecs.length).toBe(0);
    });

    it('should still parse strikethrough outside code blocks', () => {
      const markdown = '```\ncode\n```\n~~strikethrough~~';
      const result = parser.extractDecorations(markdown);
      
      const strikethroughDecs = result.filter(d => d.type === 'strikethrough');
      expect(strikethroughDecs.length).toBe(1);
      expect(strikethroughDecs[0].startPos).toBeGreaterThan(10); // After the code block
    });
  });
});

