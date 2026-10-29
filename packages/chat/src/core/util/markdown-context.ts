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
export function isRealArtifactOpenAt({ content, idx }: { content: string; idx: number }): boolean {
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
export function computeSkipRanges({ buffer }: { buffer: string }): {
  ranges: Range[];
  unclosedFenceStart: number | null;
} {
  const scan: LineScan = { ranges: [], blockRegions: [], fenceStart: -1, blockStart: -1 };
  for (const line of linesOf(buffer)) {
    if (scan.fenceStart === -1) visitLineOutsideFence(scan, line);
    else visitLineInsideFence(scan, line);
  }
  const unclosedFenceStart = scan.fenceStart === -1 ? null : scan.fenceStart;
  if (unclosedFenceStart === null) closeBlockBefore(scan, buffer.length); // flush an open paragraph region at end-of-buffer

  for (const [s, e] of scan.blockRegions) {
    for (const m of buffer.slice(s, e).matchAll(INLINE_CODE_RE)) {
      scan.ranges.push([s + m.index, s + m.index + m[0].length]);
    }
  }
  return { ranges: scan.ranges, unclosedFenceStart };
}

interface LineScan {
  ranges: Range[];
  // Paragraph-block regions are contiguous spans of paragraph lines outside
  // any fenced code block; inline-code scanning is restricted to one block at
  // a time so backticks never pair across a block boundary.
  blockRegions: Range[];
  /** Start of the currently open fence, or -1 when outside a fence. */
  fenceStart: number;
  /** Start of the currently open paragraph block, or -1 when none is open. */
  blockStart: number;
}

interface Line {
  start: number;
  end: number;
  text: string;
  hasNewline: boolean;
}

function* linesOf(buffer: string): Generator<Line> {
  let pos = 0;
  while (pos < buffer.length) {
    const eol = buffer.indexOf('\n', pos);
    if (eol === -1) {
      // trailing partial line — classified like any other, but never as a fence delimiter
      yield { start: pos, end: buffer.length, text: buffer.slice(pos), hasNewline: false };
      return;
    }
    yield { start: pos, end: eol, text: buffer.slice(pos, eol), hasNewline: true };
    pos = eol + 1;
  }
}

function closeBlockBefore(scan: LineScan, idx: number): void {
  if (scan.blockStart !== -1 && idx > scan.blockStart) scan.blockRegions.push([scan.blockStart, idx]);
  scan.blockStart = -1;
}

function visitLineInsideFence(scan: LineScan, line: Line): void {
  if (!line.hasNewline || !FENCE_CLOSE_RE.test(line.text)) return;
  scan.ranges.push([scan.fenceStart, line.end + 1]);
  scan.fenceStart = -1;
}

function visitLineOutsideFence(scan: LineScan, line: Line): void {
  if (line.hasNewline && FENCE_OPEN_RE.test(line.text)) {
    closeBlockBefore(scan, line.start);
    scan.fenceStart = line.start;
    return;
  }
  if (line.text.trim() === '') {
    closeBlockBefore(scan, line.start);
    return;
  }
  if (HEADING_RE.test(line.text) || UL_ITEM_RE.test(line.text) || OL_ITEM_RE.test(line.text)) {
    // Each heading/list-item line is its own inline-scan region rather
    // than joining adjacent paragraphs.
    closeBlockBefore(scan, line.start);
    scan.blockRegions.push([line.start, line.end]);
    return;
  }
  if (scan.blockStart === -1) scan.blockStart = line.start;
}

/** `true` when position `p` falls inside one of `ranges` (half-open intervals). */
export function rangeContains({ ranges, p }: { ranges: ReadonlyArray<Range>; p: number }): boolean {
  for (const [s, e] of ranges) {
    if (p >= s && p < e) return true;
  }
  return false;
}

export interface FencedCodeRange { start: number; end: number; body: string }

/** Permissive model-output fences used for recovery/transcript cleanup, independent of the
 * renderer's line-anchored fence grammar above. Opening whitespace is greedy through its last
 * newline; an empty block may require giving that last newline back to the closing delimiter.
 * Each opener and closing delimiter is scanned directly instead of backtracking across the body.
 */
export function* fencedCodeRanges({ content, opener }: { content: string; opener: RegExp }, _options = {}): Generator<FencedCodeRange> {
  const openings = new RegExp(opener.source, 'g');
  let opening = openings.exec(content);
  while (opening !== null) {
    const body = fencedBodyRange({ content, after: opening.index + opening[0].length });
    if (body === null) return; // No later closing fence exists for any subsequent opener either.
    if (body !== undefined) {
      yield { start: opening.index, end: body.end, body: content.slice(body.start, body.end - 4) };
      openings.lastIndex = body.end;
    }
    opening = openings.exec(content);
  }
}

/** Undefined is an invalid opener; null is a valid opener with no possible closing fence. */
function fencedBodyRange({ content, after }: { content: string; after: number }): { start: number; end: number } | null | undefined {
  let whitespaceEnd = after;
  while (whitespaceEnd < content.length && /\s/.test(content.charAt(whitespaceEnd))) whitespaceEnd += 1;
  const newlineOffset = content.slice(after, whitespaceEnd).indexOf('\n');
  if (newlineOffset === -1) return undefined;
  const firstNewline = after + newlineOffset;
  const lastNewline = content.lastIndexOf('\n', whitespaceEnd - 1);
  const close = content.indexOf('\n```', lastNewline + 1);
  if (close !== -1) return { start: lastNewline + 1, end: close + 4 };
  if (lastNewline === firstNewline || !content.startsWith('\n```', lastNewline)) return null;
  return { start: content.lastIndexOf('\n', lastNewline - 1) + 1, end: lastNewline + 4 };
}
