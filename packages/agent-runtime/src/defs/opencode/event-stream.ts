import { dispatchFrame, extractErrorMessage, isRecord, nonEmptyString, optionalNumber, pickUsage, safeParseJson, stringifyContent } from '../../json-event-stream-shared.js';
import type { FrameHandler, JsonObject, ParserState, StreamEventHandler, Usage, UsageFields } from '../../json-event-stream-shared.js';

export type OpenCodeStreamState = { toolUses: Set<string> };
export function createOpenCodeStreamState(): OpenCodeStreamState { return { toolUses: new Set<string>() }; }

export function emitOpenCodeModelReceipt(obj: JsonObject, onEvent: StreamEventHandler): void {
  const properties = obj.properties as { info?: { role?: string; modelID?: string; providerID?: string } } | undefined;
  const info = obj.type === 'message.updated' ? properties?.info : undefined;
  if (info?.role === 'assistant' && typeof info.modelID === 'string') {
    onEvent({ type: 'status', label: 'model', model: info.providerID ? `${info.providerID}/${info.modelID}` : info.modelID });
  }
}

const OPENCODE_USAGE_FIELDS: UsageFields = [
  ['input', 'input_tokens'],
  ['output', 'output_tokens'],
  ['reasoning', 'thought_tokens'],
];
const OPENCODE_CACHE_USAGE_FIELDS: UsageFields = [
  ['read', 'cached_read_tokens'],
  ['write', 'cached_write_tokens'],
];

function formatOpenCodeUsage(tokens: unknown): Usage | null {
  if (!isRecord(tokens)) return null;
  const usage: Usage = {
    ...pickUsage(tokens, OPENCODE_USAGE_FIELDS),
    ...(isRecord(tokens.cache) ? pickUsage(tokens.cache, OPENCODE_CACHE_USAGE_FIELDS) : {}),
  };
  return Object.keys(usage).length > 0 ? usage : null;
}

function openCodePart(obj: JsonObject): JsonObject {
  return isRecord(obj.part) ? obj.part : {};
}

function handleOpenCodeStepStart(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  // `sessionID` is OpenCode's own session handle (capture-style resume).
  // Surface it on the step-start status so the daemon can persist it to
  // `agent_sessions` and replay it as `run -s <id>` next turn. OpenCode
  // stamps it on every stream event; step_start is the turn opener, so a
  // create turn always exposes it here.
  onEvent({ type: 'status', label: 'running', sessionId: nonEmptyString(obj.sessionID) });
  return true;
}

function handleOpenCodeText(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  const text = nonEmptyString(openCodePart(obj).text);
  if (!text) return false;
  onEvent({ type: 'text_delta', delta: text });
  return true;
}

function handleOpenCodeToolUse(obj: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  const part = openCodePart(obj);
  if (typeof part.tool !== 'string' || typeof part.callID !== 'string') return false;
  const statePart = isRecord(part.state) ? part.state : {};
  const key = `${obj.sessionID || 'session'}:${part.callID}`;
  if (!state.opencode.toolUses.has(key)) {
    state.opencode.toolUses.add(key);
    onEvent({
      type: 'tool_use',
      id: part.callID,
      name: part.tool,
      input: safeParseJson(statePart.input) ?? statePart.input ?? null,
    });
  }
  if (statePart.status === 'completed') {
    onEvent({
      type: 'tool_result',
      toolUseId: part.callID,
      content: stringifyContent(statePart.output),
      isError: false,
    });
  }
  return true;
}

function handleOpenCodeStepFinish(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  const part = openCodePart(obj);
  const usage = formatOpenCodeUsage(part.tokens);
  if (usage) {
    onEvent({ type: 'usage', usage, costUsd: optionalNumber(part.cost) });
  }
  return true;
}

function handleOpenCodeError(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  // OpenCode emits structured error frames on stdout (e.g. provider auth
  // failures, network errors, schema mismatches) and still exits 0. Surface
  // them as proper `error` events so server.ts's `sendAgentEvent` wrapper
  // can flip the run to `failed` and forward a visible SSE error to the
  // chat UI. Previously we downgraded these to `type:'raw'`, which is not
  // rendered as an assistant message — the run looked like a fast clean
  // success while the user actually got nothing back. See issue #691.
  //
  // Shape mirrors the qoder-stream contract (`{type, message, raw}`) so
  // the daemon's existing error-handling path recognises it without
  // further wiring.
  const message = extractErrorMessage(
    obj.error ?? obj.message,
    'OpenCode error',
  );
  onEvent({ type: 'error', message, raw: stringifyContent(obj) });
  return true;
}

const OPENCODE_FRAME_HANDLERS: ReadonlyMap<unknown, FrameHandler> = new Map<unknown, FrameHandler>([
  ['step_start', handleOpenCodeStepStart],
  ['text', handleOpenCodeText],
  ['tool_use', handleOpenCodeToolUse],
  ['step_finish', handleOpenCodeStepFinish],
  ['error', handleOpenCodeError],
]);

export function handleOpenCodeEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;
  return dispatchFrame(OPENCODE_FRAME_HANDLERS, obj, onEvent, state);
}

