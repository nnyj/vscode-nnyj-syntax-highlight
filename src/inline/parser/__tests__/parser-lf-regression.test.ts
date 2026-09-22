import { MarkdownParser } from '../../parser';

describe('MarkdownParser - LF Regression Tests (ensure CRLF fixes don\'t break LF)', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('LF line endings still work', () => {
    it('should parse task lists with LF line endings', () => {
      const markdown = '- [ ] Item 1\n- [ ] Item 2';
      const result = parser.extractDecorations(markdown);

      // Task list lines use checkbox decorations only (no listItem)
      const checkboxes = result.filter(d => d.type === 'checkboxUnchecked' || d.type === 'checkboxChecked');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse bullet points with LF line endings', () => {
      const markdown = '- Item A\n- Item B';
      const result = parser.extractDecorations(markdown);

      const listItems = result.filter(d => d.type === 'listItem');
      expect(listItems.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse blockquotes with LF line endings', () => {
      const markdown = '> Quote text\n> More quote';
      const result = parser.extractDecorations(markdown);

      const blockquotes = result.filter(d => d.type === 'blockquote');
      expect(blockquotes.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse headings with LF line endings', () => {
      const markdown = '# Heading 1\n## Heading 2';
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'heading2')).toBe(true);
    });

    it('should parse mixed content with LF line endings', () => {
      const markdown = '# Heading\n\n**bold** text\n\n> Quote\n\n- List item';
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'blockquote')).toBe(true);
      expect(result.some(d => d.type === 'listItem')).toBe(true);
    });
  });

  describe('position accuracy with LF', () => {
    it('should have correct positions for bold with LF', () => {
      const markdown = '**bold**';
      const result = parser.extractDecorations(markdown);

      const boldDec = result.find(d => d.type === 'bold');
      expect(boldDec).toBeDefined();
      if (boldDec) {
        const extractedText = markdown.substring(boldDec.startPos, boldDec.endPos);
        expect(extractedText).toBe('bold');
      }
    });

    it('should have correct positions for headings with LF', () => {
      const markdown = '# Heading';
      const result = parser.extractDecorations(markdown);

      const headingDec = result.find(d => d.type === 'heading1' || d.type === 'heading');
      expect(headingDec).toBeDefined();
      if (headingDec) {
        expect(headingDec.startPos).toBeGreaterThanOrEqual(0);
        expect(headingDec.endPos).toBeLessThanOrEqual(markdown.length);
      }
    });
  });

  describe('mixed line endings handling', () => {
    it('should handle documents with both LF and CRLF', () => {
      const markdown = 'Line 1\nLine 2\r\nLine 3';
      const result = parser.extractDecorations(markdown);

      expect(Array.isArray(result)).toBe(true);
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
      });
    });

    it('should handle documents with LF, CRLF, and CR', () => {
      const markdown = 'Line 1\nLine 2\r\nLine 3\r';
      const result = parser.extractDecorations(markdown);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('performance with LF (should not degrade)', () => {
    it('should parse large documents with LF efficiently', () => {
      const lines = Array(100).fill('# Heading\n**bold** text\n').join('');
      const startTime = Date.now();
      const result = parser.extractDecorations(lines);
      const endTime = Date.now();

      expect(Array.isArray(result)).toBe(true);
      // Should complete in reasonable time (less than 1 second for 100 lines)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle many decorations with LF efficiently', () => {
      const markdown = Array(50).fill('**bold** ').join('');
      const startTime = Date.now();
      const result = parser.extractDecorations(markdown);
      const endTime = Date.now();

      expect(result.length).toBeGreaterThan(0);
      // Should complete quickly
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('edge cases with LF still work', () => {
    it('should handle empty lines with LF', () => {
      const markdown = 'Line 1\n\nLine 2';
      const result = parser.extractDecorations(markdown);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle LF at document start', () => {
      const markdown = '\n# Heading';
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
    });

    it('should handle LF at document end', () => {
      const markdown = '# Heading\n';
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
    });
  });
});


