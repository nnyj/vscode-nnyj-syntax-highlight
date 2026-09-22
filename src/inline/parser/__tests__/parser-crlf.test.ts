import { MarkdownParser } from '../../parser';
import {
  normalizeToLF,
  createCRLFText,
} from './helpers/crlf-helpers';

describe('MarkdownParser - CRLF Line Endings', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('parser normalization', () => {
    it('should normalize CRLF to LF before parsing', () => {
      const crlfText = 'Line 1\r\nLine 2\r\n';
      const normalized = normalizeToLF(crlfText);
      expect(normalized).toBe('Line 1\nLine 2\n');
    });

    it('should handle mixed line endings', () => {
      const mixedText = 'Line 1\r\nLine 2\nLine 3\r';
      const normalized = normalizeToLF(mixedText);
      expect(normalized).toBe('Line 1\nLine 2\nLine 3\n');
    });
  });

  describe('task lists with CRLF', () => {
    it('should parse task lists with CRLF line endings', () => {
      const markdown = createCRLFText('- [ ] Item 1\n- [ ] Item 2');
      const result = parser.extractDecorations(markdown);

      // Task list lines use checkbox decorations only (no listItem)
      const checkboxes = result.filter(d => d.type === 'checkboxUnchecked' || d.type === 'checkboxChecked');
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    });

    it('should have correct positions for task lists with CRLF', () => {
      const markdown = createCRLFText('- [ ] Item 1\n- [ ] Item 2');
      const result = parser.extractDecorations(markdown);

      // Verify positions are within bounds
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });
  });

  describe('bullet points with CRLF', () => {
    it('should parse bullet points with CRLF line endings', () => {
      const markdown = createCRLFText('- Item A\n- Item B');
      const result = parser.extractDecorations(markdown);

      const listItems = result.filter(d => d.type === 'listItem');
      expect(listItems.length).toBeGreaterThanOrEqual(2);
    });

    it('should have correct positions for bullet points with CRLF', () => {
      const markdown = createCRLFText('- Item A\n- Item B');
      const result = parser.extractDecorations(markdown);

      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });
  });

  describe('blockquotes with CRLF', () => {
    it('should parse blockquotes with CRLF line endings', () => {
      const markdown = createCRLFText('> Quote text\n> More quote');
      const result = parser.extractDecorations(markdown);

      const blockquotes = result.filter(d => d.type === 'blockquote');
      expect(blockquotes.length).toBeGreaterThanOrEqual(2);
    });

    it('should have correct positions for blockquotes with CRLF', () => {
      const markdown = createCRLFText('> Quote text\n> More quote');
      const result = parser.extractDecorations(markdown);

      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });

    it('should handle multi-line blockquotes with CRLF', () => {
      const markdown = createCRLFText('> Line 1\n> Line 2\n> Line 3');
      const result = parser.extractDecorations(markdown);

      const blockquotes = result.filter(d => d.type === 'blockquote');
      expect(blockquotes.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('headings with CRLF', () => {
    it('should parse headings with CRLF line endings', () => {
      const markdown = createCRLFText('# Heading 1\n## Heading 2');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'heading2')).toBe(true);
    });

    it('should have correct positions for headings with CRLF', () => {
      const markdown = createCRLFText('# Heading\n**bold**');
      const result = parser.extractDecorations(markdown);

      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });
  });

  describe('mixed content with CRLF (bug report scenario)', () => {
    it('should parse the exact bug report scenario', () => {
      const markdown = createCRLFText(
        '## To Do\n\n- [ ] Item 1\n- [ ] Item 2\n\n### Bullet points\n\n- Item A\n- Item B'
      );
      const result = parser.extractDecorations(markdown);

      // Should find heading
      expect(result.some(d => d.type === 'heading2')).toBe(true);
      expect(result.some(d => d.type === 'heading3')).toBe(true);

      // Task list lines (- [ ]) use checkbox decorations; bullet lines (- Item) use listItem
      const listItems = result.filter(d => d.type === 'listItem');
      const checkboxes = result.filter(d => d.type === 'checkboxUnchecked' || d.type === 'checkboxChecked');
      expect(listItems.length).toBeGreaterThanOrEqual(2);
      expect(checkboxes.length).toBeGreaterThanOrEqual(2);

      // Verify all positions are valid
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
        expect(dec.endPos).toBeGreaterThan(dec.startPos);
      });
    });
  });

  describe('bold and italic with CRLF', () => {
    it('should parse bold text with CRLF', () => {
      const markdown = createCRLFText('**bold** text');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'bold')).toBe(true);
    });

    it('should parse italic text with CRLF', () => {
      const markdown = createCRLFText('*italic* text');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'italic')).toBe(true);
    });
  });

  describe('links with CRLF', () => {
    it('should parse links with CRLF', () => {
      const markdown = createCRLFText('[text](url)');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'link')).toBe(true);
    });
  });

  describe('code blocks with CRLF', () => {
    it('should parse code blocks with CRLF', () => {
      const markdown = createCRLFText('```\ncode\n```');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'codeBlock')).toBe(true);
    });

    it('should handle code blocks spanning multiple CRLF lines', () => {
      const markdown = createCRLFText('```\nline 1\nline 2\nline 3\n```');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'codeBlock')).toBe(true);
    });
  });

  describe('edge cases with CRLF', () => {
    it('should handle empty lines with CRLF', () => {
      const markdown = createCRLFText('Line 1\n\nLine 2');
      const result = parser.extractDecorations(markdown);

      // Should not crash and return valid decorations
      expect(Array.isArray(result)).toBe(true);
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
      });
    });

    it('should handle multiple consecutive CRLF sequences', () => {
      const markdown = createCRLFText('Line 1\n\n\nLine 2');
      const result = parser.extractDecorations(markdown);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle CRLF at document start', () => {
      const markdown = createCRLFText('\n# Heading');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
    });

    it('should handle CRLF at document end', () => {
      const markdown = createCRLFText('# Heading\n');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
    });

    it('should handle mixed line endings in same document', () => {
      const markdown = 'Line 1\r\nLine 2\nLine 3\r';
      const result = parser.extractDecorations(markdown);

      expect(Array.isArray(result)).toBe(true);
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
      });
    });
  });

  describe('position accuracy with CRLF', () => {
    it('should return positions in normalized text (LF)', () => {
      const crlfText = createCRLFText('**bold**');
      const result = parser.extractDecorations(crlfText);

      const boldDec = result.find(d => d.type === 'bold');
      expect(boldDec).toBeDefined();
      if (boldDec) {
        // Positions should be in normalized text (without \r)
        const normalizedText = normalizeToLF(crlfText);
        const extractedText = normalizedText.substring(boldDec.startPos, boldDec.endPos);
        expect(extractedText).toBe('bold');
      }
    });

    it('should have sorted positions', () => {
      const markdown = createCRLFText('# Heading\n**bold**\n*italic*');
      const result = parser.extractDecorations(markdown);

      for (let i = 1; i < result.length; i++) {
        expect(result[i].startPos).toBeGreaterThanOrEqual(result[i - 1].startPos);
      }
    });
  });

  describe('nested structures with CRLF', () => {
    it('should handle nested blockquotes with CRLF', () => {
      const markdown = createCRLFText('> > Nested quote');
      const result = parser.extractDecorations(markdown);

      const blockquotes = result.filter(d => d.type === 'blockquote');
      expect(blockquotes.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle lists with blockquotes with CRLF', () => {
      const markdown = createCRLFText('- Item\n  > Quote');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'listItem')).toBe(true);
    });
  });

  describe('additional edge cases with CRLF', () => {
    it('should handle blockquote at start of document with CRLF', () => {
      const markdown = createCRLFText('> Quote at start');
      const result = parser.extractDecorations(markdown);

      const blockquotes = result.filter(d => d.type === 'blockquote');
      expect(blockquotes.length).toBeGreaterThan(0);
      expect(blockquotes[0].startPos).toBe(0);
    });

    it('should handle blockquote at end of document with CRLF', () => {
      const markdown = createCRLFText('Text\n> Quote at end');
      const result = parser.extractDecorations(markdown);

      const blockquotes = result.filter(d => d.type === 'blockquote');
      expect(blockquotes.length).toBeGreaterThan(0);
    });

    it('should handle multiple blockquotes with CRLF between them', () => {
      const markdown = createCRLFText('> Quote 1\n\n> Quote 2');
      const result = parser.extractDecorations(markdown);

      const blockquotes = result.filter(d => d.type === 'blockquote');
      expect(blockquotes.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle code blocks with CRLF line endings', () => {
      const markdown = createCRLFText('```\ncode line 1\ncode line 2\n```');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'codeBlock')).toBe(true);
    });

    it('should handle headings spanning CRLF boundaries', () => {
      const markdown = createCRLFText('# Heading\nwith continuation');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
    });

    it('should handle very long lines with CRLF', () => {
      const longLine = 'a'.repeat(1000);
      const markdown = createCRLFText(`${longLine}\n${longLine}`);
      const result = parser.extractDecorations(markdown);

      expect(Array.isArray(result)).toBe(true);
      result.forEach(dec => {
        expect(dec.startPos).toBeGreaterThanOrEqual(0);
        expect(dec.endPos).toBeLessThanOrEqual(markdown.length);
      });
    });

    it('should handle decorations at document start with CRLF', () => {
      const markdown = createCRLFText('# Heading');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
      const headingDec = result.find(d => d.type === 'heading1' || d.type === 'heading');
      expect(headingDec?.startPos).toBeGreaterThanOrEqual(0);
    });

    it('should handle decorations at document end with CRLF', () => {
      const markdown = createCRLFText('Text\n# Heading');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'heading1' || d.type === 'heading')).toBe(true);
    });

    it('should handle multi-line blocks spanning CRLF boundaries', () => {
      const markdown = createCRLFText('```\ncode\nmore code\n```');
      const result = parser.extractDecorations(markdown);

      expect(result.some(d => d.type === 'codeBlock')).toBe(true);
    });
  });
});

