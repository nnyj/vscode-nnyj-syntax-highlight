import type {
  Root,
  Node,
  Strong,
  Emphasis,
  Heading,
  InlineCode,
  Code,
  Link,
  Image,
  Delete,
  Blockquote,
  ListItem,
  ThematicBreak,
  Text,
  Table,
  TableCell,
} from "mdast";
import {
  addScope as addScopeHelper,
  dedupeScopes as dedupeScopesHelper,
  hasValidPosition as hasValidPositionHelper,
  isInCodeBlock as isInCodeBlockHelper,
} from "./common";
import {
  processFrontmatter as processFrontmatterHelper,
} from "./frontmatter";
import {
  filterDecorationsInCodeBlocks as filterDecorationsInCodeBlocksHelper,
  scanMentionAndIssueRefs as scanMentionAndIssueRefsHelper,
} from "./mentions";
import {
  cellHasMixedFormatting as cellHasMixedFormattingHelper,
  computeColumnWidths as computeColumnWidthsHelper,
  detectCellStyle as detectCellStyleHelper,
  extractCellPlainText as extractCellPlainTextHelper,
  findPipePositions as findPipePositionsHelper,
  getLineRange as getLineRangeHelper,
  measureTextWidth as measureTextWidthHelper,
  normalizePipePositions as normalizePipePositionsHelper,
  trimLineEnd as trimLineEndHelper,
} from "./tables";
import {
  processEmphasis as processEmphasisHelper,
  processHeading as processHeadingHelper,
  processInlineCode as processInlineCodeHelper,
  processStrikethrough as processStrikethroughHelper,
  processStrong as processStrongHelper,
} from "./inline-formatting";
import { processCodeBlock as processCodeBlockHelper } from "./code-blocks";
import {
  processBlockquote as processBlockquoteHelper,
  processListItem as processListItemHelper,
  processThematicBreak as processThematicBreakHelper,
} from "./list-quote";
import {
  handleEmptyImageAlt as handleEmptyImageAltHelper,
  processEmojiShortcodesInSlice as processEmojiShortcodesInSliceHelper,
  processTextNode as processTextNodeHelper,
} from "./text-processing";
import { getRemarkProcessorSync, getRemarkProcessor } from "../parser-remark";
import { getEmojiMap } from "../emoji-map-loader";
import { scanMathRegions } from "../math/math-scanner";
import { config } from "../config";
import { logError, logWarn } from "../logging";
import { normalizeToLF } from "../position-mapping";
import {
  DecorationRange,
  MermaidBlock,
  ParseResult,
  ScopeRange,
} from "./types";

/**
 * Type for the unified processor used to parse markdown text to a Root AST node.
 *
 * The processor is created by the `unified()` function from the unified ecosystem
 * and configured with remark-parse and remark-gfm plugins.
 */
type UnifiedProcessor = {
  parse: (text: string) => Root;
};

/**
 * Type for the visit function from unist-util-visit.
 *
 * Traverses nodes in a tree structure (AST) and calls the visitor function
 * for each node. The visitor receives: node, index (optional), parent (optional).
 */
type VisitFunction = (
  tree: Root,
  visitor: (node: Node, index?: number, parent?: Node) => void,
) => void;

/**
 * A parser that extracts decoration ranges from markdown text.
 *
 * This class uses `remark` to parse the input markdown and determines ranges for:
 * - Markdown syntax markers (for hiding, e.g., `**`, `#`, `` ` ``)
 * - Content (for applying styles such as bold, italic, headings, etc.)
 *
 * @class MarkdownParser
 * @example
 * // Synchronous usage (VS Code extension):
 * const parser = new MarkdownParser();
 * const decorations = parser.extractDecorations('# Heading\n**bold** text');
 *
 * // Asynchronous usage (ESM tests):
 * const parser = await MarkdownParser.create();
 * const decorations = parser.extractDecorations('# Heading\n**bold** text');
 */
export class MarkdownParser {
  private processor: UnifiedProcessor;
  private visit: VisitFunction;

  constructor() {
    const { unified, remarkParse, remarkGfm, visit } = getRemarkProcessorSync();
    this.visit = visit;
    this.processor = unified().use(remarkParse).use(remarkGfm);
  }

  /**
   * Async factory method to create a MarkdownParser instance.
   * Uses dynamic imports to support ESM modules in test environments.
   *
   * @returns {Promise<MarkdownParser>} A promise that resolves to a MarkdownParser instance
   */
  static async create(): Promise<MarkdownParser> {
    const parser = Object.create(MarkdownParser.prototype);
    const { unified, remarkParse, remarkGfm, visit } =
      await getRemarkProcessor();
    parser.visit = visit;
    parser.processor = unified().use(remarkParse).use(remarkGfm);
    return parser;
  }

  /**
   * Extracts decoration ranges from markdown text.
   *
   * @param {string} text - The markdown text to parse
   * @returns {DecorationRange[]} Array of decoration ranges, sorted by startPos
   */
  extractDecorations(text: string): DecorationRange[] {
    return this.extractDecorationsWithScopes(text).decorations;
  }

  /**
   * Extracts decoration ranges and explicit scope ranges from markdown text.
   *
   * @param {string} text - The markdown text to parse
   * @returns {ParseResult} Decorations and scopes, sorted by startPos
   */
  extractDecorationsWithScopes(text: string): ParseResult {
    if (!text || typeof text !== "string") {
      return {
        decorations: [],
        scopes: [],
        mermaidBlocks: [],
        mathRegions: [],
      };
    }

    // Normalize line endings to \n for consistent position tracking
    // Optimization: Only normalize if document contains CRLF
    const normalizedText = normalizeToLF(text);

    const decorations: DecorationRange[] = [];
    const scopes: ScopeRange[] = [];
    const mermaidBlocks: MermaidBlock[] = [];

    // Process frontmatter before remark parsing to avoid conflicts with thematic break detection
    processFrontmatterHelper(normalizedText, decorations, scopes);

    try {
      // Parse markdown into AST
      const ast = this.processor.parse(normalizedText) as Root;

      // Process AST nodes and extract decorations + scopes
      this.processAST(ast, normalizedText, decorations, scopes, mermaidBlocks);

      // Handle edge cases: empty image alt text that remark doesn't parse as Image node
      handleEmptyImageAltHelper(normalizedText, decorations);

      // GitHub-style mentions and issue references (@username, @org/team, #123, @user/repo#456)
      if (config.mentions.enabled()) {
        scanMentionAndIssueRefsHelper(normalizedText, decorations, scopes);
      }

      // Safety net: Remove any markdown formatting decorations that fall within code blocks
      // Ancestor checks in processors prevent most cases, but this catches edge cases
      filterDecorationsInCodeBlocksHelper(decorations, scopes, normalizedText);

      // Sort decorations by start position
      decorations.sort((a, b) => a.startPos - b.startPos);
    } catch (error) {
      // Gracefully handle parse errors
      logError('Error parsing markdown', error);
    }

    return {
      decorations,
      scopes: dedupeScopesHelper(scopes),
      mermaidBlocks,
      mathRegions: scanMathRegions(normalizedText, decorations.filter(decoration =>
        decoration.type === 'tablePipe' || decoration.type === 'tableSeparatorPipe').map(decoration => decoration.startPos),
        decorations.filter(decoration => decoration.type === 'code' || decoration.type === 'codeBlock')),
    };
  }

  /**
   * Processes the remark AST to extract decoration ranges.
   *
   * Uses a proper visitor pattern with ancestor tracking for efficient traversal.
   *
   * @private
   * @param {Root} ast - The parsed AST root node
   * @param {string} text - The original markdown text
   * @param {DecorationRange[]} decorations - Array to accumulate decorations
   */
  private processAST(
    ast: Root,
    text: string,
    decorations: DecorationRange[],
    scopes: ScopeRange[],
    mermaidBlocks: MermaidBlock[],
  ): void {
    // Track processed blockquote positions to avoid duplicates from nested blockquotes
    const processedBlockquotePositions = new Set<number>();

    // Use a map to efficiently track ancestors for each node
    const ancestorMap = new Map<Node, Node[]>();

    this.visit(
      ast,
      (node: Node, index: number | undefined, parent: Node | undefined) => {
        // Optimization: Trust remark's position data in hot path
        // Individual process methods still validate for safety
        try {
          // Build ancestor chain efficiently using parent's cached ancestors
          const currentAncestors: Node[] = [];
          if (parent) {
            currentAncestors.push(parent);
            // Get parent's ancestors from cache (O(1) lookup instead of O(n) search)
            const parentAncestors = ancestorMap.get(parent);
            if (parentAncestors) {
              currentAncestors.push(...parentAncestors);
            }
          }

          // Cache this node's ancestors for its children to use
          if (currentAncestors.length > 0) {
            ancestorMap.set(node, currentAncestors);
          }

          switch (node.type) {
            case "heading":
              processHeadingHelper(
                node as Heading,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "strong":
              processStrongHelper(
                node as Strong,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "emphasis":
              processEmphasisHelper(
                node as Emphasis,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "delete":
              processStrikethroughHelper(
                node as Delete,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "inlineCode":
              processInlineCodeHelper(
                node as InlineCode,
                text,
                decorations,
                scopes,
              );
              break;

            case "code":
              processCodeBlockHelper(
                node as Code,
                text,
                decorations,
                scopes,
                mermaidBlocks,
              );
              break;

            case "link":
              this.processLink(
                node as Link,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "image":
              this.processImage(
                node as Image,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "blockquote":
              processBlockquoteHelper(
                node as Blockquote,
                text,
                decorations,
                scopes,
                processedBlockquotePositions,
                currentAncestors,
              );
              break;

            case "listItem":
              processListItemHelper(
                node as ListItem,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "thematicBreak":
              processThematicBreakHelper(
                node as ThematicBreak,
                decorations,
                scopes,
                currentAncestors,
              );
              break;

            case "text":
              processTextNodeHelper(
                node as Text,
                decorations,
                scopes,
                currentAncestors,
                (slice, offset, outDecorations, outScopes) =>
                  processEmojiShortcodesInSliceHelper(
                    slice,
                    offset,
                    outDecorations,
                    outScopes,
                    getEmojiMap(),
                  ),
              );
              break;

            case "table":
              this.processTable(
                node as Table,
                text,
                decorations,
                scopes,
                currentAncestors,
              );
              break;
          }
        } catch (error) {
          // Gracefully handle invalid positions or processing errors
          // Individual methods still validate, so this catches unexpected issues
          logWarn('Error processing AST node', error, { nodeType: node.type });
        }
      },
    );
  }

  /**
   * Processes a link node.
   *
   * Skips processing if the link is inside a code block or inline code,
   * as links should not be parsed inside code contexts.
   */
  private processLink(
    node: Link,
    text: string,
    decorations: DecorationRange[],
    scopes: ScopeRange[],
    ancestors: Node[],
  ): void {
    if (!hasValidPositionHelper(node)) return;

    // Don't parse links inside code blocks
    if (isInCodeBlockHelper(ancestors)) {
      return;
    }

    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;

    // Explicit bracket-style link [text](url): always use regular link rendering so that
    // [bob@email.com](mailto:bob@email.com) and [url](url) hide delimiters and URL.
    if (text[start] === "[") {
      // Fall through to "Regular bracket-style link" path below.
    } else {
      // Detect autolinks and bare links using AST structure: link text equals the URL
      // (or URL without mailto: prefix for email autolinks)
      const firstChild = node.children?.[0];
      const linkText =
        firstChild && firstChild.type === "text" ? firstChild.value : "";
      const url = node.url || "";
      const urlWithoutMailto = url.replace(/^mailto:/, "");
      const isAutolinkOrBareLink =
        linkText === url || linkText === urlWithoutMailto;

      if (isAutolinkOrBareLink) {
        // Check if it's an autolink (has angle brackets) or bare link (no brackets)
        const hasAngleBrackets = text[start] === "<" && text[end - 1] === ">";

        if (hasAngleBrackets) {
          // Process autolink - use text child position for accurate content range
          const textChild =
            firstChild && firstChild.type === "text" ? firstChild : null;
          const contentStart = textChild?.position?.start.offset ?? start + 1;
          const contentEnd = textChild?.position?.end.offset ?? end - 1;

          // Hide opening angle bracket
          decorations.push({
            startPos: start,
            endPos: start + 1,
            type: "hide",
          });

          // Add link decoration for content (between angle brackets)
          if (contentStart < contentEnd) {
            decorations.push({
              startPos: contentStart,
              endPos: contentEnd,
              type: "link",
              url: url, // Use URL from AST (remark-gfm already handles mailto: for emails)
            });
          }

          // Hide closing angle bracket
          decorations.push({
            startPos: end - 1,
            endPos: end,
            type: "hide",
          });

          // Add scope for reveal-on-select behavior
          addScopeHelper(scopes, start, end, "link");
        } else {
          // Process bare link (no angle brackets) - just apply link decoration
          const textChild =
            firstChild && firstChild.type === "text" ? firstChild : null;
          const contentStart = textChild?.position?.start.offset ?? start;
          const contentEnd = textChild?.position?.end.offset ?? end;

          // Add link decoration for the URL/email text
          if (contentStart < contentEnd) {
            decorations.push({
              startPos: contentStart,
              endPos: contentEnd,
              type: "link",
              url: url, // Use URL from AST (remark-gfm already handles mailto: for emails)
            });
          }

          // Add scope for reveal-on-select behavior
          addScopeHelper(scopes, start, end, "link");
        }
        return;
      }
    }

    // Regular bracket-style link: [text](url)
    // Find opening bracket [
    const bracketStart = text.indexOf("[", start);
    if (bracketStart === -1) return;

    // Find closing bracket ]
    const bracketEnd = text.indexOf("]", bracketStart);
    if (bracketEnd === -1) return;

    // Hide opening bracket
    decorations.push({
      startPos: bracketStart,
      endPos: bracketStart + 1,
      type: "hide",
    });

    // Add link decoration for text (between brackets)
    const contentStart = bracketStart + 1;
    if (contentStart < bracketEnd) {
      // Extract URL from the link node
      const url = node.url || "";

      decorations.push({
        startPos: contentStart,
        endPos: bracketEnd,
        type: "link",
        url: url,
      });
    }

    // Hide closing bracket
    decorations.push({
      startPos: bracketEnd,
      endPos: bracketEnd + 1,
      type: "hide",
    });

    // Find and hide URL part (url)
    const parenStart = text.indexOf("(", bracketEnd);
    if (parenStart !== -1 && parenStart === bracketEnd + 1) {
      // Hide opening parenthesis
      decorations.push({
        startPos: parenStart,
        endPos: parenStart + 1,
        type: "hide",
      });

      const parenEnd = text.indexOf(")", parenStart + 1);
      if (parenEnd !== -1 && parenEnd <= end) {
        // Hide URL content between parentheses
        const urlStart = parenStart + 1;
        if (urlStart < parenEnd) {
          decorations.push({
            startPos: urlStart,
            endPos: parenEnd,
            type: "hide",
          });
        }

        // Hide closing parenthesis
        decorations.push({
          startPos: parenEnd,
          endPos: parenEnd + 1,
          type: "hide",
        });
      }
    }

    addScopeHelper(scopes, start, end, "link");
  }

  /**
   * Processes an image node.
   */
  private processImage(
    node: Image,
    text: string,
    decorations: DecorationRange[],
    scopes: ScopeRange[],
    ancestors: Node[],
  ): void {
    if (!hasValidPositionHelper(node)) return;

    // Don't parse images inside code blocks
    if (isInCodeBlockHelper(ancestors)) {
      return;
    }

    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;

    // Find opening ![
    const exclamationStart = text.indexOf("![", start);
    if (exclamationStart === -1 || exclamationStart > start) return;

    // Hide ![
    decorations.push({
      startPos: exclamationStart,
      endPos: exclamationStart + 2,
      type: "hide",
    });

    // Find alt text (between [ and ])
    const altStart = exclamationStart + 2;
    const bracketEnd = text.indexOf("]", altStart);
    if (bracketEnd === -1) {
      // Even if no closing bracket found, try to hide what we can
      // This handles edge cases like ![] without proper syntax
      return;
    }

    // Add image decoration for alt text (even if empty)
    if (altStart <= bracketEnd) {
      const url = node.url || "";
      decorations.push({
        startPos: altStart,
        endPos: bracketEnd,
        type: "image",
        url,
      });

      // Image nodes from remark store alt text as a string (no child nodes),
      // so inline formatting like **bold** and *italic* inside the alt text
      // is not parsed by the main AST walk. We parse the alt slice separately
      // and add inline formatting decorations within the alt range.
      if (altStart < bracketEnd) {
        this.processInlineFormattingInImageAlt(
          text,
          decorations,
          scopes,
          altStart,
          bracketEnd,
        );
        processEmojiShortcodesInSliceHelper(
          text.substring(altStart, bracketEnd),
          altStart,
          decorations,
          scopes,
          getEmojiMap(),
        );
      }
    }

    // Hide closing bracket
    decorations.push({
      startPos: bracketEnd,
      endPos: bracketEnd + 1,
      type: "hide",
    });

    // Find and hide URL part
    const parenStart = text.indexOf("(", bracketEnd);
    if (parenStart !== -1) {
      // Allow for optional space between ] and (
      const between = text.substring(bracketEnd + 1, parenStart);
      const hasOnlyWhitespaceBetween =
        between.length > 0 && between.trim().length === 0;
      if (parenStart === bracketEnd + 1 || hasOnlyWhitespaceBetween) {
        // Hide whitespace between ] and ( if present
        if (hasOnlyWhitespaceBetween) {
          decorations.push({
            startPos: bracketEnd + 1,
            endPos: parenStart,
            type: "hide",
          });
        }

        decorations.push({
          startPos: parenStart,
          endPos: parenStart + 1,
          type: "hide",
        });

        const parenEnd = text.indexOf(")", parenStart + 1);
        if (parenEnd !== -1 && parenEnd <= end) {
          const urlStart = parenStart + 1;
          if (urlStart < parenEnd) {
            decorations.push({
              startPos: urlStart,
              endPos: parenEnd,
              type: "hide",
            });
          }

          decorations.push({
            startPos: parenEnd,
            endPos: parenEnd + 1,
            type: "hide",
          });
        }
      }
    }

    addScopeHelper(scopes, start, end, "image");
  }

  /**
   * Parses inline markdown inside an image's alt text and emits decorations.
   *
   * Remark's mdast `image` node stores `alt` as a plain string (no inline children),
   * so formatting inside the alt text is not present in the main AST traversal.
   *
   * This method parses only the alt slice (fast path + early exits) and maps the
   * resulting node positions back into the original (normalized) document offsets.
   *
   * Note: This is only called for images that are NOT inside code blocks (checked in processImage).
   */
  private processInlineFormattingInImageAlt(
    text: string,
    decorations: DecorationRange[],
    scopes: ScopeRange[],
    altStart: number,
    altEnd: number,
  ): void {
    if (altStart >= altEnd) return;

    const altText = text.substring(altStart, altEnd);

    // Fast path: avoid parsing when there are no inline marker characters
    const hasInlineMarkers =
      altText.indexOf("*") !== -1 ||
      altText.indexOf("_") !== -1 ||
      altText.indexOf("~") !== -1 ||
      altText.indexOf("`") !== -1;
    if (!hasInlineMarkers) return;

    let altAst: Root;
    try {
      altAst = this.processor.parse(altText) as Root;
    } catch {
      return;
    }

    const ancestorMap = new Map<Node, Node[]>();
    const absCache = new WeakMap<Node, Node>();

    const toAbsoluteNode = <T extends Node>(node: T): T => {
      const cached = absCache.get(node);
      if (cached) return cached as T;

      if (
        !node.position ||
        node.position.start.offset === undefined ||
        node.position.end.offset === undefined
      ) {
        absCache.set(node, node);
        return node;
      }

      const absNode = {
        ...node,
        position: {
          ...node.position,
          start: {
            ...node.position.start,
            offset: altStart + (node.position.start.offset ?? 0),
          },
          end: {
            ...node.position.end,
            offset: altStart + (node.position.end.offset ?? 0),
          },
        },
      } as T;

      absCache.set(node, absNode as unknown as Node);
      return absNode;
    };

    const toAbsoluteAncestors = (ancestors: Node[]): Node[] =>
      ancestors.map(toAbsoluteNode);

    this.visit(
      altAst,
      (node: Node, _index: number | undefined, parent: Node | undefined) => {
        const currentAncestors: Node[] = [];
        if (parent) {
          currentAncestors.push(parent);
          const parentAncestors = ancestorMap.get(parent);
          if (parentAncestors) {
            currentAncestors.push(...parentAncestors);
          }
        }

        if (currentAncestors.length > 0) {
          ancestorMap.set(node, currentAncestors);
        }

        try {
          switch (node.type) {
            case "strong":
              processStrongHelper(
                toAbsoluteNode(node as Strong),
                text,
                decorations,
                scopes,
                toAbsoluteAncestors(currentAncestors),
              );
              break;
            case "emphasis":
              processEmphasisHelper(
                toAbsoluteNode(node as Emphasis),
                text,
                decorations,
                scopes,
                toAbsoluteAncestors(currentAncestors),
              );
              break;
            case "delete":
              processStrikethroughHelper(
                toAbsoluteNode(node as Delete),
                text,
                decorations,
                scopes,
                toAbsoluteAncestors(currentAncestors),
              );
              break;
            case "inlineCode":
              processInlineCodeHelper(
                toAbsoluteNode(node as InlineCode),
                text,
                decorations,
                scopes,
              );
              break;
          }
        } catch {
          // Be conservative: never fail the main image parsing because the alt slice is malformed.
        }
      },
    );
  }

  /**
   * Processes a GFM table node and emits decorations for pipes, cells, and the separator row.
   *
   * Produces:
   * - `tablePipe` decorations for `|` in header and data rows (replaced with `│`)
   * - `tableSeparatorPipe` decorations for `|` in the separator row (replaced with `├`, `┼`, or `┤`)
   * - `tableSeparatorDash` decorations for dash segments in the separator row (replaced with `─` repeats)
   * - `tableCell` decorations for cell content (padded to uniform column width)
   *
   * Also adds a scope for the entire table so the visibility model can reveal the
   * whole block when the cursor is inside it.
   */
  private processTable(
    node: Table,
    text: string,
    decorations: DecorationRange[],
    scopes: ScopeRange[],
    ancestors: Node[],
  ): void {
    if (!hasValidPositionHelper(node)) return;

    // Don't process tables inside code blocks
    if (isInCodeBlockHelper(ancestors)) {
      return;
    }

    const tableStart = node.position!.start.offset!;
    const tableEnd = node.position!.end.offset!;
    const colWidths = computeColumnWidthsHelper(node, text);
    const colAligns = node.align ?? [];

    addScopeHelper(scopes, tableStart, tableEnd, "table");

    for (let rowIdx = 0; rowIdx < node.children.length; rowIdx++) {
      const row = node.children[rowIdx];
      if (
        !row.position ||
        row.position.start.offset === undefined ||
        row.position.end.offset === undefined
      ) {
        continue;
      }

      const rowStartOffset = row.position.start.offset;
      const [lineStart, lineEnd] = getLineRangeHelper(text, rowStartOffset);
      const trimmedLineEnd = trimLineEndHelper(text, lineStart, lineEnd);
      const rawPipes = findPipePositionsHelper(text, lineStart, trimmedLineEnd);
      const { positions: pipes, isVirtual } = normalizePipePositionsHelper(
        text, lineStart, trimmedLineEnd, rawPipes,
      );

      // Only decorate real (non-virtual) pipes
      for (let pIdx = 0; pIdx < pipes.length; pIdx++) {
        if (!isVirtual[pIdx]) {
          decorations.push({
            startPos: pipes[pIdx],
            endPos: pipes[pIdx] + 1,
            type: "tablePipe",
            replacement: "\u2502", // │
          });
        }
      }

      // Derive cells from pipe positions (avoids remark cell positions which include pipes)
      for (let i = 0; i < pipes.length - 1; i++) {
        const cellRangeStart = pipes[i] + 1;
        const cellRangeEnd = pipes[i + 1];
        if (cellRangeStart >= cellRangeEnd) continue;

        const rawContent = text.substring(cellRangeStart, cellRangeEnd);
        const trimmedContent = rawContent.trim();
        const cellStyle = detectCellStyleHelper(trimmedContent);
        const colWidth = i < colWidths.length ? colWidths[i] : 3;

        // Whole-cell styled: extract clean text via AST + apply CSS
        // Mixed formatting: show raw syntax (VS Code can't partially style)
        // Plain / escaped: use AST extraction (handles \| → |, \\ → \)
        const astCell = i < row.children.length ? row.children[i] as TableCell : undefined;
        const showRaw = !cellStyle && astCell && cellHasMixedFormattingHelper(astCell);
        const displayContent = (astCell && !showRaw)
          ? extractCellPlainTextHelper(astCell)
          : trimmedContent;
        const displayWidth = measureTextWidthHelper(displayContent);
        const totalPad = Math.max(0, colWidth - displayWidth);
        const align = i < colAligns.length ? colAligns[i] : null;

        let replacement: string;
        if (align === "right") {
          replacement = "\u00A0".repeat(totalPad + 1) + displayContent + "\u00A0";
        } else if (align === "center") {
          const padLeft = Math.floor(totalPad / 2);
          const padRight = totalPad - padLeft;
          replacement = "\u00A0".repeat(padLeft + 1) + displayContent + "\u00A0".repeat(padRight + 1);
        } else {
          // left or null (default)
          replacement = "\u00A0" + displayContent + "\u00A0".repeat(totalPad + 1);
        }

        decorations.push({
          startPos: cellRangeStart,
          endPos: cellRangeEnd,
          type: "tableCell",
          replacement,
          cellStyle,
        });
      }

      // After the header row (index 0), process the separator row.
      // remark-gfm does NOT include the separator row as a child node.
      if (rowIdx === 0) {
        const headerEndOffset = row.position.end.offset;

        let sepLineStart = text.indexOf("\n", headerEndOffset);
        if (sepLineStart === -1) continue;
        sepLineStart += 1;

        let sepLineEnd: number;
        if (node.children.length > 1 && node.children[1].position) {
          const nextRowStart = node.children[1].position.start.offset!;
          sepLineEnd = text.lastIndexOf("\n", nextRowStart - 1);
          if (sepLineEnd === -1 || sepLineEnd < sepLineStart) {
            sepLineEnd = nextRowStart;
          }
        } else {
          sepLineEnd = text.indexOf("\n", sepLineStart);
          if (sepLineEnd === -1) sepLineEnd = tableEnd;
        }

        const trimmedSepEnd = trimLineEndHelper(text, sepLineStart, sepLineEnd);
        const rawSepPipes = findPipePositionsHelper(text, sepLineStart, trimmedSepEnd);
        const { positions: sepPipes, isVirtual: sepIsVirtual } = normalizePipePositionsHelper(
          text, sepLineStart, trimmedSepEnd, rawSepPipes,
        );

        // Use │ for separator pipes (same as data rows) and ASCII - for
        // dashes. Box-drawing ─ (U+2500) renders wider than monospace chars
        // in many editor fonts, causing cumulative misalignment.
        for (let pIdx = 0; pIdx < sepPipes.length; pIdx++) {
          if (!sepIsVirtual[pIdx]) {
            decorations.push({
              startPos: sepPipes[pIdx],
              endPos: sepPipes[pIdx] + 1,
              type: "tableSeparatorPipe",
              replacement: "\u2502", // │ (same as regular pipe)
            });
          }
        }

        for (let pIdx = 0; pIdx < sepPipes.length - 1; pIdx++) {
          const segStart = sepPipes[pIdx] + 1;
          const segEnd = sepPipes[pIdx + 1];
          if (segStart >= segEnd) continue;

          const colWidth = pIdx < colWidths.length ? colWidths[pIdx] : 3;
          decorations.push({
            startPos: segStart,
            endPos: segEnd,
            type: "tableSeparatorDash",
            replacement: "-".repeat(colWidth + 2),
          });
        }
      }
    }
  }
}
