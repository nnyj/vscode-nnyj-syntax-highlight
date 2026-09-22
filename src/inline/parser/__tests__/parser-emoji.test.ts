import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Emoji Shortcodes', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  it('should render basic emoji shortcode', () => {
    const markdown = ':smile:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(0);
    expect(emojiDec?.endPos).toBe(7);
    expect(emojiDec?.emoji).toBe('😄');
  });

  it('should render emoji shortcodes with plus', () => {
    const markdown = ':+1:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(0);
    expect(emojiDec?.endPos).toBe(4);
    expect(emojiDec?.emoji).toBe('👍');
  });

  it('should render emoji shortcodes with minus', () => {
    const markdown = ':-1:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(0);
    expect(emojiDec?.endPos).toBe(4);
    expect(emojiDec?.emoji).toBe('👎');
  });

  it('should render emoji shortcodes with hyphens', () => {
    const markdown = ':t-rex:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(0);
    expect(emojiDec?.endPos).toBe(7);
    expect(emojiDec?.emoji).toBe('🦖');
  });

  it('should render emoji shortcodes with underscores', () => {
    const markdown = ':heart_eyes:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(0);
    expect(emojiDec?.endPos).toBe(12);
    expect(emojiDec?.emoji).toBe('😍');
  });

  it('should render emoji shortcodes with mixed characters', () => {
    const markdown = ':non-potable_water:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.emoji).toBe('🚱');
  });

  it('should ignore invalid emoji shortcodes', () => {
    const markdown = ':not-an-emoji:';
    const result = parser.extractDecorations(markdown);

    expect(result.some(d => d.type === 'emoji')).toBe(false);
  });

  it('should ignore emoji shortcodes with invalid characters', () => {
    const markdown = ':smile@test:';
    const result = parser.extractDecorations(markdown);

    expect(result.some(d => d.type === 'emoji')).toBe(false);
  });

  it('should render emoji shortcodes in paragraphs and not in code', () => {
    const markdown = 'Hello :smile: world `:tada:`';
    const result = parser.extractDecorations(markdown);

    const emojiDecs = result.filter(d => d.type === 'emoji');
    expect(emojiDecs.length).toBe(1);
    expect(emojiDecs[0].startPos).toBe(6);
    expect(emojiDecs[0].endPos).toBe(13);
  });

  it('should not render emoji shortcodes in fenced code blocks', () => {
    const markdown = '```\n:smile:\n```';
    const result = parser.extractDecorations(markdown);

    expect(result.some(d => d.type === 'emoji')).toBe(false);
  });

  it('should render emoji shortcodes inside image alt text', () => {
    const markdown = '![Alt :smile:](url)';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(6);
    expect(emojiDec?.endPos).toBe(13);
  });

  it('should render multiple consecutive emoji shortcodes', () => {
    const markdown = ':smile::wave::heart:';
    const result = parser.extractDecorations(markdown);

    const emojiDecs = result.filter(d => d.type === 'emoji');
    expect(emojiDecs.length).toBe(3);
    expect(emojiDecs[0].emoji).toBe('😄');
    expect(emojiDecs[1].emoji).toBe('👋');
    expect(emojiDecs[2].emoji).toBe('❤️');
  });

  it('should render emoji shortcodes at document start', () => {
    const markdown = ':smile: hello';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(0);
    expect(emojiDec?.endPos).toBe(7);
  });

  it('should render emoji shortcodes at document end', () => {
    const markdown = 'hello :smile:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.startPos).toBe(6);
    expect(emojiDec?.endPos).toBe(13);
  });

  it('should render emoji shortcodes in headings', () => {
    const markdown = '# Hello :smile: World';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.emoji).toBe('😄');
  });

  it('should render emoji shortcodes in blockquotes', () => {
    const markdown = '> :smile: quote';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.emoji).toBe('😄');
  });

  it('should render emoji shortcodes in list items', () => {
    const markdown = '- Item :smile: here';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.emoji).toBe('😄');
  });

  it('should render emoji shortcodes in links', () => {
    const markdown = '[Link :smile: text](url)';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.emoji).toBe('😄');
  });

  it('should handle case-insensitive emoji shortcodes', () => {
    const markdown = ':SMILE: :Smile: :smile:';
    const result = parser.extractDecorations(markdown);

    const emojiDecs = result.filter(d => d.type === 'emoji');
    expect(emojiDecs.length).toBe(3);
    emojiDecs.forEach(dec => {
      expect(dec.emoji).toBe('😄');
    });
  });

  it('should not match partial shortcodes', () => {
    const markdown = ':smile:test:';
    const result = parser.extractDecorations(markdown);

    const emojiDecs = result.filter(d => d.type === 'emoji');
    // Should only match :smile:, not :smile:test:
    expect(emojiDecs.length).toBe(1);
    expect(emojiDecs[0].emoji).toBe('😄');
  });

  it('should handle emoji shortcodes with numbers', () => {
    const markdown = ':100:';
    const result = parser.extractDecorations(markdown);

    const emojiDec = result.find(d => d.type === 'emoji');
    expect(emojiDec).toBeDefined();
    expect(emojiDec?.emoji).toBe('💯');
  });

  it('should handle text with no colons', () => {
    const markdown = 'This is plain text with no emojis';
    const result = parser.extractDecorations(markdown);

    expect(result.some(d => d.type === 'emoji')).toBe(false);
  });

  it('should handle empty string', () => {
    const markdown = '';
    const result = parser.extractDecorations(markdown);

    expect(result.some(d => d.type === 'emoji')).toBe(false);
  });

  describe('performance with many emojis', () => {
    it('should parse large document with many emojis efficiently', () => {
      // Create a large document with many emojis (1000+ emojis)
      const emojiLine = 'Text with :smile: :wave: :heart: :+1: :tada: emojis. ';
      const lines = Array(200).fill(emojiLine).join('\n');
      const startTime = Date.now();
      const result = parser.extractDecorations(lines);
      const endTime = Date.now();

      expect(Array.isArray(result)).toBe(true);
      
      // Should find all emojis (200 lines * 5 emojis per line = 1000 emojis)
      const emojiDecs = result.filter(d => d.type === 'emoji');
      expect(emojiDecs.length).toBe(1000);
      
      // Should complete in reasonable time (less than 2 seconds for 1000 emojis)
      expect(endTime - startTime).toBeLessThan(2000);
    });

    it('should handle document with many emojis and other markdown efficiently', () => {
      // Mix emojis with headings, bold, links, etc.
      const complexLine = '# Heading :smile:\n**Bold** text with :wave: and [link :heart:](url)\n';
      const lines = Array(100).fill(complexLine).join('');
      const startTime = Date.now();
      const result = parser.extractDecorations(lines);
      const endTime = Date.now();

      expect(Array.isArray(result)).toBe(true);
      
      // Should find emojis (100 lines * 3 emojis per line = 300 emojis)
      const emojiDecs = result.filter(d => d.type === 'emoji');
      expect(emojiDecs.length).toBe(300);
      
      // Should also have other decorations
      expect(result.some(d => d.type === 'heading1')).toBe(true);
      expect(result.some(d => d.type === 'bold')).toBe(true);
      expect(result.some(d => d.type === 'link')).toBe(true);
      
      // Should complete in reasonable time
      expect(endTime - startTime).toBeLessThan(2000);
    });

    it('should handle many consecutive emojis efficiently', () => {
      // Create a line with many consecutive emojis
      const emojiSequence = ':smile::wave::heart::+1::tada::100::fire::rocket:';
      const lines = Array(50).fill(emojiSequence).join('\n');
      const startTime = Date.now();
      const result = parser.extractDecorations(lines);
      const endTime = Date.now();

      expect(Array.isArray(result)).toBe(true);
      
      // Should find all emojis (50 lines * 8 emojis per line = 400 emojis)
      const emojiDecs = result.filter(d => d.type === 'emoji');
      expect(emojiDecs.length).toBe(400);
      
      // Should complete quickly
      expect(endTime - startTime).toBeLessThan(2000);
    });

    it('should handle large document with mixed valid and invalid shortcodes efficiently', () => {
      // Mix valid emojis with invalid shortcodes (should skip invalid ones quickly)
      const mixedLine = ':smile: :invalid-emoji: :wave: :another-fake: :heart: ';
      const lines = Array(200).fill(mixedLine).join('\n');
      const startTime = Date.now();
      const result = parser.extractDecorations(lines);
      const endTime = Date.now();

      expect(Array.isArray(result)).toBe(true);
      
      // Should only find valid emojis (200 lines * 3 valid emojis per line = 600 emojis)
      const emojiDecs = result.filter(d => d.type === 'emoji');
      expect(emojiDecs.length).toBe(600);
      
      // Should complete efficiently even with many invalid shortcodes to check
      expect(endTime - startTime).toBeLessThan(2000);
    });
  });
});
