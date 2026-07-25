/**
 * @module markdown-context
 * @internal
 *
 * Shared Markdown-context helpers used by both the streaming artifact parser
 * ({@link ./parser.js}) and the post-stream `<artifact>` stripper
 * ({@link ./strip.js}). The single source of truth for what counts as a
 * fenced code block or an inline code span, so the parser/stripper's view of
 * a buffer matches what a Markdown-rendering chat surface will actually
 * render — anything that "looks like" an artifact tag inside one of these
 * regions is literal Markdown and must not be treated as a real protocol tag.
 *
 * Not part of the package's public surface (no `index.ts` re-export): it is
 * an implementation detail shared by two sibling modules, not a name a
 * consumer should depend on directly.
 */

// Line-anchored fence delimiters. Deliberately asymmetric: an opening fence
// may carry an info string (e.g. ```html), a closing fence must be a bare
// triple-backtick line. Neither permits leading indentation — an indented
// "   ```" line renders as a paragraph, not a fence.
export const FENCE_OPEN_RE = /^```(\w[\w+-]*)?\s*$/;
export const FENCE_CLOSE_RE = /^```\s*$/;

// Inline code span (single-backtick pair).
export const INLINE_CODE_RE = /`[^`]+`/g;

// Paragraph-break recognizers — mirror a typical Markdown paragraph-block
// walker's block-starter set (heading / list item / blank line). A block
// boundary caps how far inline-code backtick pairing can reach: backticks
// never pair across it in the rendered output.
const HEADING_RE = /^#{1,4}\s+/;
const UL_ITEM_RE = /^\s*[-*+]\s+/;
const OL_ITEM_RE = /^\s*\d+\.\s+/;

/**
 * `<artifact` followed by whitespace is a real protocol open tag; any other
 * continuation (e.g. `<artifactual`) is a prefix-shared literal that must
 * not be treated as a tag.
 */
export function isRealArtifactOpenAt(content: string, idx: number): boolean {
  const next = content.charAt(idx + '<artifact'.length);
  return next !== '' && /\s/.test(next);
}

export type Range = readonly [number, number];

/**
 * Compute the half-open `[start, end)` ranges of `buffer` that a Markdown
 * renderer would treat as fenced code blocks or inline code spans. The
 * `unclosedFenceStart` is the index of an opening fence with no matching
 * close in the buffer (or `null` if every fence is closed) — the streaming
 * parser uses it to hold back rendering; the stripper ignores it.
 *
 * Lines without a terminating `\n` (a trailing partial line during
 * streaming) are not classified as fence delimiters here; callers that care
 * about partial-tail behavior inspect the tail themselves.
 *
 * @complexity O(n) in `buffer.length` — one line-by-line scan plus one
 *   backtick scan per accumulated paragraph block.
 */
export function computeSkipRanges(buffer: string): {
  ranges: Range[];
  unclosedFenceStart: number | null;
} {
  const ranges: Range[] = [];
  // Paragraph-block regions are contiguous spans of paragraph lines outside
  // any fenced code block; inline-code scanning is restricted to one block at
  // a time so backticks never pair across a block boundary.
  const blockRegions: Range[] = [];

  let pos = 0;
  let inFence = false;
  let fenceStart = -1;
  let blockStart = -1;
  const closeBlockBefore = (idx: number) => {
    if (blockStart !== -1 && idx > blockStart) blockRegions.push([blockStart, idx]);
    blockStart = -1;
  };
  while (pos < buffer.length) {
    const eol = buffer.indexOf('\n', pos);
    const lineEnd = eol === -1 ? buffer.length : eol;
    const line = buffer.slice(pos, lineEnd);
    const lineHasNewline = eol !== -1;
    if (!inFence) {
      if (lineHasNewline && FENCE_OPEN_RE.test(line)) {
        closeBlockBefore(pos);
        inFence = true;
        fenceStart = pos;
      } else if (line.trim() === '') {
        closeBlockBefore(pos);
      } else if (HEADING_RE.test(line) || UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) {
        // Each heading/list-item line is its own inline-scan region rather
        // than joining adjacent paragraphs.
        closeBlockBefore(pos);
        blockRegions.push([pos, lineEnd]);
      } else {
        if (blockStart === -1) blockStart = pos;
      }
    } else if (lineHasNewline && FENCE_CLOSE_RE.test(line)) {
      inFence = false;
      ranges.push([fenceStart, eol + 1]);
      fenceStart = -1;
    }
    if (!lineHasNewline) break; // trailing partial line — already accounted for above
    pos = eol + 1;
  }
  if (!inFence) closeBlockBefore(buffer.length); // flush an open paragraph region at end-of-buffer

  for (const [s, e] of blockRegions) {
    INLINE_CODE_RE.lastIndex = 0;
    const segment = buffer.slice(s, e);
    let m: RegExpExecArray | null = INLINE_CODE_RE.exec(segment);
    while (m !== null) {
      ranges.push([s + m.index, s + m.index + m[0].length]);
      m = INLINE_CODE_RE.exec(segment);
    }
  }

  return { ranges, unclosedFenceStart: inFence ? fenceStart : null };
}

/** `true` when position `p` falls inside one of `ranges` (half-open intervals). */
export function rangeContains(ranges: ReadonlyArray<Range>, p: number): boolean {
  for (const [s, e] of ranges) {
    if (p >= s && p < e) return true;
  }
  return false;
}
