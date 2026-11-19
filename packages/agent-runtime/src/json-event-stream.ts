/** @module json-event-stream
 * Multi-CLI JSON event parsing with per-handler stream state. */
import { createBoundedLineStream } from './core/bounded-line-stream.js';
import { handleAntigravityEvent } from './defs/antigravity/event-stream.js';
import { createCodexStreamState, handleCodexEvent } from './defs/codex/event-stream.js';
import { createOpenCodeStreamState, emitOpenCodeModelReceipt, handleOpenCodeEvent } from './defs/opencode/event-stream.js';
import { createLegacyGoogleStreamState, flushPendingArtifactText, handleLegacyGoogleStreamEvent } from './defs/gemini/event-stream.js';
import { handleKimiEvent } from './defs/kimi/event-stream.js';
import { createCursorStreamState, handleCursorEvent } from './defs/cursor-agent/event-stream.js';
import { isRecord } from './json-event-stream-shared.js';
import type { ParserState, StreamEventHandler } from './json-event-stream-shared.js';

const MODEL_RECEIPT_FRAME_TYPES: ReadonlySet<string> = new Set(['session.created', 'thread.started', 'turn.started', 'model.changed']);
const MODEL_RECEIPT_EXTRACTORS = [emitOpenCodeModelReceipt];

// Preserve structured model receipts before vendor event translation. These fields describe
// session/turn/assistant-message metadata; generated text is never used for model identity.
function emitModelReceipts(obj: unknown, onEvent: StreamEventHandler): void {
  if (!isRecord(obj)) return;
  for (const extract of MODEL_RECEIPT_EXTRACTORS) extract(obj, onEvent);
  if (typeof obj.model === 'string' && MODEL_RECEIPT_FRAME_TYPES.has(String(obj.type))) {
    onEvent({ type: 'status', label: 'model', model: obj.model });
  }
}

const PARSERS_BY_KIND: ReadonlyMap<string, (obj: unknown, onEvent: StreamEventHandler, state: ParserState) => boolean> = new Map([
  ['antigravity', (frame, emit, state) => handleAntigravityEvent({ frame, emit, state: state.antigravity })],
  ['opencode', handleOpenCodeEvent],
  ['legacy-google-stream-json', handleLegacyGoogleStreamEvent],
  ['kimi', handleKimiEvent],
  ['cursor-agent', handleCursorEvent],
  ['codex', handleCodexEvent],
]);

export function createJsonEventStreamHandler({ kind, onEvent }: { kind: string; onEvent: StreamEventHandler }, _optional: Record<string, never> = {}) {
  const lines = createBoundedLineStream({
    onLine: line => { const trimmed = line.trim(); if (trimmed) handleLine(trimmed); },
    onOverflow: error => onEvent({ type: 'error', message: error.message, raw: '' }),
  });
  const state: ParserState = {
    antigravity: { textEmitted: false, toolUses: new Set<string>(), toolResults: new Set<string>() },
    cursor: createCursorStreamState(),
    opencode: createOpenCodeStreamState(),
    codex: createCodexStreamState(),
    legacyGoogle: createLegacyGoogleStreamState(),
  };
  const parse = PARSERS_BY_KIND.get(kind);

  function handleLine(line: string): void {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      onEvent({ type: 'raw', line });
      return;
    }

    emitModelReceipts(obj, onEvent);
    if (parse?.(obj, onEvent, state)) return;

    onEvent({ type: 'raw', line });
  }

  function feed({ chunk }: { chunk: string }) {
    lines.feed({ chunk: chunk });
  }

  function flush(): void {
    lines.flush();
    flushPendingArtifactText({ state, onEvent });
  }

  return { feed, flush };
}
