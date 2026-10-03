/**
 * @module artifacts/text-suppression
 *
 * A streaming-text state machine that suppresses a tagged block (matched by
 * caller-supplied open/close patterns) from user-visible output while it's
 * still arriving — used to hide an artifact's raw markup from chat prose
 * while it streams in, without buffering the whole response first. Ported
 * from OD's `apps/daemon/src/artifacts/text-suppression.ts`.
 *
 * The core (`createTaggedTextSuppressor`) was already fully generic in the
 * origin — it takes its open/close regexes and open/close prefix-match
 * predicates as parameters, no product coupling. What needed de-branding
 * were the origin's two pre-built instances: `createDsmlArtifactTextSuppressor`
 * hardcoded OD's own "DSML" markup-language tag name family
 * (`<|DSML artifact>`/`<artifact>`) as its open/close patterns.
 * `createXmlTagTextSuppressor` below replaces it — a generic factory taking
 * the caller's own tag-name list instead of a hardcoded vocabulary. The
 * `tool_call`/`edit` pairing the origin's other instance
 * (`createToolCallTextSuppressor`) suppressed is a generic agent-protocol
 * convention, not OD-branded, and is kept as a named default instance.
 */

export type StreamTextEvent = { readonly type: 'text_delta'; readonly delta: string };
export type StreamEventSink = (event: StreamTextEvent) => void;

export interface ArtifactTextSuppressor {
  strip(required: { text: string }): string;
  flush(): string;
  isSuppressing(): boolean;
  hasPendingCandidate(): boolean;
  stats(): ArtifactTextSuppressorStats;
}

export interface ArtifactTextSuppressorStats {
  readonly suppressedChars: number;
  readonly suppressedChunks: number;
  readonly openedBlocks: number;
  readonly closedBlocks: number;
  readonly pendingCandidateChars: number;
  readonly suppressing: boolean;
}

const MAX_CANDIDATE_LENGTH = 512;

/**
 * Builds a suppressor for a tagged block delimited by `openRe`/`closeRe`.
 * `isPossibleOpen`/`isPossibleClose` decide whether a trailing `<...`
 * fragment (with no closing `>` yet) *could* still become a match once more
 * text arrives — this is what lets the suppressor hold back a
 * not-yet-decidable tail across streaming chunk boundaries instead of
 * either emitting a tag fragment early or hanging indefinitely on a `<` that
 * turns out to be unrelated text.
 */
export function createTaggedTextSuppressor(args: {
  openRe: RegExp;
  closeRe: RegExp;
  isPossibleOpen: (required: { text: string }) => boolean;
  isPossibleClose: (required: { text: string }) => boolean;
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

  function strip({ text }: { text: string }): string {
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
      return strip({ text: current.slice(end) });
    }

    const open = args.openRe.exec(current);
    if (open && open.index !== undefined) {
      suppressing = true;
      openedBlocks += 1;
      const prefix = current.slice(0, open.index);
      const tail = current.slice(open.index + open[0].length);
      noteSuppressed(open[0]);
      return `${prefix}${strip({ text: tail })}`;
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

/** Feeds `text` through `suppressor` and emits a `text_delta` on `onEvent` only when something survives. Returns whether an event was emitted. */
export function emitWithTextSuppressor(
  { suppressor, onEvent, text }: { suppressor: ArtifactTextSuppressor; onEvent: StreamEventSink; text: string },
): boolean {
  const delta = suppressor.strip({ text });
  if (!delta) return false;
  onEvent({ type: 'text_delta', delta });
  return true;
}

function possibleTagStart(text: string, predicate: (required: { text: string }) => boolean): number {
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

// `text` is always a `possibleTagStart` tail slice starting at a `<`
// position (its only caller) — no `!text.startsWith('<')` re-check needed.
function compactTagCandidate(text: string, stripChars: RegExp): string | null {
  if (text.includes('>')) return null;
  return text.toLowerCase().replace(stripChars, '');
}

/**
 * Builds a suppressor for an XML-like `<tagName ...>...</tagName>` block (or
 * a bracket-pipe variant `<|tagName ...>...<|/tagName|>`), matched
 * case-insensitively against any of `tagNames`. Replaces the origin's
 * hardcoded "DSML" tag-name family with a caller-supplied vocabulary.
 */
export function createXmlTagTextSuppressor({ tagNames }: { tagNames: readonly string[] }): ArtifactTextSuppressor {
  const canonicals = tagNames.map((t) => t.toLowerCase());
  const namesPattern = canonicals.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const openRe = new RegExp(`(?:<\\s*\\|?\\s*(?:${namesPattern})\\b[^>]*>)`, 'i');
  const closeRe = new RegExp(`(?:<\\/(?:${namesPattern})>|<\\s*\\|?\\s*\\/\\s*(?:${namesPattern})\\s*\\|?\\s*>)`, 'i');

  function isPossibleOpen(text: string): boolean {
    const compact = compactTagCandidate(text, /[<|,\s]/g);
    if (compact === null) return false;
    return compact.length === 0 || canonicals.some((c) => c.startsWith(compact) || compact.startsWith(c));
  }

  function isPossibleClose(text: string): boolean {
    const compact = compactTagCandidate(text, /[<|/\s]/g);
    if (compact === null) return false;
    return compact.length === 0 || canonicals.some((c) => c.startsWith(compact) || compact.startsWith(c));
  }

  return createTaggedTextSuppressor({ openRe, closeRe, isPossibleOpen: ({ text }) => isPossibleOpen(text), isPossibleClose: ({ text }) => isPossibleClose(text) });
}

const TOOL_CALL_OPEN_RE = /(?:<\s*tool_call\b[^>]*>|<\s*edit\s*>)/i;
const TOOL_CALL_CLOSE_RE = /(?:<\/\s*tool_call\s*>|<\/\s*edit\s*>)/i;
const TOOL_CALL_CANONICALS = ['toolcall', 'edit'];

// Same reasoning as compactTagCandidate above: `text` always starts with
// `<` here (a `possibleTagStart` tail slice) — no re-check needed.
function isPossibleToolCallOpen(text: string): boolean {
  if (text.includes('>')) return false;
  const compact = text.toLowerCase().replace(/[<|,\s_-]/g, '');
  return compact.length === 0 || TOOL_CALL_CANONICALS.some((c) => c.startsWith(compact) || compact.startsWith(c));
}

function isPossibleToolCallClose(text: string): boolean {
  if (text.includes('>')) return false;
  const compact = text.toLowerCase().replace(/[<|/\s_-]/g, '');
  return compact.length === 0 || TOOL_CALL_CANONICALS.some((c) => c.startsWith(compact) || compact.startsWith(c));
}

/** Suppresses a `<tool_call>...</tool_call>` or `<edit>...</edit>` block — a generic agent-protocol convention, not product-branded. */
export function createToolCallTextSuppressor(_required: Record<string, never>): ArtifactTextSuppressor {
  return createTaggedTextSuppressor({
    openRe: TOOL_CALL_OPEN_RE,
    closeRe: TOOL_CALL_CLOSE_RE,
    isPossibleOpen: ({ text }) => isPossibleToolCallOpen(text),
    isPossibleClose: ({ text }) => isPossibleToolCallClose(text),
  });
}
