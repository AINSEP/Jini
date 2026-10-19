/** @module json-event-stream
 * Multi-CLI JSON event parsing with per-handler stream state. */
type JsonObject = Record<string, unknown>;
type StreamEvent = Record<string, unknown>;
type StreamEventHandler = (event: StreamEvent) => void;
type ParserKind = string;

type ParserState = {
  cursorTextSoFar: string;
  cursorTurnStart: number;
  openCodeToolUses: Set<string>;
  codexToolUses: Set<string>;
  codexErrorEmitted: boolean;
  codexPreviousEventWasAgentMessage: boolean;
  codexLastAgentMessageEndedWithNewline: boolean;
  suppressNextArtifactText: boolean;
  suppressDuplicateArtifactText: boolean;
  artifactOpenCandidate: string;
  pendingArtifactText: string;
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  thought_tokens?: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
};

/** One vendor frame translator: returns `true` when it handled the frame, `false` to fall back to `raw`. */
type FrameHandler = (obj: JsonObject, onEvent: StreamEventHandler, state: ParserState) => boolean;

/** `[vendor field, Usage field]` pairs, in the emitted key order. */
type UsageFields = ReadonlyArray<readonly [string, keyof Usage]>;

function isRecord(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function trimmedNonBlank(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Copies the numeric vendor counters named in `fields` into a `Usage`, skipping absent ones. */
function pickUsage(source: JsonObject, fields: UsageFields): Usage {
  const usage: Usage = {};
  for (const [from, to] of fields) {
    const value = source[from];
    if (typeof value === 'number') usage[to] = value;
  }
  return usage;
}

/** Routes a record frame to the handler registered for its `type`; unknown types are unhandled. */
function dispatchFrame(
  handlers: ReadonlyMap<unknown, FrameHandler>,
  obj: JsonObject,
  onEvent: StreamEventHandler,
  state: ParserState,
): boolean {
  const handler = handlers.get(obj.type);
  return handler ? handler(obj, onEvent, state) : false;
}

function safeParseJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    // Current callers pass JSON.parse results or their fields, which cannot contain cycles or
    // BigInts, so stringify cannot throw. Keep this fallback for future non-JSON callers without
    // forcing a coverage test around data the current parser cannot produce.
    return String(value);
  }
}

function parseJsonObjectsFromContent(value: string): JsonObject[] {
  // The caller requires CONNECTOR_TOOL_NOT_FOUND before parsing. Empty input also reaches the
  // existing [] fallback naturally, so no separate empty-string branch is needed.
  const trimmed = value.trim();
  const direct = safeParseJson(trimmed);
  if (isRecord(direct)) return [direct];
  const objects: JsonObject[] = [];
  for (const line of trimmed.split(/\r?\n/u)) {
    const parsedLine = safeParseJson(line.trim());
    if (isRecord(parsedLine)) objects.push(parsedLine);
  }
  return objects;
}

function extractConnectorApiError(value: JsonObject): JsonObject | null {
  if (isRecord(value.error)) {
    if (typeof value.error.code === 'string') return value.error;
    if (isRecord(value.error.data) && isRecord(value.error.data.error)) {
      const wrappedError = value.error.data.error;
      if (typeof wrappedError.code === 'string') return wrappedError;
    }
  }
  return null;
}

function connectorToolSelectionErrorMessage(content: string): string | null {
  if (!content.includes('CONNECTOR_TOOL_NOT_FOUND')) return null;
  const error = parseJsonObjectsFromContent(content)
    .map(extractConnectorApiError)
    .find((parsedError) => parsedError?.code === 'CONNECTOR_TOOL_NOT_FOUND');
  if (!error) return null;
  const details = isRecord(error.details) ? error.details : {};
  const connectorId = nonEmptyString(details.connectorId);
  const toolName = nonEmptyString(details.toolName) ?? 'the requested connector tool';
  const target = connectorId
    ? `Connector tool ${toolName} is not allowed for connector ${connectorId}.`
    : `Connector tool ${toolName} is not allowed.`;
  return `${target} Re-list the connector catalog and choose one of the currently allowed read-only tools.`;
}

function isNonNullObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function extractErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const parsed = safeParseJson(value);
    return isNonNullObject(parsed) ? extractErrorMessage(parsed, value) : value;
  }
  return isRecord(value) ? extractRecordErrorMessage(value, fallback) : fallback;
}

/** Field precedence for an error object: detail, message (itself maybe JSON), error, data, name. */
function extractRecordErrorMessage(value: JsonObject, fallback: string): string {
  const detail = nonEmptyString(value.detail);
  if (detail) return detail;
  const message = nonEmptyString(value.message);
  if (message) return extractErrorMessage(message, message);
  const error = nonEmptyString(value.error);
  if (error) return error;
  if (isNonNullObject(value.error)) return extractErrorMessage(value.error, fallback);
  const dataMessage = isNonNullObject(value.data) ? extractErrorMessage(value.data, '') : '';
  return dataMessage || nonEmptyString(value.name) || fallback;
}

function isRecoverableCodexReconnect(message: string): boolean {
  return (
    message.startsWith('Reconnecting...') &&
    (
      message.includes('timeout waiting for child process to exit') ||
      message.includes('stream disconnected before completion')
    )
  );
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
  if (!state.openCodeToolUses.has(key)) {
    state.openCodeToolUses.add(key);
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

function handleOpenCodeEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;
  return dispatchFrame(OPENCODE_FRAME_HANDLERS, obj, onEvent, state);
}

function initializingStatus(obj: JsonObject): StreamEvent {
  return { type: 'status', label: 'initializing', model: optionalString(obj.model) };
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
  onEvent(initializingStatus(obj));
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
  const input = safeParseJson(obj.parameters) ?? obj.parameters ?? null;
  const todoInput = obj.tool_name === 'write_todos' ? todoWriteInputFromParsedValue(input) : null;
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
    state.suppressNextArtifactText = true;
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
  const errorMessage = error ? extractErrorMessage(error, '') : '';
  const output = typeof obj.output === 'string'
    ? obj.output
    : errorMessage || stringifyContent(obj.output);
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
  const message = extractErrorMessage(
    obj.message ?? obj.error,
    severity === 'warning' ? 'Google stream warning' : 'Google stream error',
  );
  if (severity === 'warning') {
    onEvent({ type: 'status', label: 'warning', detail: message });
  } else {
    onEvent({ type: 'error', message, raw: stringifyContent(obj) });
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
      message: extractErrorMessage(obj.error, 'Google stream error'),
      raw: stringifyContent(obj),
    });
    return true;
  }
  if (!isRecord(obj.stats)) return true;
  onEvent({
    type: 'usage',
    usage: pickUsage(obj.stats, GOOGLE_USAGE_FIELDS),
    durationMs: optionalNumber(obj.stats.duration_ms),
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
function handleLegacyGoogleStreamEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;
  if (!isGoogleAssistantText(obj)) {
    flushPendingArtifactText(state, onEvent);
  }
  return dispatchFrame(GOOGLE_FRAME_HANDLERS, obj, onEvent, state);
}

function emitKimiToolCalls(toolCalls: unknown[], onEvent: StreamEventHandler): void {
  for (const rawCall of toolCalls) {
    const call = isRecord(rawCall) ? rawCall : {};
    const fn = isRecord(call.function) ? call.function : {};
    const id = trimmedNonBlank(call.id);
    const name = trimmedNonBlank(fn.name);
    if (!id || !name) continue;
    const input = safeParseJson(fn.arguments) ?? fn.arguments ?? null;
    onEvent({ type: 'tool_use', id, name, input });
  }
}

function handleKimiAssistant(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  if (Array.isArray(obj.tool_calls)) {
    emitKimiToolCalls(obj.tool_calls, onEvent);
    return true;
  }
  const text = nonEmptyString(obj.content);
  if (!text) return false;
  onEvent({ type: 'text_delta', delta: text });
  return true;
}

function handleKimiToolResult(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  const toolUseId = trimmedNonBlank(obj.tool_call_id);
  if (!toolUseId) return false;
  onEvent({
    type: 'tool_result',
    toolUseId,
    content: stringifyContent(obj.content),
    isError: false,
  });
  return true;
}

function handleKimiEvent(obj: unknown, onEvent: StreamEventHandler): boolean {
  if (!isRecord(obj)) return false;
  if (obj.role === 'assistant') return handleKimiAssistant(obj, onEvent);
  if (obj.role === 'tool') return handleKimiToolResult(obj, onEvent);
  return obj.role === 'meta' && obj.type === 'session.resume_hint';
}

function extractCursorText(message: unknown): string {
  const content = isRecord(message) ? message.content : undefined;
  const blocks = Array.isArray(content) ? content : [];
  return blocks
    .filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/** Ordered status buckets: the first rule whose exact alias or prefix matches wins; else `pending`. */
const TODO_STATUS_RULES: ReadonlyArray<{ status: string; exact: string[]; prefixes: string[] }> = [
  { status: 'completed', exact: ['complete', 'done'], prefixes: ['completed'] },
  { status: 'in_progress', exact: ['doing', 'active'], prefixes: ['in_progress'] },
  { status: 'stopped', exact: [], prefixes: ['stopped', 'failed', 'blocked', 'canceled', 'cancelled'] },
];

function normalizeTodoStatus(value: unknown): string {
  const status = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[-\s]+/g, '_')
    : '';
  const rule = TODO_STATUS_RULES.find(
    (candidate) => candidate.exact.includes(status) || candidate.prefixes.some((prefix) => status.startsWith(prefix)),
  );
  return rule ? rule.status : 'pending';
}

/** Todo text fields in precedence order; the first string-typed one wins, even when empty. */
const TODO_CONTENT_FIELDS = ['content', 'label', 'description', 'text'] as const;

function todoFromItem(raw: unknown): JsonObject | null {
  if (!isRecord(raw)) return null;
  const field = TODO_CONTENT_FIELDS.find((key) => typeof raw[key] === 'string');
  const content = field ? (raw[field] as string) : '';
  if (!content) return null;
  return {
    content,
    status: raw.completed === true
      ? 'completed'
      : normalizeTodoStatus(raw.status),
  };
}

// Takes `unknown[]`, not `unknown`: every real call site
// (`todoWriteInputFromParsedValue`'s three call sites and
// `codexTodoListInput`) already runs `Array.isArray(...)` before calling in,
// so a runtime `!Array.isArray` guard here was dead code for every real
// caller. Narrowed the parameter type to remove the branch instead of
// padding a test around unreachable data.
function todoWriteInputFromItems(items: unknown[]): JsonObject | null {
  const todos = items
    .map(todoFromItem)
    .filter((todo): todo is JsonObject => todo !== null);
  return todos.length > 0 ? { todos } : null;
}

function todoWriteInputFromParsedValue(value: unknown): JsonObject | null {
  if (Array.isArray(value)) return todoWriteInputFromItems(value);
  if (!isRecord(value)) return null;
  if (Array.isArray(value.todos)) return todoWriteInputFromItems(value.todos);
  if (Array.isArray(value.todo)) return todoWriteInputFromItems(value.todo);
  return null;
}

function stripDuplicateArtifactText(text: string, state: ParserState): string {
  if (
    !state.suppressNextArtifactText &&
    !state.suppressDuplicateArtifactText &&
    state.artifactOpenCandidate.length === 0
  ) {
    return text;
  }
  const openTag = '<artifact';
  const current = `${state.artifactOpenCandidate}${text}`;
  state.artifactOpenCandidate = '';
  if (state.suppressDuplicateArtifactText) {
    const closeIndex = current.indexOf('</artifact>');
    if (closeIndex === -1) return '';
    state.suppressDuplicateArtifactText = false;
    state.suppressNextArtifactText = false;
    return stripDuplicateArtifactText(current.slice(closeIndex + '</artifact>'.length), state);
  }
  const openIndex = current.indexOf(openTag);
  if (openIndex === -1) {
    const candidateLength = artifactOpenCandidateLength(current, openTag);
    if (state.suppressNextArtifactText && candidateLength > 0) {
      state.artifactOpenCandidate = current.slice(-candidateLength);
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
    state.suppressNextArtifactText = false;
    return current;
  }
  state.suppressDuplicateArtifactText = true;
  state.suppressNextArtifactText = false;
  const prefix = `${state.pendingArtifactText}${current.slice(0, openIndex)}`;
  state.pendingArtifactText = '';
  return `${prefix}${stripDuplicateArtifactText(current.slice(openIndex), state)}`;
}

function artifactOpenCandidateLength(text: string, openTag: string): number {
  const max = Math.min(openTag.length - 1, text.length);
  for (let len = max; len > 0; len -= 1) {
    if (openTag.startsWith(text.slice(-len))) return len;
  }
  return 0;
}

function flushPendingArtifactText(state: ParserState, onEvent: StreamEventHandler): void {
  const delta = `${state.pendingArtifactText}${state.artifactOpenCandidate}`;
  if (!delta) return;
  state.pendingArtifactText = '';
  state.artifactOpenCandidate = '';
  state.suppressNextArtifactText = false;
  onEvent({ type: 'text_delta', delta });
}

function isFileWriteToolUse(toolName: string, input: unknown): boolean {
  if (!isRecord(input)) return false;
  const path = typeof input.file_path === 'string'
    ? input.file_path
    : typeof input.path === 'string'
      ? input.path
      : '';
  const writesFile = toolName === 'write_file' ||
    toolName === 'write' ||
    toolName === 'replace' ||
    toolName === 'edit';
  if (!writesFile) return false;
  if (/\.(html|htm|css|js|jsx|ts|tsx|md)$/iu.test(path)) return true;
  return typeof input.content === 'string' || typeof input.new_string === 'string';
}

function codexTodoListInput(item: JsonObject): JsonObject | null {
  if (item.type !== 'todo_list' || !Array.isArray(item.items)) return null;
  return todoWriteInputFromItems(item.items);
}

function emitCodexTodoList(item: JsonObject, onEvent: StreamEventHandler): boolean {
  if (typeof item.id !== 'string') return false;
  const input = codexTodoListInput(item);
  if (!input) return false;
  onEvent({
    type: 'tool_use',
    id: item.id,
    name: 'TodoWrite',
    input,
  });
  return true;
}

type CodexItem = JsonObject & { id: string };

function hasStringId(item: JsonObject): item is CodexItem {
  return typeof item.id === 'string';
}

/** Marks `key` as emitted in `state.codexToolUses`; `true` only the first time (Codex repeats frames per call). */
function claimCodexToolUse(state: ParserState, key: string): boolean {
  if (state.codexToolUses.has(key)) return false;
  state.codexToolUses.add(key);
  return true;
}

function resetCodexAgentMessageBoundary(state: ParserState): void {
  state.codexPreviousEventWasAgentMessage = false;
  state.codexLastAgentMessageEndedWithNewline = false;
}

/** Emits a Codex `error` only for the first error of the stream; later ones are dropped. */
function emitCodexErrorOnce(message: string, onEvent: StreamEventHandler, state: ParserState): void {
  if (state.codexErrorEmitted) return;
  state.codexErrorEmitted = true;
  onEvent({ type: 'error', message });
}

function codexMcpToolName(item: JsonObject): string {
  const tool = nonEmptyString(item.tool);
  // Preserve the bridge's catalog names; external MCP must never masquerade as Bash/Edit.
  if (item.server === 'jini') return tool ?? 'mcp_tool_call';
  const server = typeof item.server === 'string' ? item.server : 'external';
  return `mcp__${server}__${tool ?? 'call'}`;
}

/**
 * Emits the `tool_use` for one `item.type: 'mcp_tool_call'` item, deduped per `item.id` via
 * `state.codexToolUses` (the same dedup `command_execution`'s two call sites — `item.started` and
 * `item.completed` — already rely on, since Codex reports both frames for one call).
 *
 * `item.tool` — the literal MCP tool name Codex called (`search_tools`, `describe_tool`,
 * `execute_delegated_tool`) — is used verbatim as the emitted `name`, never unwrapped to the
 * delegated `toolId` inside `item.arguments`: `@jini-ai/chat`'s `ToolCard`/`DelegatedToolCard`
 * already recover that id from `{toolId, input}` for `execute_delegated_tool` specifically (see that
 * component's own doc), so duplicating the unwrap here would be a second, driftable copy of the same
 * decision.
 *
 * @param item - The `item.started`/`item.completed` payload's `item` object.
 * @param onEvent - Sink for the emitted `tool_use`.
 * @param state - Parser state; only `codexToolUses` is read/written.
 * @returns `true` iff this item is an `mcp_tool_call` with a usable id (whether or not a `tool_use`
 * was newly emitted vs. already deduped) — this is what `handleCodexEvent`'s `item.started` branch
 * uses to decide the frame was handled.
 * @complexity O(1).
 * @overallScore 100
 */
function emitCodexMcpToolUse(item: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (item.type !== 'mcp_tool_call' || !hasStringId(item)) return false;
  if (claimCodexToolUse(state, item.id)) {
    onEvent({
      type: 'tool_use',
      id: item.id,
      name: codexMcpToolName(item),
      input: item.arguments ?? {},
    });
  }
  return true;
}

function emitCodexBashToolUse(item: CodexItem, onEvent: StreamEventHandler, state: ParserState): void {
  if (!claimCodexToolUse(state, item.id)) return;
  onEvent({
    type: 'tool_use',
    id: item.id,
    name: 'Bash',
    input: {
      command: typeof item.command === 'string' ? item.command : '',
    },
  });
}

function emitCodexCollabToolCall(item: CodexItem, completed: boolean, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (claimCodexToolUse(state, item.id)) {
    onEvent({ type: 'tool_use', id: item.id,
      name: typeof item.tool === 'string' ? item.tool : 'collab_tool_call', input: {} });
  }
  if (completed && claimCodexToolUse(state, `${item.id}:completed`)) {
    onEvent({ type: 'tool_result', toolUseId: item.id,
      content: 'Native agent action completed.', isError: item.status === 'failed' });
  }
  return true;
}

function handleCodexItemStarted(item: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (emitCodexTodoList(item, onEvent)) {
    resetCodexAgentMessageBoundary(state);
    return true;
  }
  if (item.type === 'command_execution' && hasStringId(item)) {
    resetCodexAgentMessageBoundary(state);
    emitCodexBashToolUse(item, onEvent, state);
    return true;
  }
  if (item.type !== 'mcp_tool_call') return false;
  resetCodexAgentMessageBoundary(state);
  return emitCodexMcpToolUse(item, onEvent, state);
}

function handleCodexItemUpdated(item: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!emitCodexTodoList(item, onEvent)) return false;
  resetCodexAgentMessageBoundary(state);
  return true;
}

function completeCodexFileChange(item: CodexItem, onEvent: StreamEventHandler, state: ParserState): boolean {
  // Codex reports direct patches as file_change, rather than command_execution. Surface paths
  // through the SAME native-tool event channel so audit sees edits without persisting patches.
  if (!claimCodexToolUse(state, item.id)) return true;
  const changes = Array.isArray(item.changes) ? item.changes : [];
  onEvent({ type: 'tool_use', id: item.id, name: 'apply_patch',
    input: { paths: changes.filter(isRecord).map(change => change.path).filter(path => typeof path === 'string') } });
  onEvent({ type: 'tool_result', toolUseId: item.id, content: 'File change reported by Codex.', isError: item.status === 'failed' });
  return true;
}

function completeCodexCommand(item: CodexItem, onEvent: StreamEventHandler, state: ParserState): boolean {
  resetCodexAgentMessageBoundary(state);
  emitCodexBashToolUse(item, onEvent, state);
  const content = stringifyContent(item.aggregated_output ?? '');
  onEvent({
    type: 'tool_result',
    toolUseId: item.id,
    content,
    isError: typeof item.exit_code === 'number' ? item.exit_code !== 0 : item.status === 'failed',
  });
  const connectorToolError = connectorToolSelectionErrorMessage(content);
  if (connectorToolError) emitCodexErrorOnce(connectorToolError, onEvent, state);
  return true;
}

function completeCodexMcpToolCall(item: CodexItem, onEvent: StreamEventHandler, state: ParserState): boolean {
  resetCodexAgentMessageBoundary(state);
  // `item.started` normally already emitted the matching `tool_use` (see
  // `emitCodexMcpToolUse`); this call is a no-op then, and only actually emits one for a
  // call whose `item.started` frame this parser never saw (a truncated/mid-stream feed —
  // the same fallback shape `command_execution`'s own `item.completed` branch above uses).
  emitCodexMcpToolUse(item, onEvent, state);
  // A call Codex's own approval gate denies before ever reaching the target MCP server
  // reports back exactly this shape — `status: 'failed'`, `result: null`, an `error` object
  // — which is otherwise indistinguishable from "never happened" downstream: no
  // `tool_use`/`tool_result` pair means no audit row, no error card, nothing an operator or
  // the model itself can ground a claim on. `isError` on `status !== 'completed'` (not a
  // truthiness check on `item.error`) matches every other status branch in this file and
  // stays correct even for a hypothetical future status this union does not name yet.
  const isError = item.status !== 'completed';
  const content = isError
    ? extractErrorMessage(item.error, 'MCP tool call failed')
    : stringifyContent(item.result);
  onEvent({ type: 'tool_result', toolUseId: item.id, content, isError });
  return true;
}

function emitCodexAgentMessage(item: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  const text = item.type === 'agent_message' ? nonEmptyString(item.text) : null;
  if (!text) return false;
  const needsBoundary =
    state.codexPreviousEventWasAgentMessage &&
    !state.codexLastAgentMessageEndedWithNewline &&
    !text.startsWith('\n');
  const delta = needsBoundary ? `\n${text}` : text;
  onEvent({ type: 'text_delta', delta });
  state.codexPreviousEventWasAgentMessage = true;
  state.codexLastAgentMessageEndedWithNewline = text.endsWith('\n');
  return true;
}

function handleCodexItemCompleted(item: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (item.type === 'file_change' && hasStringId(item)) return completeCodexFileChange(item, onEvent, state);
  if (emitCodexTodoList(item, onEvent)) {
    resetCodexAgentMessageBoundary(state);
    return true;
  }
  if (item.type === 'command_execution' && hasStringId(item)) return completeCodexCommand(item, onEvent, state);
  if (item.type === 'mcp_tool_call' && hasStringId(item)) return completeCodexMcpToolCall(item, onEvent, state);
  return emitCodexAgentMessage(item, onEvent, state);
}

/**
 * Wraps a per-frame item handler with the checks every `item.*` frame shares: a record `item`, and
 * native `collab_tool_call` items, which report the same way on started/updated/completed.
 */
function codexItemFrame(
  handleItem: (item: JsonObject, onEvent: StreamEventHandler, state: ParserState) => boolean,
): FrameHandler {
  return (obj, onEvent, state) => {
    if (!isRecord(obj.item)) return false;
    const item = obj.item;
    if (item.type === 'collab_tool_call' && hasStringId(item)) {
      return emitCodexCollabToolCall(item, obj.type === 'item.completed', onEvent, state);
    }
    return handleItem(item, onEvent, state);
  };
}

function handleCodexError(obj: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  const message = extractErrorMessage(obj.message ?? obj.error, 'Codex error');
  // Reconnecting events are recoverable — treat as status warning, not fatal
  if (isRecoverableCodexReconnect(message)) {
    onEvent({ type: 'status', label: message });
    return true;
  }
  emitCodexErrorOnce(message, onEvent, state);
  return true;
}

function handleCodexTurnFailed(obj: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  emitCodexErrorOnce(extractErrorMessage(obj.error ?? obj.message, 'Codex turn failed'), onEvent, state);
  return true;
}

function handleCodexThreadStarted(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  // `thread_id` is Codex's own session handle, surfaced on the same
  // `sessionId` status channel claude uses (claude-stream.ts). It serves two
  // consumers: (1) the daemon persists it to `agent_sessions` and replays it
  // as `exec resume <thread_id>` on the next turn (capture-style resume), and
  // (2) it identifies this run's rollout file
  // (`$CODEX_HOME/sessions/**/rollout-*-<thread_id>.jsonl`), the only place
  // codex records per-call usage, which run_finished reads to recover the
  // turn's first-call cache hit (codex's stream usage is cumulative only).
  // Codex emits this both for a fresh `exec` and for `exec resume` (echoing
  // the resumed id), so it is a stable capture point either way.
  onEvent({ type: 'status', label: 'initializing', sessionId: nonEmptyString(obj.thread_id) });
  return true;
}

function handleCodexTurnStarted(_obj: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  resetCodexAgentMessageBoundary(state);
  onEvent({ type: 'status', label: 'thinking' });
  return true;
}

const CODEX_USAGE_FIELDS: UsageFields = [
  ['input_tokens', 'input_tokens'],
  ['output_tokens', 'output_tokens'],
  ['reasoning_output_tokens', 'thought_tokens'],
  ['cached_input_tokens', 'cached_read_tokens'],
];

function handleCodexTurnCompleted(obj: JsonObject, onEvent: StreamEventHandler): boolean {
  if (!isRecord(obj.usage)) return false;
  onEvent({ type: 'usage', usage: pickUsage(obj.usage, CODEX_USAGE_FIELDS) });
  return true;
}

const CODEX_FRAME_HANDLERS: ReadonlyMap<unknown, FrameHandler> = new Map<unknown, FrameHandler>([
  ['error', handleCodexError],
  ['turn.failed', handleCodexTurnFailed],
  ['thread.started', handleCodexThreadStarted],
  ['turn.started', handleCodexTurnStarted],
  ['item.started', codexItemFrame(handleCodexItemStarted)],
  ['item.updated', codexItemFrame(handleCodexItemUpdated)],
  ['item.completed', codexItemFrame(handleCodexItemCompleted)],
  ['turn.completed', handleCodexTurnCompleted],
]);

function handleCodexEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;
  return dispatchFrame(CODEX_FRAME_HANDLERS, obj, onEvent, state);
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
  state.cursorTextSoFar += text;
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
  const emittedTurn = state.cursorTextSoFar.slice(state.cursorTurnStart);
  if (text && text !== emittedTurn && text.startsWith(emittedTurn)) {
    const suffix = text.slice(emittedTurn.length);
    if (suffix) onEvent({ type: 'text_delta', delta: suffix });
    state.cursorTextSoFar += suffix;
  }
  state.cursorTurnStart = state.cursorTextSoFar.length;
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

function handleCursorEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;

  if (obj.type === 'system' && obj.subtype === 'init') {
    onEvent(initializingStatus(obj));
    return true;
  }

  if (obj.type === 'assistant' && obj.message) return handleCursorAssistant(obj, onEvent, state);

  if (obj.type === 'result' && isRecord(obj.usage)) {
    onEvent({
      type: 'usage',
      usage: pickUsage(obj.usage, CURSOR_USAGE_FIELDS),
      durationMs: optionalNumber(obj.duration_ms),
    });
    return true;
  }

  return false;
}

const MODEL_RECEIPT_FRAME_TYPES = new Set(['session.created', 'thread.started', 'turn.started', 'model.changed']);

// Preserve structured model receipts before vendor event translation. These fields describe
// session/turn/assistant-message metadata; generated text is never used for model identity.
function emitModelReceipts(obj: unknown, onEvent: StreamEventHandler): void {
  if (!isRecord(obj)) return;
  const properties = obj.properties as { info?: { role?: string; modelID?: string; providerID?: string } } | undefined;
  const info = obj.type === 'message.updated' ? properties?.info : undefined;
  if (info?.role === 'assistant' && typeof info.modelID === 'string') {
    onEvent({ type: 'status', label: 'model', model: info.providerID ? `${info.providerID}/${info.modelID}` : info.modelID });
  }
  if (typeof obj.model === 'string' && MODEL_RECEIPT_FRAME_TYPES.has(String(obj.type))) {
    onEvent({ type: 'status', label: 'model', model: obj.model });
  }
}

const PARSERS_BY_KIND: ReadonlyMap<ParserKind, (obj: unknown, onEvent: StreamEventHandler, state: ParserState) => boolean> = new Map([
  ['opencode', handleOpenCodeEvent],
  ['legacy-google-stream-json', handleLegacyGoogleStreamEvent],
  ['kimi', handleKimiEvent],
  ['cursor-agent', handleCursorEvent],
  ['codex', handleCodexEvent],
]);

export function createJsonEventStreamHandler({ kind, onEvent }: { kind: ParserKind; onEvent: StreamEventHandler }) {
  let buffer = '';
  const state: ParserState = {
    cursorTextSoFar: '',
    cursorTurnStart: 0,
    openCodeToolUses: new Set<string>(),
    codexToolUses: new Set<string>(),
    codexErrorEmitted: false,
    codexPreviousEventWasAgentMessage: false,
    codexLastAgentMessageEndedWithNewline: false,
    suppressNextArtifactText: false,
    suppressDuplicateArtifactText: false,
    artifactOpenCandidate: '',
    pendingArtifactText: '',
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

  function feed({ chunk }: { chunk: string }): void {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      handleLine(line);
    }
  }

  function flush(): void {
    const rem = buffer.trim();
    buffer = '';
    if (rem) handleLine(rem);
    flushPendingArtifactText(state, onEvent);
  }

  return { feed, flush };
}
