/**
 * @module qoder-stream
 *
 * Parses Qoder CLI's `--output-format stream-json` JSONL stream into the
 * small event set consumed by the chat UI. Qoder's top-level records are
 * wrapper objects (`system`, `assistant`, `result`) with adapter-specific
 * fields, so keep this parser separate from Claude/Codex-compatible streams.
 */

import { Buffer } from 'node:buffer';

type JsonRecord = Record<string, unknown>;

/** Every event `createQoderStreamHandler` can emit, discriminated on `type` — see `claude-stream.ts`'s `ClaudeStreamEvent` doc for why this is exported rather than left as `Record<string, unknown>`. */
export type QoderEvent =
  | {
      type: 'status';
      label: 'initializing';
      model?: string | undefined;
      sessionId?: string | undefined;
      qodercliVersion?: string | undefined;
    }
  | { type: 'text_delta' | 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'error'; message: string; raw: string }
  | {
      type: 'usage';
      usage: unknown;
      modelUsage?: unknown;
      costUsd: unknown;
      durationMs: number | null;
      stopReason: unknown;
      isError: boolean;
    }
  | { type: 'raw'; line: string };

type QoderEventSink = (event: QoderEvent) => void;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object';
}

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function textFromContentBlock(block: unknown): string {
  if (isRecord(block) && typeof block.text === 'string') return block.text;
  return '';
}

function thinkingFromContentBlock(block: unknown): string {
  if (isRecord(block) && block.type === 'thinking' && typeof block.thinking === 'string') return block.thinking;
  return '';
}

function messageFromError(error: unknown): string {
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) return error;
  return 'Unknown Qoder error';
}

/** First non-empty string among the candidates, or undefined. */
function firstNonEmpty(candidates: unknown[]): string | undefined {
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function messageFromResult(obj: JsonRecord): string {
  const errorMessage = isRecord(obj.error) ? obj.error.message : undefined;
  const message = firstNonEmpty([obj.error, errorMessage, obj.message]);
  if (message !== undefined) return message;
  if (typeof obj.stop_reason === 'string' && obj.stop_reason.length > 0) {
    return `Qoder run failed: ${obj.stop_reason}`;
  }
  return 'Qoder run failed';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function initStatusEvent(obj: JsonRecord): QoderEvent {
  return {
    type: 'status',
    label: 'initializing',
    model: optionalString(obj.model),
    sessionId: optionalString(obj.session_id),
    qodercliVersion: optionalString(obj.qodercli_version),
  };
}

function usageEvent(obj: JsonRecord): QoderEvent {
  return {
    type: 'usage',
    usage: obj.usage ?? null,
    modelUsage: obj.modelUsage ?? undefined,
    costUsd: obj.total_cost_usd ?? null,
    durationMs: typeof obj.duration_ms === 'number' ? obj.duration_ms : null,
    stopReason: obj.stop_reason ?? null,
    isError: Boolean(obj.is_error),
  };
}

export function createQoderStreamHandler({ onEvent }: { onEvent: QoderEventSink }) {
  let buffer = '';
  let emittedThinkingStart = false;

  function emitThinking(thinking: string) {
    if (!emittedThinkingStart) {
      emittedThinkingStart = true;
      onEvent({ type: 'thinking_start' });
    }
    onEvent({ type: 'thinking_delta', delta: thinking });
  }

  /** Emit one content block's text or thinking; returns whether text was emitted. */
  function emitContentBlock(block: unknown): boolean {
    const text = textFromContentBlock(block);
    if (text.length > 0) {
      onEvent({ type: 'text_delta', delta: text });
      return true;
    }
    const thinking = thinkingFromContentBlock(block);
    if (thinking.length > 0) emitThinking(thinking);
    return false;
  }

  function handleAssistant(obj: JsonRecord, message: JsonRecord, rawLine: string) {
    const content = Array.isArray(message.content) ? message.content : [];
    let emittedText = false;
    for (const block of content) {
      if (emitContentBlock(block)) emittedText = true;
    }
    if (!emittedText && typeof message.content === 'string') {
      onEvent({ type: 'text_delta', delta: message.content });
      emittedText = true;
    }
    if (obj.error && !emittedText) {
      onEvent({
        type: 'error',
        message: messageFromError(obj.error),
        raw: rawLine,
      });
    }
  }

  function handleResult(obj: JsonRecord, rawLine: string) {
    onEvent(usageEvent(obj));
    if (obj.is_error) {
      onEvent({
        type: 'error',
        message: messageFromResult(obj),
        raw: rawLine,
      });
    }
  }

  function handleObject(obj: unknown, rawLine: string) {
    if (!isRecord(obj)) return;
    if (obj.type === 'system' && obj.subtype === 'init') {
      onEvent(initStatusEvent(obj));
    } else if (obj.type === 'assistant' && isRecord(obj.message)) {
      handleAssistant(obj, obj.message, rawLine);
    } else if (obj.type === 'result') {
      handleResult(obj, rawLine);
    } else {
      onEvent({ type: 'raw', line: rawLine });
    }
  }

  function handleLine(line: string) {
    try {
      handleObject(JSON.parse(line), line);
    } catch {
      onEvent({ type: 'raw', line });
    }
  }

  function feed({ chunk }: { chunk: unknown }) {
    buffer += stringifyContent(chunk);
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      handleLine(line);
    }
  }

  function flush() {
    const rem = buffer.trim();
    buffer = '';
    if (!rem) return;
    handleLine(rem);
  }

  return { feed, flush };
}
