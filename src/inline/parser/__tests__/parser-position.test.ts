import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Position Accuracy', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('simple bold positions', () => {
    it('should have correct positions for simple bold', () => {
      const markdown = '**bold**';
      const result = parser.extractDecorations(markdown);
      
      // Hide opening markers: 0-2
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 2,
        type: 'hide'
      });
      
      // Bold text: 2-6
      expect(result).toContainEqual({
        startPos: 2,
        endPos: 6,
        type: 'bold'
      });
      
      // Hide closing markers: 6-8
      expect(result).toContainEqual({
        startPos: 6,
        endPos: 8,
        type: 'hide'
      });
    });
  });

  describe('multi-line content positions', () => {
    it('should have correct positions for multi-line content', () => {
      const markdown = '# Heading\n**bold**\n*italic*';
      const result = parser.extractDecorations(markdown);
      
      // All positions should be valid
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
      
      // Positions should be sorted
      for (let i = 1; i < result.length; i++) {
        expect(result[i].startPos).toBeGreaterThanOrEqual(result[i - 1].startPos);
      }
    });
  });

  describe('positions with different line endings', () => {
    it('should have correct positions with CRLF', () => {
      const markdown = '# Heading\r\n**bold**';
      const result = parser.extractDecorations(markdown);
      
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });

    it('should have correct positions with CR', () => {
      const markdown = '# Heading\r**bold**';
      const result = parser.extractDecorations(markdown);
      
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });
  });

  describe('positions should not overlap incorrectly', () => {
    it('should not have overlapping decorations of same type', () => {
      const markdown = '**bold** **bold**';
      const result = parser.extractDecorations(markdown);
      
      const boldDecs = result.filter(d => d.type === 'bold');
      expect(boldDecs.length).toBe(2);
      
      // First bold should end before second starts
      expect(boldDecs[0].endPos).toBeLessThanOrEqual(boldDecs[1].startPos);
    });
  });

  describe('positions are sorted correctly', () => {
    it('should return decorations sorted by startPos', () => {
      const markdown = '# Heading\n**bold** text *italic*';
      const result = parser.extractDecorations(markdown);
      
      for (let i = 1; i < result.length; i++) {
        expect(result[i].startPos).toBeGreaterThanOrEqual(result[i - 1].startPos);
        
        // If startPos is same, endPos should be ordered
        if (result[i].startPos === result[i - 1].startPos) {
          expect(result[i].endPos).toBeGreaterThanOrEqual(result[i - 1].endPos);
        }
      }
    });
  });

  describe('position boundaries', () => {
    it('should have valid position boundaries', () => {
      const markdown = '**bold**';
      const result = parser.extractDecorations(markdown);
      
      result.forEach(dec => {
        // Positions should be within text bounds
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        
        // endPos should be greater than startPos
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
        
        // Positions should be integers
        expect(Number.isInteger(dec.startPos)).toBe(true);
        expect(Number.isInteger(dec.endPos)).toBe(true);
      });
    });
  });
});

