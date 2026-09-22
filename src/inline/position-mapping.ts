/**
 * Utility functions for mapping positions between normalized and original text.
 * 
 * The markdown parser normalizes line endings (CRLF -> LF) before parsing.
 * Remark's positions are based on normalized text. VS Code's positionAt()
 * uses the actual document text. These utilities help map between the two.
 */

/**
 * Normalizes any mix of CRLF/CR line endings to LF.
 *
 * @param text - Source text with arbitrary line endings
 * @returns Text normalized to LF-only line endings
 */
export function normalizeToLF(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n|\r/g, '\n') : text;
}

let cached_original_text: string | undefined;
let cached_crlf_positions: number[] = [];

/**
 * Maps a position from normalized text (LF only) to original document text.
 * This accounts for CRLF -> LF normalization done by the parser.
 * 
 * @param normalizedPos - Position in normalized text
 * @param originalText - Original document text (may contain CRLF)
 * @returns Position in original document text
 * 
 * @example
 * ```typescript
 * const normalized = 'Line 1\nLine 2';  // LF only
 * const original = 'Line 1\r\nLine 2';  // CRLF
 * const pos = mapNormalizedToOriginal(6, original); // Returns 6 (at '\r')
 * ```
 */
export function mapNormalizedToOriginal(normalizedPos: number, originalText?: string): number {
  if (!originalText) {
    return normalizedPos;
  }

  if (originalText !== cached_original_text) {
    cached_original_text = originalText;
    cached_crlf_positions = [];

    let search_from = 0;
    let crlf_index = originalText.indexOf('\r\n', search_from);
    while (crlf_index !== -1) {
      cached_crlf_positions.push(crlf_index - cached_crlf_positions.length);
      search_from = crlf_index + 2;
      crlf_index = originalText.indexOf('\r\n', search_from);
    }
  }

  if (cached_crlf_positions.length === 0) {
    return normalizedPos;
  }

  const normalized_length = originalText.length - cached_crlf_positions.length;
  if (!Number.isInteger(normalizedPos) || normalizedPos < 0 || normalizedPos >= normalized_length) {
    return originalText.length;
  }

  let lower_bound = 0;
  let upper_bound = cached_crlf_positions.length;
  while (lower_bound < upper_bound) {
    const middle = Math.floor((lower_bound + upper_bound) / 2);
    if (cached_crlf_positions[middle] < normalizedPos) {
      lower_bound = middle + 1;
    } else {
      upper_bound = middle;
    }
  }

  return normalizedPos + lower_bound;
}

/**
 * Normalizes heading text to anchor format.
 * 
 * Converts heading text to the format used in markdown anchor links:
 * - Converts to lowercase
 * - Removes non-word characters (except spaces and hyphens)
 * - Replaces spaces with hyphens
 * - Collapses multiple hyphens into single hyphen
 * - Trims leading/trailing whitespace
 * 
 * This matches the GitHub Flavored Markdown (GFM) anchor link generation algorithm.
 * 
 * @param text - The heading text to normalize
 * @returns Normalized anchor text
 * 
 * @example
 * ```typescript
 * normalizeAnchorText('Hello World!') // Returns 'hello-world'
 * normalizeAnchorText('  Test  123  ') // Returns 'test-123'
 * normalizeAnchorText('Multiple---Hyphens') // Returns 'multiple-hyphens'
 * ```
 */
export function normalizeAnchorText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
