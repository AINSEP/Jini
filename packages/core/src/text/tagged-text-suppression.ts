/**
 * @module core/text/tagged-text-suppression
 *
 * A streaming-text state machine that suppresses a tagged block (matched by
 * caller-supplied open/close patterns) from user-visible output while it's
 * still arriving — used to hide an artifact's raw markup from chat prose
 * while it streams in, without buffering the whole response first. Ported
 * from OD's `apps/daemon/src/artifacts/text-suppression.ts`.
 */

/** A single streamed text delta event. */
export type StreamTextEvent = { readonly type: 'text_delta'; readonly delta: string };
/** A sink for a streamed text delta event. */
export type StreamEventSink = (event: StreamTextEvent) => void;

/** A stateful stripper that buffers possible tag starts across streamed text deltas. */
export interface ArtifactTextSuppressor {
  /** Feeds the next text delta through the suppressor and returns the visible portion. */
  strip(required: { text: string }): string;
  /** Drains a pending candidate, or returns an empty string inside a suppressed block. */
  flush(): string;
  /** Whether a tagged block is currently being suppressed. */
  isSuppressing(): boolean;
  /** Whether a possible tag start is buffered but not yet resolved. */
  hasPendingCandidate(): boolean;
  /** A snapshot of the suppression counters. */
  stats(): ArtifactTextSuppressorStats;
}

/** Diagnostic counters describing an `ArtifactTextSuppressor`'s cumulative activity. */
export interface ArtifactTextSuppressorStats {
  readonly suppressedChars: number;
  readonly suppressedChunks: number;
  readonly openedBlocks: number;
  readonly closedBlocks: number;
  readonly pendingCandidateChars: number;
  readonly suppressing: boolean;
}

/** The largest suffix searched for a possible tag start. */
export const MAX_CANDIDATE_LENGTH = 512;

/** The open/close patterns a suppressor matches; see {@link createTaggedTextSuppressor}. */
export interface TaggedTextMatchers {
  openRe: RegExp;
  closeRe: RegExp;
  isPossibleOpen: (required: { text: string }) => boolean;
  isPossibleClose: (required: { text: string }) => boolean;
}

/** The public, generic name for an artifact-compatible text suppressor. */
export type TaggedTextSuppressor = ArtifactTextSuppressor;

/** Mutable per-suppressor state; owned by one {@link createTaggedTextSuppressor} call, never shared. */
interface SuppressionState {
  suppressing: boolean;
  candidate: string;
  suppressedChars: number;
  suppressedChunks: number;
  openedBlocks: number;
  closedBlocks: number;
}

function noteSuppressed({ state, text }: { state: SuppressionState; text: string }, _optional: Record<string, never> = {}): void {
  if (text.length <= 0) return;
  state.suppressedChars += text.length;
  state.suppressedChunks += 1;
}

/** Inside a block: hide everything up to and including the close tag, holding back a possible close-tag tail. */
function stripInsideBlock({ state, matchers, current }: { state: SuppressionState; matchers: TaggedTextMatchers; current: string }, _optional: Record<string, never> = {}): string {
  const close = matchers.closeRe.exec(current);
  if (!close || close.index === undefined) {
    const closeCandidateStart = possibleTagStart({ text: current, predicate: matchers.isPossibleClose });
    if (closeCandidateStart !== -1) {
      state.candidate = current.slice(closeCandidateStart);
      noteSuppressed({ state, text: current.slice(0, closeCandidateStart) });
    } else {
      noteSuppressed({ state, text: current });
    }
    return '';
  }
  state.suppressing = false;
  const end = close.index + close[0].length;
  state.closedBlocks += 1;
  noteSuppressed({ state, text: current.slice(0, end) });
  return stripText({ state, matchers, text: current.slice(end) });
}

/** Outside a block: emit text before an open tag (then suppress from it), or hold back a possible open-tag tail. */
function stripOutsideBlock({ state, matchers, current }: { state: SuppressionState; matchers: TaggedTextMatchers; current: string }, _optional: Record<string, never> = {}): string {
  const open = matchers.openRe.exec(current);
  if (open && open.index !== undefined) {
    state.suppressing = true;
    state.openedBlocks += 1;
    const prefix = current.slice(0, open.index);
    const tail = current.slice(open.index + open[0].length);
    noteSuppressed({ state, text: open[0] });
    return `${prefix}${stripText({ state, matchers, text: tail })}`;
  }

  const candidateStart = possibleTagStart({ text: current, predicate: matchers.isPossibleOpen });
  if (candidateStart === -1) return current;

  state.candidate = current.slice(candidateStart);
  return current.slice(0, candidateStart);
}

/** One `strip` step: prepend the held-back candidate, then run the branch for the current mode. */
function stripText({ state, matchers, text }: { state: SuppressionState; matchers: TaggedTextMatchers; text: string }, _optional: Record<string, never> = {}): string {
  const current = `${state.candidate}${text}`;
  state.candidate = '';
  return state.suppressing
    ? stripInsideBlock({ state, matchers, current })
    : stripOutsideBlock({ state, matchers, current });
}

function flushCandidate({ state }: { state: SuppressionState }, _optional: Record<string, never> = {}): string {
  const text = state.candidate;
  state.candidate = '';
  return state.suppressing ? '' : text;
}

function statsOf({ state }: { state: SuppressionState }, _optional: Record<string, never> = {}): ArtifactTextSuppressorStats {
  return {
    suppressedChars: state.suppressedChars,
    suppressedChunks: state.suppressedChunks,
    openedBlocks: state.openedBlocks,
    closedBlocks: state.closedBlocks,
    pendingCandidateChars: state.candidate.length,
    suppressing: state.suppressing,
  };
}

/**
 * Builds a suppressor for a tagged block delimited by `openRe`/`closeRe`.
 * `isPossibleOpen`/`isPossibleClose` decide whether a trailing `<...`
 * fragment (with no closing `>` yet) *could* still become a match once more
 * text arrives — this is what lets the suppressor hold back a
 * not-yet-decidable tail across streaming chunk boundaries instead of
 * either emitting a tag fragment early or hanging indefinitely on a `<` that
 * turns out to be unrelated text.
 *
 * Builds a stateful `ArtifactTextSuppressor` for one open/close tag pair.
 * The agent-runtime counterpart described itself this way: Shared implementation behind both
 * `createDsmlArtifactTextSuppressor` and `createToolCallTextSuppressor`.
 *
 * @param required.openRe - Matches a complete opening tag.
 * @param required.closeRe - Matches a complete closing tag.
 * @param required.isPossibleOpen - Returns `true` when a trailing fragment could
 *   still grow into a complete opening tag on the next delta.
 * @param required.isPossibleClose - Same, for the closing tag.
 */
export function createTaggedTextSuppressor(required: TaggedTextMatchers, _optional: Record<string, never> = {}): ArtifactTextSuppressor {
  const state: SuppressionState = { suppressing: false, candidate: '', suppressedChars: 0, suppressedChunks: 0, openedBlocks: 0, closedBlocks: 0 };
  return {
    strip: ({ text }) => stripText({ state, matchers: required, text }),
    flush: () => flushCandidate({ state }),
    isSuppressing: () => state.suppressing,
    hasPendingCandidate: () => state.candidate.length > 0,
    stats: () => statsOf({ state }),
  };
}

/**
 * Feeds `text` through `suppressor` and emits a `text_delta` on `onEvent` only when something survives. Returns whether an event was emitted.
 * Runs `text` through `suppressor` and, if any visible text survives,
 * forwards it to `onEvent` as a `text_delta`.
 *
 * @param required.suppressor - The suppressor to strip `text` through.
 * @param required.onEvent - Sink invoked with a `text_delta` event when output survives.
 * @param required.text - The raw text delta to strip.
 * @returns `true` when a `text_delta` was emitted, `false` otherwise.
 */
export function emitWithTextSuppressor(
  { suppressor, onEvent, text }: { suppressor: ArtifactTextSuppressor; onEvent: StreamEventSink; text: string },
  _optional: Record<string, never> = {},
): boolean {
  const delta = suppressor.strip({ text });
  if (!delta) return false;
  onEvent({ type: 'text_delta', delta });
  return true;
}

/**
 * Finds the start index of the rightmost `<`-prefixed suffix of `text` that
 * could still grow into a complete tag matched by `predicate`, scanning back
 * at most `MAX_CANDIDATE_LENGTH` characters. Returns `-1` when no such suffix
 * exists.
 */
export function possibleTagStart(
  { text, predicate }: { text: string; predicate: (required: { text: string }) => boolean },
  _optional: Record<string, never> = {},
): number {
  const min = Math.max(0, text.length - MAX_CANDIDATE_LENGTH);
  let index = text.lastIndexOf('<');
  while (index >= min) {
    const tail = text.slice(index);
    if (predicate({ text: tail })) return index;
    if (index === 0) break;
    index = text.lastIndexOf('<', index - 1);
  }
  return -1;
}
