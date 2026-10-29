/** Cell backgrounds from red (level 0) to green (level 4). */
export const LEVEL_COLORS = ['rgba(239,68,68,0.5)', 'rgba(249,115,22,0.5)', 'rgba(234,179,8,0.5)', 'rgba(132,204,22,0.5)', 'rgba(34,197,94,0.5)'];
const CIRCLE_LEVELS: Record<string, number> = { '🔴': 0, '🟡': 2, '🟢': 4 };
// Leading number after an optional `~` or `$`, trailing text like ` ms` or ` (1.2x)` is ignored.
const RE_NUMBER = /^[~$]*([-+]?\d[\d,]*(?:\.\d+)?)/;
const RE_PLACEHOLDER = /^(-+|–|—)$/;

/**
 * Level per body cell from trimmed cell texts, undefined = no color.
 * Circle cells take the circle's level. Numeric columns scale min..max to red..green, `↓` in the header flips it.
 * numericColumns lists the header columns holding numbers.
 */
export function cellLevels(header: string[], rows: string[][]): { levels: Array<Array<number | undefined>>; numericColumns: number[] } {
  const levels: Array<Array<number | undefined>> = rows.map(row => row.map(() => undefined));
  const numericColumns: number[] = [];
  header.forEach((head, column) => {
    const cells = rows.map((row, index) => ({ index, text: row[column] }))
      .filter(cell => cell.text && !RE_PLACEHOLDER.test(cell.text));
    const numeric: Array<{ index: number; value: number }> = [];
    for (const cell of cells) {
      const circle = CIRCLE_LEVELS[[...cell.text][0]];
      const number = RE_NUMBER.exec(cell.text);
      if (circle !== undefined) levels[cell.index][column] = circle;
      else if (number) numeric.push({ index: cell.index, value: parseFloat(number[1].replace(/,/g, '')) });
    }
    if (numeric.length === 0) return;
    numericColumns.push(column);
    const min = Math.min(...numeric.map(cell => cell.value));
    const max = Math.max(...numeric.map(cell => cell.value));
    if (max === min) return;
    for (const cell of numeric) {
      const level = Math.round((cell.value - min) / (max - min) * 4);
      levels[cell.index][column] = head.includes('↓') ? 4 - level : level;
    }
  });
  return { levels, numericColumns };
}
