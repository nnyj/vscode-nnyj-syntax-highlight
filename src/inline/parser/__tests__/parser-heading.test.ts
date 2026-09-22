import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Headings', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('H1 heading (# H1)', () => {
    it('should hide # and whitespace, style as heading1', () => {
      const markdown = '# H1';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 2,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 2,
        endPos: 4,
        type: 'heading1'
      });
    });
  });

  describe('H2 heading (## H2)', () => {
    it('should hide ## and whitespace, style as heading2', () => {
      const markdown = '## H2';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 3,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 3,
        endPos: 5,
        type: 'heading2',
      });
    });
  });

  describe('H3 heading (### H3)', () => {
    it('should hide ### and whitespace, style as heading3', () => {
      const markdown = '### H3';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 4,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 4,
        endPos: 6,
        type: 'heading3',
      });
    });
  });

  describe('H4 heading (#### H4)', () => {
    it('should hide #### and whitespace, style as heading', () => {
      const markdown = '#### H4';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 5,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 5,
        endPos: 7,
        type: 'heading',
      });
    });
  });

  describe('H5 heading (##### H5)', () => {
    it('should hide ##### and whitespace, style as heading', () => {
      const markdown = '##### H5';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 6,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 6,
        endPos: 8,
        type: 'heading',
      });
    });
  });

  describe('H6 heading (###### H6)', () => {
    it('should hide ###### and whitespace, style as heading', () => {
      const markdown = '###### H6';
      const result = parser.extractDecorations(markdown);
      
      expect(result).toContainEqual({
        startPos: 0,
        endPos: 7,
        type: 'hide'
      });
      expect(result).toContainEqual({
        startPos: 7,
        endPos: 9,
        type: 'heading',
      });
    });
  });

  describe('heading with leading whitespace', () => {
    it('should handle heading with leading whitespace', () => {
      const markdown = '  # Heading';
      const result = parser.extractDecorations(markdown);
      
      const headingDec = result.find(d => d.type === 'heading1' || d.type === 'heading');
      expect(headingDec).toBeDefined();
      // Hash should be hidden (after whitespace)
      expect(result.some(d => d.type === 'hide' && d.startPos === 2)).toBe(true);
    });
  });

  describe('heading with trailing whitespace', () => {
    it('should handle heading with trailing whitespace', () => {
      const markdown = '# Heading  ';
      const result = parser.extractDecorations(markdown);
      
      const headingDec = result.find(d => d.type === 'heading1' || d.type === 'heading');
      expect(headingDec).toBeDefined();
      // Heading text should exclude trailing whitespace
      expect(headingDec?.endPos).toBeLessThanOrEqual(10);
    });
  });

  describe('heading at start of document', () => {
    it('should handle heading at document start', () => {
      const markdown = '# Heading\nText';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'hide' && d.startPos === 0)).toBe(true);
      expect(result.some(d => d.type === 'heading1')).toBe(true);
    });
  });

  describe('heading at end of document', () => {
    it('should handle heading at document end', () => {
      const markdown = 'Text\n# Heading';
      const result = parser.extractDecorations(markdown);
      
      const headingDec = result.find(d => d.type === 'heading1' || d.type === 'heading');
      expect(headingDec).toBeDefined();
    });
  });

  describe('multiple headings in document', () => {
    it('should handle all heading levels together', () => {
      const markdown = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
      const result = parser.extractDecorations(markdown);
      
      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'heading2')).toBe(true);
      expect(result.some(d => d.type === 'heading3')).toBe(true);
      // Check that heading decorations exist (level property not in interface)
      expect(result.some(d => d.type === 'heading4')).toBe(true);
      expect(result.some(d => d.type === 'heading5')).toBe(true);
      expect(result.some(d => d.type === 'heading6')).toBe(true);
    });
  });

  describe('heading with special characters', () => {
    it('should handle heading with special characters', () => {
      const markdown = '# Heading!@#';
      const result = parser.extractDecorations(markdown);
      
      const headingDec = result.find(d => d.type === 'heading1' || d.type === 'heading');
      expect(headingDec).toBeDefined();
      expect(headingDec?.endPos).toBeGreaterThan(10);
    });
  });

  describe('heading with numbers', () => {
    it('should handle heading with numbers', () => {
      const markdown = '# Heading 123';
      const result = parser.extractDecorations(markdown);
      
      const headingDec = result.find(d => d.type === 'heading1' || d.type === 'heading');
      expect(headingDec).toBeDefined();
      expect(headingDec?.endPos).toBeGreaterThan(10);
    });
  });

  describe('heading with only hash', () => {
    it('should handle heading with only hash gracefully', () => {
      const markdown = '#';
      const result = parser.extractDecorations(markdown);
      
      // May or may not create decorations
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('heading with hash and space but no text', () => {
    it('should handle heading with hash and space gracefully', () => {
      const markdown = '# ';
      const result = parser.extractDecorations(markdown);
      
      // May or may not create decorations
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

