import { mapNormalizedToOriginal, createCRLFText, normalizeToLF } from '../../parser/__tests__/helpers/crlf-helpers';
import { MarkdownParser } from '../../parser';

describe('Decorator - Position Mapping with CRLF', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  describe('mapNormalizedToOriginal edge cases', () => {
    it('should map position at start of document with CRLF', () => {
      const crlfText = createCRLFText('Text');
      const normalizedPos = 0;
      const originalPos = mapNormalizedToOriginal(normalizedPos, crlfText);
      expect(originalPos).toBe(0);
    });

    it('should map position at end of document with CRLF', () => {
      const crlfText = createCRLFText('Text');
      const normalizedText = normalizeToLF(crlfText);
      const normalizedPos = normalizedText.length;
      const originalPos = mapNormalizedToOriginal(normalizedPos, crlfText);
      expect(originalPos).toBe(crlfText.length);
    });

    it('should map position at \\r character in CRLF', () => {
      const crlfText = 'Line 1\r\nLine 2';
      // In normalized text, position 6 is at '\n' (after "Line 1")
      // This should map to position 6 in original (at '\r')
      const normalizedPos = 6; // Position of '\n' in normalized
      const originalPos = mapNormalizedToOriginal(normalizedPos, crlfText);
      expect(originalPos).toBe(6); // Should map to '\r' position
      expect(crlfText[originalPos]).toBe('\r');
    });

    it('should map position at \\n character after \\r in CRLF', () => {
      const crlfText = 'Line 1\r\nLine 2';
      // Position 7 in normalized is at 'L' in "Line 2", which is position 8 in original (after '\r\n')
      const normalizedPos = 7; // At 'L' in "Line 2" in normalized
      const originalPos = mapNormalizedToOriginal(normalizedPos, crlfText);
      expect(originalPos).toBe(8); // Should map to after '\r\n' in original
      expect(crlfText[originalPos]).toBe('L');
    });

    it('should map position exactly at line boundary with CRLF', () => {
      const crlfText = 'Line 1\r\nLine 2';
      
      // Test position at line boundary (at '\n' in normalized, which is '\r' in original)
      const normalizedPos = 6; // At '\n' in normalized
      const originalPos = mapNormalizedToOriginal(normalizedPos, crlfText);
      expect(originalPos).toBe(6); // Should map to '\r' position
    });

    it('should map exclusive end positions at CRLF boundaries', () => {
      const crlfText = 'Line 1\r\nLine 2';
      
      // Exclusive end position at '\n' in normalized should map to '\r' in original
      const normalizedEndPos = 6; // End position at '\n' in normalized
      const originalEndPos = mapNormalizedToOriginal(normalizedEndPos, crlfText);
      expect(originalEndPos).toBe(6); // Should map to '\r' position
    });

    it('should handle multiple consecutive CRLF sequences', () => {
      const crlfText = 'Line 1\r\n\r\nLine 2';
      
      // Position at first '\n' in normalized (after first line)
      const normalizedPos1 = 6;
      const originalPos1 = mapNormalizedToOriginal(normalizedPos1, crlfText);
      expect(originalPos1).toBe(6); // Should map to first '\r'
      
      // Position at second '\n' in normalized (empty line)
      const normalizedPos2 = 7;
      const originalPos2 = mapNormalizedToOriginal(normalizedPos2, crlfText);
      expect(originalPos2).toBe(8); // Should map to second '\r'
      
      // Position after both CRLFs (at 'L' in "Line 2")
      const normalizedPos3 = 8;
      const originalPos3 = mapNormalizedToOriginal(normalizedPos3, crlfText);
      expect(originalPos3).toBe(10); // Should map to after both '\r\n'
      expect(crlfText[originalPos3]).toBe('L');
    });

    it('should map positions in middle of lines with CRLF', () => {
      const crlfText = 'Line 1\r\nLine 2';
      
      // Position at 'e' in "Line 1" (position 3)
      const normalizedPos = 3;
      const originalPos = mapNormalizedToOriginal(normalizedPos, crlfText);
      expect(originalPos).toBe(3);
      expect(crlfText[originalPos]).toBe('e');
    });

    it('should map positions across multiple lines with CRLF', () => {
      const crlfText = 'Line 1\r\nLine 2\r\nLine 3';
      
      // Position at start of second line in normalized (at 'L' of "Line 2")
      const normalizedPos = 7; // At 'L' of "Line 2" in normalized
      const originalPos = mapNormalizedToOriginal(normalizedPos, crlfText);
      expect(originalPos).toBe(8); // After '\r\n' in original
      expect(crlfText.substring(originalPos, originalPos + 4)).toBe('Line');
    });
  });

  describe('end-to-end position mapping with parser', () => {
    it('should correctly map blockquote positions from parser to original CRLF text', () => {
      const crlfText = createCRLFText('> Quote text\n> More quote');
      const decorations = parser.extractDecorations(crlfText);
      
      const blockquoteDecs = decorations.filter(d => d.type === 'blockquote');
      expect(blockquoteDecs.length).toBeGreaterThan(0);
      
      // Verify each blockquote decoration maps to '>' in original text
      blockquoteDecs.forEach(dec => {
        const originalStart = mapNormalizedToOriginal(dec.startPos, crlfText);
        const originalEnd = mapNormalizedToOriginal(dec.endPos, crlfText);
        const mappedText = crlfText.substring(originalStart, originalEnd);
        // Blockquote decoration should contain '>' but may include spaces or newlines
        expect(mappedText).toContain('>');
        // First character should be '>'
        expect(crlfText[originalStart]).toBe('>');
      });
    });

    it('should correctly map list item positions from parser to original CRLF text', () => {
      const crlfText = createCRLFText('- Item 1\n- Item 2');
      const decorations = parser.extractDecorations(crlfText);
      
      const listItemDecs = decorations.filter(d => d.type === 'listItem');
      expect(listItemDecs.length).toBeGreaterThan(0);
      
      // Verify positions map correctly
      listItemDecs.forEach(dec => {
        const originalStart = mapNormalizedToOriginal(dec.startPos, crlfText);
        const originalEnd = mapNormalizedToOriginal(dec.endPos, crlfText);
        expect(originalStart).toBeGreaterThanOrEqual(0);
        expect(originalEnd).toBeLessThanOrEqual(crlfText.length);
        expect(originalEnd).toBeGreaterThan(originalStart);
      });
    });

    it('should correctly map heading positions from parser to original CRLF text', () => {
      const crlfText = createCRLFText('# Heading\n**bold**');
      const decorations = parser.extractDecorations(crlfText);
      
      const headingDecs = decorations.filter(d => d.type.startsWith('heading'));
      expect(headingDecs.length).toBeGreaterThan(0);
      
      headingDecs.forEach(dec => {
        const originalStart = mapNormalizedToOriginal(dec.startPos, crlfText);
        const originalEnd = mapNormalizedToOriginal(dec.endPos, crlfText);
        const mappedText = crlfText.substring(originalStart, originalEnd);
        expect(mappedText.length).toBeGreaterThan(0);
      });
    });
  });

  describe('bug report scenario position mapping', () => {
    it('should correctly map positions in exact bug report scenario', () => {
      const bugReportText = createCRLFText(
        '## To Do\n\n- [ ] Item 1\n- [ ] Item 2\n\n### Bullet points\n\n- Item A\n- Item B'
      );
      const decorations = parser.extractDecorations(bugReportText);
      
      // Verify all decorations can be mapped correctly
      decorations.forEach(dec => {
        const originalStart = mapNormalizedToOriginal(dec.startPos, bugReportText);
        const originalEnd = mapNormalizedToOriginal(dec.endPos, bugReportText);
        
        expect(originalStart).toBeGreaterThanOrEqual(0);
        expect(originalEnd).toBeLessThanOrEqual(bugReportText.length);
        expect(originalEnd).toBeGreaterThan(originalStart);
        
        // Verify mapped text is valid
        const mappedText = bugReportText.substring(originalStart, originalEnd);
        expect(mappedText.length).toBeGreaterThan(0);
      });
      
      // Specifically check blockquote positions if any
      const blockquoteDecs = decorations.filter(d => d.type === 'blockquote');
      blockquoteDecs.forEach(dec => {
        const originalStart = mapNormalizedToOriginal(dec.startPos, bugReportText);
        expect(bugReportText[originalStart]).toBe('>');
      });
    });
  });

  describe('GitHub issue regression test - blockquotes at wrong position', () => {
    it('should position blockquote markers at START of line, not END of previous line (CRLF bug)', () => {
      // This test documents the exact bug from the GitHub issue:
      // With CRLF line endings, blockquote markers (>) were appearing at the 
      // end of the previous line instead of at the start of the current line.
      // Root cause: mapNormalizedToOriginal() had an off-by-one error after CRLF sequences.
      
      const crlfText = createCRLFText('Line 1\n> Quote\nLine 3');
      const decorations = parser.extractDecorations(crlfText);
      
      const blockquoteDecs = decorations.filter(d => d.type === 'blockquote');
      expect(blockquoteDecs.length).toBeGreaterThan(0);
      
      // Critical assertion: blockquote marker should be at position 8 in original CRLF text
      // Original: "Line 1\r\n> Quote\r\nLine 3"
      //            01234567 8
      // Position 8 is the '>' character (start of line 2)
      // NOT position 7 (the '\n' character at end of line 1)
      const blockquoteDec = blockquoteDecs[0];
      const originalStart = mapNormalizedToOriginal(blockquoteDec.startPos, crlfText);
      
      // Verify '>' is at the mapped position
      expect(crlfText[originalStart]).toBe('>');
      
      // Verify it's NOT at the end of the previous line
      // The character before '>' should be '\n' (part of \r\n), not a regular character
      expect(crlfText[originalStart - 1]).toBe('\n');
      expect(crlfText[originalStart - 2]).toBe('\r');
      
      // Verify we're at the start of a line (after CRLF)
      const textBefore = crlfText.substring(0, originalStart);
      const lines = textBefore.split('\r\n');
      expect(lines[lines.length - 1]).toBe(''); // Empty string means we're at start of line
    });

    it('should position list markers at START of line, not END of previous line (CRLF bug)', () => {
      const crlfText = createCRLFText('Line 1\n- Item A\n- Item B');
      const decorations = parser.extractDecorations(crlfText);
      
      const listItemDecs = decorations.filter(d => d.type === 'listItem');
      expect(listItemDecs.length).toBeGreaterThan(0);
      
      // Each list marker should be at the start of a line, not end of previous
      listItemDecs.forEach(dec => {
        const originalStart = mapNormalizedToOriginal(dec.startPos, crlfText);
        
        // The decoration should start with '-' (the list marker)
        const decorationText = crlfText.substring(
          originalStart, 
          mapNormalizedToOriginal(dec.endPos, crlfText)
        );
        expect(decorationText).toMatch(/^-\s/); // Starts with '- '
        
        // If not at document start, previous characters should be CRLF
        if (originalStart > 0) {
          const charBefore = crlfText[originalStart - 1];
          // Should be '\n' (part of \r\n line ending)
          expect(charBefore).toBe('\n');
        }
      });
    });

    it('should correctly handle the mapNormalizedToOriginal offset bug after CRLF', () => {
      // The bug: After processing a CRLF sequence (\r\n), the mapping function
      // was checking if it had reached the target position at the '\n' character,
      // causing an off-by-one error for positions immediately after line breaks.
      
      const crlfText = 'AB\r\nCD';
      // Normalized: 'AB\nCD' (positions: A=0, B=1, \n=2, C=3, D=4)
      // Original:   'AB\r\nCD' (positions: A=0, B=1, \r=2, \n=3, C=4, D=5)
      
      // Position 2 in normalized (\n) should map to 2 in original (\r)
      expect(mapNormalizedToOriginal(2, crlfText)).toBe(2);
      
      // Position 3 in normalized (C) should map to 4 in original (C)
      // This was the bug: it was returning 3 (mapping to \n instead of C)
      expect(mapNormalizedToOriginal(3, crlfText)).toBe(4);
      expect(crlfText[mapNormalizedToOriginal(3, crlfText)]).toBe('C');
      
      // Position 4 in normalized (D) should map to 5 in original (D)
      expect(mapNormalizedToOriginal(4, crlfText)).toBe(5);
      expect(crlfText[mapNormalizedToOriginal(4, crlfText)]).toBe('D');
    });
  });
});

