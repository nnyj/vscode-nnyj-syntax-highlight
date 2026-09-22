import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Horizontal Rules (Thematic Breaks)', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('hyphen horizontal rule (---)', () => {
    it('should detect horizontal rule with three hyphens', () => {
      const markdown = '---';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
      expect(horizontalRule?.startPos).toBe(0);
      expect(horizontalRule?.endPos).toBe(3);
    });

    it('should detect horizontal rule with more than three hyphens', () => {
      const markdown = '------';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
      expect(horizontalRule?.startPos).toBe(0);
      expect(horizontalRule?.endPos).toBe(6);
    });

    it('should handle horizontal rule with spaces', () => {
      const markdown = '--- ';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
    });
  });

  describe('asterisk horizontal rule (***)', () => {
    it('should detect horizontal rule with three asterisks', () => {
      const markdown = '***';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
      expect(horizontalRule?.startPos).toBe(0);
      expect(horizontalRule?.endPos).toBe(3);
    });

    it('should detect horizontal rule with more than three asterisks', () => {
      const markdown = '******';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
      expect(horizontalRule?.startPos).toBe(0);
      expect(horizontalRule?.endPos).toBe(6);
    });

    it('should handle horizontal rule with spaces', () => {
      const markdown = '*** ';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
    });
  });

  describe('underscore horizontal rule (___)', () => {
    it('should detect horizontal rule with three underscores', () => {
      const markdown = '___';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
      expect(horizontalRule?.startPos).toBe(0);
      expect(horizontalRule?.endPos).toBe(3);
    });

    it('should detect horizontal rule with more than three underscores', () => {
      const markdown = '______';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
      expect(horizontalRule?.startPos).toBe(0);
      expect(horizontalRule?.endPos).toBe(6);
    });

    it('should handle horizontal rule with spaces', () => {
      const markdown = '___ ';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeDefined();
    });
  });

  describe('multiple horizontal rules', () => {
    it('should detect all three variants in sequence', () => {
      const markdown = '---\n***\n___';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRules = result.filter(d => d.type === 'horizontalRule');
      expect(horizontalRules.length).toBe(3);
    });

    it('should handle horizontal rules with content between them', () => {
      const markdown = 'Text above\n\n---\n\nMiddle text\n\n___\n\nText below';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRules = result.filter(d => d.type === 'horizontalRule');
      expect(horizontalRules.length).toBe(2);
    });
  });

  describe('horizontal rule edge cases', () => {
    it('should not treat two hyphens as horizontal rule', () => {
      const markdown = '--';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeUndefined();
    });

    it('should not treat two asterisks as horizontal rule', () => {
      const markdown = '**';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeUndefined();
    });

    it('should not treat two underscores as horizontal rule', () => {
      const markdown = '__';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeUndefined();
    });

    it('should not treat mixed characters as horizontal rule', () => {
      const markdown = '*-*';
      const result = parser.extractDecorations(markdown);
      
      const horizontalRule = result.find(d => d.type === 'horizontalRule');
      expect(horizontalRule).toBeUndefined();
    });
  });
});
