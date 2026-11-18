import { isRecord, nonEmptyString, safeParseJson, stringifyContent, trimmedNonBlank } from '../../json-event-stream-shared.js';
import type { JsonObject, StreamEventHandler } from '../../json-event-stream-shared.js';

function emitKimiToolCalls(toolCalls: unknown[], onEvent: StreamEventHandler): void {
  for (const rawCall of toolCalls) {
    const call = isRecord(rawCall) ? rawCall : {};
    const fn = isRecord(call.function) ? call.function : {};
    const id = trimmedNonBlank({ value: call.id });
    const name = trimmedNonBlank({ value: fn.name });
    if (!id || !name) continue;
    const input = safeParseJson({ value: fn.arguments }) ?? fn.arguments ?? null;
    onEvent({ type: 'tool_use', id, name, input });
  }
}

function handleKimiAssistant(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  if (Array.isArray(obj.tool_calls)) {
    emitKimiToolCalls(obj.tool_calls, onEvent);
    return true;
  }
  const text = nonEmptyString({ value: obj.content });
  if (!text) return false;
  onEvent({ type: 'text_delta', delta: text });
  return true;
}

function handleKimiToolResult(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  const toolUseId = trimmedNonBlank({ value: obj.tool_call_id });
  if (!toolUseId) return false;
  onEvent({
    type: 'tool_result',
    toolUseId,
    content: stringifyContent({ value: obj.content }),
    isError: false,
  });
  return true;
}

export function handleKimiEvent(obj: unknown, onEvent: StreamEventHandler): boolean {
  if (!isRecord(obj)) return false;
  if (obj.role === 'assistant') return handleKimiAssistant(obj, onEvent);
  if (obj.role === 'tool') return handleKimiToolResult(obj, onEvent);
  return obj.role === 'meta' && obj.type === 'session.resume_hint';
}

