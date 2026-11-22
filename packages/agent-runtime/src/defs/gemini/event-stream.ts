import { dispatchFrame, extractErrorMessage, initializingStatus, isRecord, optionalNumber, pickUsage, safeParseJson, stringifyContent, todoWriteInputFromParsedValue } from '../../json-event-stream-shared.js';
import type { FrameHandler, JsonObject, ParserState, StreamEventHandler, UsageFields } from '../../json-event-stream-shared.js';

export type LegacyGoogleStreamState = {
  suppressNextArtifactText: boolean;
  suppressDuplicateArtifactText: boolean;
  artifactOpenCandidate: string;
  pendingArtifactText: string;
};
export function createLegacyGoogleStreamState(): LegacyGoogleStreamState {
  return { suppressNextArtifactText: false, suppressDuplicateArtifactText: false, artifactOpenCandidate: '', pendingArtifactText: '' };
}

function isGoogleAssistantText(obj: JsonObject): boolean {
  return (
    obj.type === 'message' &&
    obj.role === 'assistant' &&
    typeof obj.content === 'string' &&
    obj.content.length > 0
  );
}

function handleGoogleInit(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  onEvent(initializingStatus({ obj }));
  return true;
}

function handleGoogleMessage(obj: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (obj.role === 'user') return true;
  if (!isGoogleAssistantText(obj)) return false;
  const delta = stripDuplicateArtifactText(obj.content as string, state);
  if (delta) onEvent({ type: 'text_delta', delta });
  return true;
}

function handleGoogleToolUse(obj: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (typeof obj.tool_id !== 'string' || typeof obj.tool_name !== 'string') return false;
  const input = safeParseJson({ value: obj.parameters }) ?? obj.parameters ?? null;
  const todoInput = obj.tool_name === 'write_todos' ? todoWriteInputFromParsedValue({ value: input }) : null;
  if (todoInput) {
    onEvent({
      type: 'tool_use',
      id: `${obj.tool_id}:todo-native`,
      name: 'TodoWrite',
      input: todoInput,
    });
    return true;
  }
  if (isFileWriteToolUse(obj.tool_name, input)) {
    state.legacyGoogle.suppressNextArtifactText = true;
  }
  onEvent({
    type: 'tool_use',
    id: obj.tool_id,
    name: obj.tool_name,
    input,
  });
  return true;
}

function handleGoogleToolResult(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  if (typeof obj.tool_id !== 'string') return false;
  const error = isRecord(obj.error) ? obj.error : null;
  const errorMessage = error ? extractErrorMessage({ value: error, fallback: '' }) : '';
  const output = typeof obj.output === 'string'
    ? obj.output
    : errorMessage || stringifyContent({ value: obj.output });
  onEvent({
    type: 'tool_result',
    toolUseId: obj.tool_id,
    content: output,
    isError: obj.status === 'error' || Boolean(error),
  });
  return true;
}

function handleGoogleError(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  const severity = typeof obj.severity === 'string' ? obj.severity.toLowerCase() : '';
  const message = extractErrorMessage({
    value: obj.message ?? obj.error,
    fallback: severity === 'warning' ? 'Google stream warning' : 'Google stream error',
  });
  if (severity === 'warning') {
    onEvent({ type: 'status', label: 'warning', detail: message });
  } else {
    onEvent({ type: 'error', message, raw: stringifyContent({ value: obj }) });
  }
  return true;
}

const GOOGLE_USAGE_FIELDS: UsageFields = [
  ['input_tokens', 'input_tokens'],
  ['output_tokens', 'output_tokens'],
  ['cached', 'cached_read_tokens'],
];

function handleGoogleResult(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  if (obj.status === 'error' || isRecord(obj.error)) {
    onEvent({
      type: 'error',
      message: extractErrorMessage({ value: obj.error, fallback: 'Google stream error' }),
      raw: stringifyContent({ value: obj }),
    });
    return true;
  }
  if (!isRecord(obj.stats)) return true;
  onEvent({
    type: 'usage',
    usage: pickUsage({ source: obj.stats, fields: GOOGLE_USAGE_FIELDS }),
    durationMs: optionalNumber({ value: obj.stats.duration_ms }),
  });
  return true;
}

const GOOGLE_FRAME_HANDLERS: ReadonlyMap<unknown, FrameHandler> = new Map<unknown, FrameHandler>([
  ['init', handleGoogleInit],
  ['message', handleGoogleMessage],
  ['tool_use', handleGoogleToolUse],
  ['tool_result', handleGoogleToolResult],
  ['error', handleGoogleError],
  ['result', handleGoogleResult],
]);

// Retain the neutral legacy wire decoder for stored streams; no CLI agent uses this kind.
export function handleLegacyGoogleStreamEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;
  if (!isGoogleAssistantText(obj)) {
    flushPendingArtifactText({ state, onEvent });
  }
  return dispatchFrame({ handlers: GOOGLE_FRAME_HANDLERS, obj, onEvent, state });
}

function stripDuplicateArtifactText(text: string, state: ParserState): string {
  if (
    !state.legacyGoogle.suppressNextArtifactText &&
    !state.legacyGoogle.suppressDuplicateArtifactText &&
    state.legacyGoogle.artifactOpenCandidate.length === 0
  ) {
    return text;
  }
  const openTag = '<artifact';
  const current = `${state.legacyGoogle.artifactOpenCandidate}${text}`;
  state.legacyGoogle.artifactOpenCandidate = '';
  if (state.legacyGoogle.suppressDuplicateArtifactText) {
    const closeIndex = current.indexOf('</artifact>');
    if (closeIndex === -1) return '';
    state.legacyGoogle.suppressDuplicateArtifactText = false;
    state.legacyGoogle.suppressNextArtifactText = false;
    return stripDuplicateArtifactText(current.slice(closeIndex + '</artifact>'.length), state);
  }
  const openIndex = current.indexOf(openTag);
  if (openIndex === -1) {
    const candidateLength = artifactOpenCandidateLength(current, openTag);
    if (state.legacyGoogle.suppressNextArtifactText && candidateLength > 0) {
      state.legacyGoogle.artifactOpenCandidate = current.slice(-candidateLength);
      return current.slice(0, -candidateLength);
    }
    // Reaching here with `suppressNextArtifactText` false is structurally
    // unreachable. To get past the top guard without it, `artifactOpenCandidate`
    // must have been non-empty at entry — but the only place that sets a
    // non-empty candidate is the branch right above (which requires this same
    // flag to be true when it does), and the only place that clears the
    // candidate other than the unconditional reset at the top of this function
    // (`flushPendingArtifactText`) clears the flag in the same breath. So a
    // leftover non-empty candidate always implies the flag is still true too.
    // No `if` needed — it's always true by the time we get here.
    state.legacyGoogle.suppressNextArtifactText = false;
    return current;
  }
  state.legacyGoogle.suppressDuplicateArtifactText = true;
  state.legacyGoogle.suppressNextArtifactText = false;
  const prefix = `${state.legacyGoogle.pendingArtifactText}${current.slice(0, openIndex)}`;
  state.legacyGoogle.pendingArtifactText = '';
  return `${prefix}${stripDuplicateArtifactText(current.slice(openIndex), state)}`;
}

function artifactOpenCandidateLength(text: string, openTag: string): number {
  const max = Math.min(openTag.length - 1, text.length);
  for (let len = max; len > 0; len -= 1) {
    if (openTag.startsWith(text.slice(-len))) return len;
  }
  return 0;
}

export function flushPendingArtifactText({ state, onEvent }: { state: ParserState; onEvent: StreamEventHandler }, _optional: Record<string, never> = {}): void {
  const delta = `${state.legacyGoogle.pendingArtifactText}${state.legacyGoogle.artifactOpenCandidate}`;
  if (!delta) return;
  state.legacyGoogle.pendingArtifactText = '';
  state.legacyGoogle.artifactOpenCandidate = '';
  state.legacyGoogle.suppressNextArtifactText = false;
  onEvent({ type: 'text_delta', delta });
}

function isFileWriteToolUse(toolName: string, input: unknown): boolean {
  if (!isRecord(input)) return false;
  const path = [input.file_path, input.path].find((value): value is string => typeof value === 'string') ?? '';
  const writesFile = toolName === 'write_file' ||
    toolName === 'write' ||
    toolName === 'replace' ||
    toolName === 'edit';
  if (!writesFile) return false;
  if (/\.(html|htm|css|js|jsx|ts|tsx|md)$/iu.test(path)) return true;
  return typeof input.content === 'string' || typeof input.new_string === 'string';
}

