import { processSvg } from '../svg-processor';

/** Parse width/height px values from processed SVG string */
function parseDimensions(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/\bwidth="(\d+(?:\.\d+)?)px"/);
  const heightMatch = svg.match(/\bheight="(\d+(?:\.\d+)?)px"/);
  return {
    width: widthMatch ? parseFloat(widthMatch[1]) : NaN,
    height: heightMatch ? parseFloat(heightMatch[1]) : NaN,
  };
}

/** Build a minimal SVG string with explicit width/height and viewBox */
function makeSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`;
}

describe('processSvg – maxWidth constraint (issue #50)', () => {
  describe('without maxWidth', () => {
    it('scales width proportionally to the requested height', () => {
      // 400×200 SVG → aspect ratio 2:1, requested height 100 → width should be 200
      const svg = makeSvg(400, 200);
      const result = processSvg(svg, 100);
      const { width, height } = parseDimensions(result);
      expect(height).toBe(100);
      expect(width).toBeCloseTo(200, 0);
    });

    it('renders a very wide diagram without any constraint', () => {
      // 3000×200 SVG → aspect ratio 15:1, height 200 → width would be 3000
      const svg = makeSvg(3000, 200);
      const result = processSvg(svg, 200);
      const { width } = parseDimensions(result);
      expect(width).toBeCloseTo(3000, 0);
    });
  });

  describe('with maxWidth', () => {
    it('does not constrain a diagram that already fits within maxWidth', () => {
      // 400×200 → height 100 → calculatedWidth 200 → fits in maxWidth 800
      const svg = makeSvg(400, 200);
      const result = processSvg(svg, 100, 800);
      const { width, height } = parseDimensions(result);
      expect(height).toBe(100);
      expect(width).toBeCloseTo(200, 0);
    });

    it('constrains a wide diagram to maxWidth and scales height proportionally', () => {
      // 3000×200 SVG → aspectRatio 15:1, requested height 200
      // calculatedWidth = 15 * 200 = 3000; maxWidth = 800
      // scale = 800/3000 ≈ 0.267; finalHeight = round(200 * 0.267) = 53
      const svg = makeSvg(3000, 200);
      const result = processSvg(svg, 200, 800);
      const { width, height } = parseDimensions(result);
      expect(width).toBe(800);
      // Height is scaled proportionally: round(200 * (800/3000))
      const expectedHeight = Math.round(200 * (800 / 3000));
      expect(height).toBe(expectedHeight);
    });

    it('constrains an extremely wide gantt-style diagram', () => {
      // Simulate a large gantt: 5000×300
      // maxWidth = 1680 ≈ 14px font * 0.6 * 200 cols (the renderer's default)
      const svg = makeSvg(5000, 300);
      const result = processSvg(svg, 300, 1680);
      const { width, height } = parseDimensions(result);
      expect(width).toBe(1680);
      // Height is scaled proportionally: round(300 * (1680 / 5000))
      expect(height).toBe(Math.round(300 * 1680 / 5000));
    });

    it('preserves aspect ratio when constraining width', () => {
      // 2400×400 → aspectRatio 6:1, height 400 → calculatedWidth 2400
      const svg = makeSvg(2400, 400);
      const result = processSvg(svg, 400, 800);
      const { width, height } = parseDimensions(result);
      // Original aspect ratio was 6:1; constrained to 800 wide
      // finalHeight = round(400 * (800 / 2400)) = round(133.3) = 133
      const aspectRatio = width / height;
      expect(aspectRatio).toBeCloseTo(6, 0);
    });

    it('does not alter a square diagram that fits within maxWidth', () => {
      const svg = makeSvg(300, 300);
      const result = processSvg(svg, 300, 800);
      const { width, height } = parseDimensions(result);
      expect(width).toBe(300);
      expect(height).toBe(300);
    });

    it('constrains a diagram whose width exactly equals maxWidth', () => {
      // calculatedWidth will equal maxWidth — no scaling needed
      const svg = makeSvg(800, 200);
      const result = processSvg(svg, 200, 800);
      const { width, height } = parseDimensions(result);
      expect(width).toBeCloseTo(800, 0);
      expect(height).toBe(200);
    });
  });
});
