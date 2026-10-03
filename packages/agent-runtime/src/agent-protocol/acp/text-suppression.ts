/** @module agent-protocol/acp/text-suppression
 * Generic tagged-text-block suppressor for stripping `<artifact>`/`<DSML
 * artifact>` and `<tool_call>`/`<edit>` XML-ish echo tags out of streamed
 * agent text, so a run's canonical text_delta stream doesn't leak an agent's
 * raw tool/artifact echo. Pure string processing — no I/O, no dependency on
 * any other agent-protocol file. ACP-session-only today (the sole consumer is
 * acp/session.ts), so it is colocated here rather than promoted to a
 * package-wide shared module with only one real consumer.
 *
 * Ported from the upstream product's `apps/daemon/src/artifacts/text-suppression.ts`
 * with two private helpers (`possibleDsmlArtifactOpenStart`,
 * `possibleArtifactCloseStart`) dropped — both were declared but never
 * called anywhere in the origin file (verified by grep); keeping genuinely
 * dead, unreachable code would force either a contrived test or a
 * coverage-suppression comment to satisfy this package's >=99% bar, and this
 * repo's coverage-discipline convention calls for refactoring dead branches
 * away rather than either of those. See archived provenance ledger.
 */

/** A single streamed text delta event, as consumed by `emitWithTextSuppressor`. */
type EventSink = (event: { type: 'text_delta'; delta: string }) => void;

const ARTIFACT_OPEN_RE = /(?:<\s*\|?\s*DSML[\s,]+artifact\b[^>]*>|<\s*artifact\b[^>]*>)/i;
const DSML_ARTIFACT_CLOSE_RE = /(?:<\/artifact>|<\/\s*\|?\s*DSML\s*>|<\s*\|?\s*\/\s*DSML\s*\|?\s*>)/i;
const DSML_OPEN_CANONICAL = 'dsmlartifact';
const ARTIFACT_OPEN_CANONICAL = 'artifact';
const ARTIFACT_CLOSE_CANONICALS = ['artifact', 'dsml'];
const TOOL_CALL_OPEN_RE = /(?:<\s*tool_call\b[^>]*>|<\s*edit\s*>)/i;
const TOOL_CALL_CLOSE_RE = /(?:<\/\s*tool_call\s*>|<\/\s*edit\s*>)/i;
const TOOL_CALL_OPEN_CANONICALS = ['toolcall', 'edit'];
const TOOL_CALL_CLOSE_CANONICALS = ['toolcall', 'edit'];
const MAX_CANDIDATE_LENGTH = 512;

/** A stateful stripper that removes a specific tagged text block (DSML
 * artifact echo, or tool_call/edit echo) from a stream of text deltas,
 * buffering a bounded "possible tag start" candidate across calls so a tag
 * split across two deltas is still detected. */
export interface ArtifactTextSuppressor {
  /** Feeds the next text delta through the suppressor, returning the portion
   * (if any) that is safe to emit as visible text right now. */
  strip(text: string): string;
  /** Drains any buffered candidate text at end-of-stream. Returns `''` while
   * still inside a suppressed block (nothing pending is safe to emit). */
  flush(): string;
  /** Returns `true` while currently inside a suppressed tagged block. */
  isSuppressing(): boolean;
  /** Returns `true` when a possible-tag-start candidate is buffered but not
   * yet resolved as an actual open/close tag. */
  hasPendingCandidate(): boolean;
  /** Returns a snapshot of suppression counters for diagnostics. */
  stats(): ArtifactTextSuppressorStats;
}

/** Diagnostic counters describing an `ArtifactTextSuppressor`'s cumulative activity. */
export interface ArtifactTextSuppressorStats {
  suppressedChars: number;
  suppressedChunks: number;
  openedBlocks: number;
  closedBlocks: number;
  pendingCandidateChars: number;
  suppressing: boolean;
}

/**
 * Creates a suppressor that strips `<artifact>...</artifact>` and
 * `<|DSML artifact|>...<|/DSML|>` blocks from streamed agent text.
 */
export function createDsmlArtifactTextSuppressor(): ArtifactTextSuppressor {
  return createTaggedTextSuppressor({
    openRe: ARTIFACT_OPEN_RE,
    closeRe: DSML_ARTIFACT_CLOSE_RE,
    isPossibleOpen: isPossibleDsmlArtifactOpen,
    isPossibleClose: isPossibleArtifactClose,
  });
}

/**
 * Creates a suppressor that strips `<tool_call>...</tool_call>` and
 * `<edit>...</edit>` blocks from streamed agent text.
 */
export function createToolCallTextSuppressor(): ArtifactTextSuppressor {
  return createTaggedTextSuppressor({
    openRe: TOOL_CALL_OPEN_RE,
    closeRe: TOOL_CALL_CLOSE_RE,
    isPossibleOpen: isPossibleToolCallOpen,
    isPossibleClose: isPossibleToolCallClose,
  });
}

/**
 * Builds a stateful `ArtifactTextSuppressor` for one open/close tag pair.
 * Shared implementation behind both `createDsmlArtifactTextSuppressor` and
 * `createToolCallTextSuppressor`.
 *
 * @param args.openRe - Matches a complete opening tag.
 * @param args.closeRe - Matches a complete closing tag.
 * @param args.isPossibleOpen - Returns `true` when a trailing fragment could
 *   still grow into a complete opening tag on the next delta.
 * @param args.isPossibleClose - Same, for the closing tag.
 */
function createTaggedTextSuppressor(args: {
  openRe: RegExp;
  closeRe: RegExp;
  isPossibleOpen: (text: string) => boolean;
  isPossibleClose: (text: string) => boolean;
}): ArtifactTextSuppressor {
  let suppressing = false;
  let candidate = '';
  let suppressedChars = 0;
  let suppressedChunks = 0;
  let openedBlocks = 0;
  let closedBlocks = 0;

  function noteSuppressed(text: string): void {
    if (text.length <= 0) return;
    suppressedChars += text.length;
    suppressedChunks += 1;
  }

  function strip(text: string): string {
    const current = `${candidate}${text}`;
    candidate = '';

    if (suppressing) {
      const close = args.closeRe.exec(current);
      if (!close || close.index === undefined) {
        const closeCandidateStart = possibleTagStart(current, args.isPossibleClose);
        if (closeCandidateStart !== -1) {
          candidate = current.slice(closeCandidateStart);
          noteSuppressed(current.slice(0, closeCandidateStart));
        } else {
          noteSuppressed(current);
        }
        return '';
      }
      suppressing = false;
      const end = close.index + close[0].length;
      closedBlocks += 1;
      noteSuppressed(current.slice(0, end));
      return strip(current.slice(end));
    }

    const open = args.openRe.exec(current);
    if (open && open.index !== undefined) {
      suppressing = true;
      openedBlocks += 1;
      const prefix = current.slice(0, open.index);
      const tail = current.slice(open.index + open[0].length);
      noteSuppressed(open[0]);
      return `${prefix}${strip(tail)}`;
    }

    const candidateStart = possibleTagStart(current, args.isPossibleOpen);
    if (candidateStart === -1) return current;

    candidate = current.slice(candidateStart);
    return current.slice(0, candidateStart);
  }

  function flush(): string {
    const text = candidate;
    candidate = '';
    return suppressing ? '' : text;
  }

  function isSuppressing(): boolean {
    return suppressing;
  }

  function hasPendingCandidate(): boolean {
    return candidate.length > 0;
  }

  function stats(): ArtifactTextSuppressorStats {
    return {
      suppressedChars,
      suppressedChunks,
      openedBlocks,
      closedBlocks,
      pendingCandidateChars: candidate.length,
      suppressing,
    };
  }

  return { strip, flush, isSuppressing, hasPendingCandidate, stats };
}

/**
 * Runs `text` through `suppressor` and, if any visible text survives,
 * forwards it to `onEvent` as a `text_delta`.
 *
 * @param suppressor - The suppressor to strip `text` through.
 * @param onEvent - Sink invoked with a `text_delta` event when output survives.
 * @param text - The raw text delta to strip.
 * @returns `true` when a `text_delta` was emitted, `false` otherwise.
 */
export function emitWithTextSuppressor(
  suppressor: ArtifactTextSuppressor,
  onEvent: EventSink,
  text: string,
): boolean {
  const delta = suppressor.strip(text);
  if (!delta) return false;
  onEvent({ type: 'text_delta', delta });
  return true;
}

/**
 * Finds the start index of the rightmost `<`-prefixed suffix of `text` that
 * could still grow into a complete tag matched by `predicate`, scanning back
 * at most `MAX_CANDIDATE_LENGTH` characters. Returns `-1` when no such suffix
 * exists.
 *
 * @internal
 */
function possibleTagStart(text: string, predicate: (tail: string) => boolean): number {
  const min = Math.max(0, text.length - MAX_CANDIDATE_LENGTH);
  let index = text.lastIndexOf('<');
  while (index >= min) {
    const tail = text.slice(index);
    if (predicate(tail)) return index;
    if (index === 0) break;
    index = text.lastIndexOf('<', index - 1);
  }
  return -1;
}

/**
 * Returns `true` when `text` is a `<`-prefixed, not-yet-closed fragment that
 * could still grow into a DSML-artifact or plain-artifact opening tag.
 *
 * @internal
 */
function isPossibleDsmlArtifactOpen(text: string): boolean {
  if (!text.startsWith('<') || text.includes('>')) return false;
  const compact = text.toLowerCase().replace(/[<|,\s]/g, '');
  return compact.length === 0 ||
    DSML_OPEN_CANONICAL.startsWith(compact) ||
    compact.startsWith(DSML_OPEN_CANONICAL) ||
    ARTIFACT_OPEN_CANONICAL.startsWith(compact) ||
    compact.startsWith(ARTIFACT_OPEN_CANONICAL);
}

/**
 * Returns `true` when `text` is a `<`-prefixed, not-yet-closed fragment that
 * could still grow into an artifact/DSML closing tag.
 *
 * @internal
 */
function isPossibleArtifactClose(text: string): boolean {
  if (!text.startsWith('<') || text.includes('>')) return false;
  const compact = text.toLowerCase().replace(/[<|/\s]/g, '');
  return compact.length === 0 ||
    ARTIFACT_CLOSE_CANONICALS.some((canonical) =>
      canonical.startsWith(compact) || compact.startsWith(canonical),
    );
}

/**
 * Returns `true` when `text` is a `<`-prefixed, not-yet-closed fragment that
 * could still grow into a `tool_call`/`edit` opening tag.
 *
 * @internal
 */
function isPossibleToolCallOpen(text: string): boolean {
  if (!text.startsWith('<') || text.includes('>')) return false;
  const compact = text.toLowerCase().replace(/[<|,\s_-]/g, '');
  return compact.length === 0 ||
    TOOL_CALL_OPEN_CANONICALS.some((canonical) =>
      canonical.startsWith(compact) || compact.startsWith(canonical),
    );
}

/**
 * Returns `true` when `text` is a `<`-prefixed, not-yet-closed fragment that
 * could still grow into a `tool_call`/`edit` closing tag.
 *
 * @internal
 */
function isPossibleToolCallClose(text: string): boolean {
  if (!text.startsWith('<') || text.includes('>')) return false;
  const compact = text.toLowerCase().replace(/[<|/\s_-]/g, '');
  return compact.length === 0 ||
    TOOL_CALL_CLOSE_CANONICALS.some((canonical) =>
      canonical.startsWith(compact) || compact.startsWith(canonical),
    );
}
