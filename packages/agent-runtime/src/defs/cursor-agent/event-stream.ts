import { initializingStatus, isRecord, optionalNumber, pickUsage } from '../../json-event-stream-shared.js';
import type { JsonObject, ParserState, StreamEventHandler, UsageFields } from '../../json-event-stream-shared.js';

export type CursorStreamState = { textSoFar: string; turnStart: number };
export function createCursorStreamState(): CursorStreamState { return { textSoFar: '', turnStart: 0 }; }

function extractCursorText(message: unknown): string {
  const content = isRecord(message) ? message.content : undefined;
  const blocks = Array.isArray(content) ? content : [];
  return blocks
    .filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function emitCursorTextDelta(text: string, onEvent: StreamEventHandler, state: ParserState): void {
  // Timestamped assistant events WITHOUT `model_call_id` are cursor-agent's
  // real-time incremental deltas (`--stream-partial-output`): the final turn
  // text is the in-order concatenation of every such delta. Emit each one
  // verbatim — do NOT dedupe by content. Legitimately repeated deltas
  // (`"ha"`, `"ha"` -> `"haha"`) or a delta that happens to be a prefix of
  // earlier text are real content, not duplicates; content-based prefix or
  // equality checks would silently drop them. Duplicate suppression and
  // dropped-chunk recovery belong to the buffered terminal replay paths
  // (`model_call_id` and no-timestamp events) via reconcileCursorTurnReplay.
  //
  // No `!text` guard: this function's only real call site
  // (`handleCursorAssistant`, below) already returns early on `if (!text) return
  // false;` before ever calling in, so `text` is always non-empty here. The
  // guard was dead code for the one real caller; removed rather than padded
  // with a test.
  state.cursor.textSoFar += text;
  onEvent({ type: 'text_delta', delta: text });
}

/**
 * Reconcile a Cursor terminal replay against the text already emitted for the
 * CURRENT turn. A terminal replay (either a `model_call_id` message or a
 * non-timestamped final assistant message) carries the full text for the
 * current turn only, so it must be compared against
 * `cursorTextSoFar.slice(cursorTurnStart)` — NOT the whole cross-turn buffer,
 * which would miss the current-turn prefix on later turns and re-append the
 * whole replay (duplicate output like "secondsecond turn").
 *
 * Only a verified prefix permits suffix recovery: if the emitted turn text is
 * a prefix of the replay (including the empty case where no chunk arrived),
 * emit the missing suffix. On divergence (a non-final chunk was dropped, so
 * the emitted text is not a prefix) leave the append-only stream untouched
 * rather than duplicate already-shown text. Always advances the turn boundary.
 */
function reconcileCursorTurnReplay(text: string, onEvent: StreamEventHandler, state: ParserState): void {
  const emittedTurn = state.cursor.textSoFar.slice(state.cursor.turnStart);
  if (text && text !== emittedTurn && text.startsWith(emittedTurn)) {
    const suffix = text.slice(emittedTurn.length);
    if (suffix) onEvent({ type: 'text_delta', delta: suffix });
    state.cursor.textSoFar += suffix;
  }
  state.cursor.turnStart = state.cursor.textSoFar.length;
}

function handleCursorAssistant(obj: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  // Cursor sends a final assistant message that replays the full text for
  // the current turn — either tagged with `model_call_id`, or (fallback)
  // as a non-timestamped terminal assistant message. Both are reconciled
  // against the current turn's emitted text via reconcileCursorTurnReplay.
  const text = extractCursorText(obj.message);
  if (typeof obj.model_call_id === 'string') {
    reconcileCursorTurnReplay(text, onEvent, state);
    return true;
  }
  if (!text) return false;
  if (typeof obj.timestamp_ms === 'number') {
    // Incremental streaming chunk within a turn — accumulate as usual.
    emitCursorTextDelta(text, onEvent, state);
    return true;
  }
  // Non-timestamped final assistant message: a terminal replay that marks a
  // turn boundary. Reconcile against the current turn (not the whole
  // cross-turn buffer) so later fallback-terminated turns do not duplicate
  // output, then advance the turn boundary.
  reconcileCursorTurnReplay(text, onEvent, state);
  return true;
}

const CURSOR_USAGE_FIELDS: UsageFields = [
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
  ['cacheReadTokens', 'cached_read_tokens'],
  ['cacheWriteTokens', 'cached_write_tokens'],
];

export function handleCursorEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;

  if (obj.type === 'system' && obj.subtype === 'init') {
    onEvent(initializingStatus({ obj }));
    return true;
  }

  if (obj.type === 'assistant' && obj.message) return handleCursorAssistant(obj, onEvent, state);

  if (obj.type === 'result' && isRecord(obj.usage)) {
    onEvent({
      type: 'usage',
      usage: pickUsage({ source: obj.usage, fields: CURSOR_USAGE_FIELDS }),
      durationMs: optionalNumber({ value: obj.duration_ms }),
    });
    return true;
  }

  return false;
}

