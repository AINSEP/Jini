/**
 * @module parser
 *
 * Streaming parser for `<artifact identifier="..." type="..." title="...">
 * ...</artifact>` tags. Handles one artifact at a time (no nesting). Feed
 * deltas in, iterate events — every event type has a stable meaning so
 * consumers don't need to rewrite their reducer if this parser is later
 * swapped for a fuller one.
 */
import { computeSkipRanges, FENCE_OPEN_RE, isRealArtifactOpenAt, rangeContains, type Range } from './markdown-context.js';
import { parseQuotedAttrs } from './markup-attributes.js';

export type ArtifactEvent =
  | { type: 'text'; delta: string }
  | { type: 'artifact:start'; identifier: string; artifactType: string; title: string }
  | { type: 'artifact:chunk'; identifier: string; delta: string }
  | { type: 'artifact:end'; identifier: string; fullContent: string };

const OPEN_PREFIX = '<artifact';
const CLOSE_TAG = '</artifact>';

interface ParserState {
  inside: boolean;
  buffer: string;
  identifier: string;
  artifactType: string;
  title: string;
  content: string;
}

type OpenTagMatch = { kind: 'complete'; start: number; end: number; attrs: string } | { kind: 'partial'; start: number } | { kind: 'none' };

const NO_OPEN: OpenTagMatch = { kind: 'none' };
const SKIP = { kind: 'skip' } as const;

interface SkipContext {
  buffer: string;
  ranges: ReadonlyArray<Range>;
}

// Scan the buffer for `<artifact …>` while skipping any positions that a
// Markdown renderer would render as a fenced code block or inline code span
// — see markdown-context.ts for the shared classification used by both this
// streaming parser and the post-stream `<artifact>` stripper.
//
// Streaming caveats handled here on top of the shared ranges:
//   * Open fence with no close yet → hold back from its opening line.
//   * Unterminated tail line that could still resolve into a fence delimiter
//     (e.g. "```", "```ht") → hold back from the line start.
//   * Unmatched opening backtick after the last \n → hold back from it; a
//     future chunk may turn it into an inline code span.
function findOpenTag(buffer: string): OpenTagMatch {
  const { ranges, unclosedFenceStart } = computeSkipRanges({ buffer: buffer });
  const ctx: SkipContext = { buffer, ranges };

  // Pass 1: scan for the earliest *complete* real `<artifact …>` open outside
  // any skip range, before any hold-back decision — otherwise a stray
  // backtick or fence-opener prefix on a tail line would suppress an
  // already self-contained artifact earlier in the buffer.
  const open = scanForOpen(ctx, { unclosedFenceStart });
  if (open.kind === 'complete') return open;

  // Pass 2: no complete open found. Decide whether to hold back, and if so,
  // from which position. Earliest hold-back wins so the text-flush boundary
  // never crosses something that might still resolve into a tag/fence/span.
  const holdbacks = [
    open.kind === 'partial' ? open.start : -1,
    unclosedFenceStart ?? -1,
    tailFenceHoldback(ctx),
    unmatchedBacktickHoldback(ctx),
    tailPrefixHoldback(ctx),
  ].filter((pos) => pos !== -1);
  if (holdbacks.length === 0) return NO_OPEN;
  return { kind: 'partial', start: Math.min(...holdbacks) };
}

function scanForOpen(ctx: SkipContext, { unclosedFenceStart }: { unclosedFenceStart: number | null }): OpenTagMatch {
  let idx = ctx.buffer.indexOf(OPEN_PREFIX);
  while (idx !== -1) {
    const found = classifyOpenAt(ctx, { idx, unclosedFenceStart });
    if (found.kind !== 'skip') return found;
    idx = ctx.buffer.indexOf(OPEN_PREFIX, idx + OPEN_PREFIX.length);
  }
  return NO_OPEN;
}

function classifyOpenAt(
  { buffer, ranges }: SkipContext,
  { idx, unclosedFenceStart }: { idx: number; unclosedFenceStart: number | null },
): OpenTagMatch | typeof SKIP {
  if (rangeContains({ ranges: ranges, p: idx })) return SKIP;
  // Anything past an unclosed fence opener is inside a code block that
  // will close in a later chunk; treat as skip range, not a real tag.
  if (unclosedFenceStart !== null && idx >= unclosedFenceStart) return NO_OPEN;
  const after = idx + OPEN_PREFIX.length;
  // `<artifact` at very end of buffer — could become real with the next
  // chunk. Remember the earliest one and keep looking for a complete tag.
  if (after === buffer.length) return { kind: 'partial', start: idx };
  if (!isRealArtifactOpenAt({ content: buffer, idx: idx })) return SKIP; // e.g. "<artifactual" — not a real open, keep scanning
  const close = findTagEnd({ buffer, from: after });
  // Ran out of buffer before the closing `>` arrived — an open tag mid-stream.
  if (close === -1) return { kind: 'partial', start: idx };
  return { kind: 'complete', start: idx, end: close + 1, attrs: buffer.slice(after, close) };
}

/** Index of the open tag's closing `>`, ignoring any `>` inside a quoted attribute value; -1 if not yet arrived. */
function findTagEnd({ buffer, from }: { buffer: string; from: number }): number {
  let quote: string | null = null;
  for (let j = from; j < buffer.length; j++) {
    const c = buffer.charAt(j);
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '>') return j;
    if (c === '"' || c === "'") quote = c;
  }
  return -1;
}

/** Start of an unterminated tail line that could still resolve into a fence delimiter; -1 otherwise. */
function tailFenceHoldback({ buffer }: SkipContext): number {
  const tailLineStart = buffer.lastIndexOf('\n') + 1;
  const tail = buffer.slice(tailLineStart);
  return FENCE_OPEN_RE.test(tail) || /^`{1,2}$/.test(tail) ? tailLineStart : -1;
}

/** Position of an unmatched opening backtick after the last `\n` (outside skip ranges); -1 otherwise. */
function unmatchedBacktickHoldback({ buffer, ranges }: SkipContext): number {
  let firstUnmatched = -1;
  for (let k = buffer.lastIndexOf('\n') + 1; k < buffer.length; k++) {
    if (buffer.charAt(k) !== '`' || rangeContains({ ranges: ranges, p: k })) continue;
    firstUnmatched = firstUnmatched === -1 ? k : -1;
  }
  return firstUnmatched;
}

// Strict prefix at the tail (e.g. "<art") — hold back.
function tailPrefixHoldback({ buffer, ranges }: SkipContext): number {
  const tailLt = buffer.lastIndexOf('<');
  if (tailLt === -1 || rangeContains({ ranges: ranges, p: tailLt })) return -1;
  const slice = buffer.slice(tailLt);
  return OPEN_PREFIX.startsWith(slice) && slice.length < OPEN_PREFIX.length ? tailLt : -1;
}

/**
 * Create a fresh streaming artifact parser. Call `feed({ delta })` for each
 * chunk as it arrives (iterate its generator to drain queued events), and
 * `flush()` once at end-of-stream to emit whatever is still buffered.
 *
 * @complexity Each `feed` call is O(buffer.length) — `findOpenTag` rescans
 *   the buffered tail (bounded by how far behind the caller is at draining
 *   the generator), which is the standard tradeoff for streaming tag
 *   detection over an ever-growing buffer.
 */
export function createArtifactParser(_requiredArgs: Record<string, never>): {
  feed: (args: { delta: string }) => Generator<ArtifactEvent>;
  flush: (args: Record<string, never>) => Generator<ArtifactEvent>;
} {
  const state: ParserState = {
    inside: false,
    buffer: '',
    identifier: '',
    artifactType: '',
    title: '',
    content: '',
  };

  function* feed({ delta }: { delta: string }): Generator<ArtifactEvent> {
    state.buffer += delta;
    let progressed = true;
    while (progressed && state.buffer.length > 0) {
      progressed = state.inside ? yield* drainInside() : yield* drainOutside();
    }
  }

  /** Emit text up to the next open tag; `true` when an artifact was opened and draining should continue. */
  function* drainOutside(): Generator<ArtifactEvent, boolean> {
    const open = findOpenTag(state.buffer);
    const textEnd = open.kind === 'none' ? state.buffer.length : open.start;
    if (textEnd > 0) {
      yield { type: 'text', delta: state.buffer.slice(0, textEnd) };
      state.buffer = state.buffer.slice(textEnd);
    }
    if (open.kind !== 'complete') return false;
    const attrs = parseQuotedAttrs({ raw: open.attrs });
    Object.assign(state, {
      inside: true,
      identifier: attrs['identifier'] ?? '',
      artifactType: attrs['type'] ?? '',
      title: attrs['title'] ?? '',
      content: '',
      buffer: state.buffer.slice(open.end - open.start),
    });
    yield {
      type: 'artifact:start',
      identifier: state.identifier,
      artifactType: state.artifactType,
      title: state.title,
    };
    return true;
  }

  /** Emit body up to the close tag; `true` when the artifact closed and draining should continue. */
  function* drainInside(): Generator<ArtifactEvent, boolean> {
    const closeIdx = state.buffer.indexOf(CLOSE_TAG);
    // Hold back enough bytes to detect a partial close tag at the tail.
    const chunkEnd = closeIdx === -1 ? state.buffer.length - (CLOSE_TAG.length - 1) : closeIdx;
    if (chunkEnd > 0) {
      const chunk = state.buffer.slice(0, chunkEnd);
      state.content += chunk;
      state.buffer = state.buffer.slice(chunkEnd);
      yield { type: 'artifact:chunk', identifier: state.identifier, delta: chunk };
    }
    if (closeIdx === -1) return false;
    yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };
    Object.assign(state, {
      inside: false,
      identifier: '',
      artifactType: '',
      title: '',
      content: '',
      buffer: state.buffer.slice(CLOSE_TAG.length),
    });
    return true;
  }

  function* flush(_requiredArgs: Record<string, never>): Generator<ArtifactEvent> {
    const wasInside = state.inside;
    if (wasInside) {
      if (state.buffer.length > 0) {
        state.content += state.buffer;
        yield { type: 'artifact:chunk', identifier: state.identifier, delta: state.buffer };
        state.buffer = '';
      }
      yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };
    }
    if (!wasInside && state.buffer.length > 0) {
      yield { type: 'text', delta: state.buffer };
    }
    state.buffer = '';
    state.inside = false;
  }

  return { feed, flush };
}

/**
 * Convenience wrapper over {@link createArtifactParser} for the common
 * non-streaming case: parse a complete string in one call. Matches the
 * `parseArtifacts()` name from the target API — feeds the whole content
 * through a fresh parser instance and flushes it, collecting every event.
 *
 * @param content - A complete (already fully-arrived) message body.
 * @complexity O(n) in `content.length` (one `feed` + one `flush` over the whole string).
 */
export function parseArtifacts({ content }: { content: string }): ArtifactEvent[] {
  const parser = createArtifactParser({});
  return [...parser.feed({ delta: content }), ...parser.flush({})];
}
