import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Edge Cases', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('empty string input', () => {
    it('should return empty array for empty string', () => {
      const result = parser.extractDecorations('');
      expect(result).toEqual([]);
    });
  });

  describe('whitespace only input', () => {
    it('should return empty array for whitespace only', () => {
      const result = parser.extractDecorations('   \t  ');
      expect(result).toEqual([]);
    });
  });

  describe('newline only input', () => {
    it('should return empty array for newline only', () => {
      const result = parser.extractDecorations('\n');
      expect(result).toEqual([]);
    });
  });

  describe('very long text', () => {
    it('should handle very long text without errors', () => {
      const longText = '# Heading\n' + '**bold** '.repeat(1000);
      const result = parser.extractDecorations(longText);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('special unicode characters', () => {
    it('should handle unicode characters', () => {
      const markdown = '# 标题\n**粗体**';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
      // Should handle unicode gracefully
    });
  });

  describe('mixed line endings', () => {
    it('should handle CRLF, CR, and LF mixed', () => {
      const markdown = '# Heading\r\n**bold**\r*italic*\n`code`';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'italic')).toBe(true);
      expect(result.some(d => d.type === 'code')).toBe(true);
    });
  });

  describe('malformed markdown', () => {
    it('should handle malformed markdown gracefully', () => {
      const markdown = '***\n***\n***';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
      // Should not throw error
    });
  });

  describe('unclosed bold', () => {
    it('should handle unclosed bold gracefully', () => {
      const markdown = '**unclosed bold';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
      // May or may not create decorations
    });
  });

  describe('unclosed italic', () => {
    it('should handle unclosed italic gracefully', () => {
      const markdown = '*unclosed italic';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
      // May or may not create decorations
    });
  });

  describe('nested unclosed', () => {
    it('should handle nested unclosed formatting gracefully', () => {
      const markdown = '**bold *italic';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
      // Should not throw error
    });
  });

  describe('only markers', () => {
    it('should handle only markers without content', () => {
      const markdown = '**';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('markers with only whitespace', () => {
    it('should handle markers with only whitespace', () => {
      const markdown = '**   **';
      const result = parser.extractDecorations(markdown);
      
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

