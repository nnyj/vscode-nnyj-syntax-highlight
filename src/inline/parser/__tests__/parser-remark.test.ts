import { getRemarkProcessor, getRemarkProcessorSync } from '../../parser-remark';

describe('getRemarkProcessor', () => {
  it('returns unified, remarkParse, remarkGfm, and visit', async () => {
    const result = await getRemarkProcessor();
    expect(typeof result.unified).toBe('function');
    expect(typeof result.remarkParse).toBe('function');
    expect(typeof result.remarkGfm).toBe('function');
    expect(typeof result.visit).toBe('function');
  });

  it('returns the same objects on repeated calls (cached)', async () => {
    const first = await getRemarkProcessor();
    const second = await getRemarkProcessor();
    expect(first.unified).toBe(second.unified);
  });
});

describe('getRemarkProcessorSync', () => {
  it('returns unified, remarkParse, remarkGfm, and visit', () => {
    const result = getRemarkProcessorSync();
    expect(typeof result.unified).toBe('function');
    expect(typeof result.remarkParse).toBe('function');
    expect(typeof result.remarkGfm).toBe('function');
    expect(typeof result.visit).toBe('function');
  });

  it('returns the same objects on repeated calls (cached)', () => {
    const first = getRemarkProcessorSync();
    const second = getRemarkProcessorSync();
    expect(first.unified).toBe(second.unified);
  });
});
