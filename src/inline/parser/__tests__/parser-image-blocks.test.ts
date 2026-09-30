import { MarkdownParser } from '../../parser';

describe('MarkdownParser - Image blocks', () => {
  let parser: MarkdownParser;

  beforeEach(async () => {
    parser = await MarkdownParser.create();
  });

  it('collects an image alone on its line with blank lines below', () => {
    const markdown = 'intro\n\n![alt](a.png)\n\n\n\nnext';
    const { imageBlocks } = parser.extractDecorationsWithScopes(markdown);
    expect(imageBlocks).toEqual([{ startPos: 7, endPos: 20, url: 'a.png', numLines: 4 }]);
  });

  it('counts only its own line when text follows directly', () => {
    const { imageBlocks } = parser.extractDecorationsWithScopes('![alt](a.png)\ntext');
    expect(imageBlocks.map(block => block.numLines)).toEqual([1]);
  });

  it('allows list and quote markers before the image', () => {
    const { imageBlocks } = parser.extractDecorationsWithScopes('- ![a](a.png)\n\n> ![b](b.png)');
    expect(imageBlocks.map(block => block.url)).toEqual(['a.png', 'b.png']);
  });

  it('skips images sharing the line with text', () => {
    const { imageBlocks } = parser.extractDecorationsWithScopes('see ![alt](a.png) here\n\n![x](b.png) ![y](c.png)');
    expect(imageBlocks).toEqual([]);
  });

  it('skips linked images', () => {
    const { imageBlocks } = parser.extractDecorationsWithScopes('[![badge](b.svg)](https://x.test)');
    expect(imageBlocks).toEqual([]);
  });
});
