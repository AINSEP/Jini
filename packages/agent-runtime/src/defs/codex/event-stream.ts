import { sanitizeUntrustedText } from '@jini-ai/core/text';
import { dispatchFrame, extractErrorMessage, isRecord, nonEmptyString, pickUsage, safeParseJson, stringifyContent, todoWriteInputFromItems, trimmedNonBlank } from '../../json-event-stream-shared.js';
import type { FrameHandler, JsonObject, ParserState, StreamEventHandler, UsageFields } from '../../json-event-stream-shared.js';

export type CodexStreamState = {
  toolUses: Set<string>;
  errorEmitted: boolean;
  previousEventWasAgentMessage: boolean;
  lastAgentMessageEndedWithNewline: boolean;
};

export function createCodexStreamState(): CodexStreamState {
  return { toolUses: new Set<string>(), errorEmitted: false, previousEventWasAgentMessage: false, lastAgentMessageEndedWithNewline: false };
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

function isRecoverableCodexReconnect(message: string): boolean {
  return (
    message.startsWith('Reconnecting...') &&
    (
      message.includes('timeout waiting for child process to exit') ||
      message.includes('stream disconnected before completion')
    )
  );
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

/** Marks `key` as emitted in `state.codex.toolUses`; `true` only the first time (Codex repeats frames per call). */
function claimCodexToolUse(state: ParserState, key: string): boolean {
  if (state.codex.toolUses.has(key)) return false;
  state.codex.toolUses.add(key);
  return true;
}

function resetCodexAgentMessageBoundary(state: ParserState): void {
  state.codex.previousEventWasAgentMessage = false;
  state.codex.lastAgentMessageEndedWithNewline = false;
}

/** Emits a Codex `error` only for the first error of the stream; later ones are dropped. */
function emitCodexErrorOnce(message: string, onEvent: StreamEventHandler, state: ParserState): void {
  if (state.codex.errorEmitted) return;
  state.codex.errorEmitted = true;
  onEvent({ type: 'error', message });
}

function codexMcpToolName(item: JsonObject): string {
  const tool = nonEmptyString(item.tool);
  // Preserve the bridge's catalog names; external MCP must never masquerade as Bash/Edit.
  // A Jini call is named `mcp__jini__X` exactly as Claude Code names it: the daemon bridge also
  // reports a direct call as its own `X` row, and @jini-ai/chat folds the pair into one row only
  // when the CLI row carries the MCP prefix (a bare `X` drew every Codex direct call twice).
  const server = typeof item.server === 'string' ? item.server : 'external';
  return `mcp__${server}__${tool ?? 'call'}`;
}

/**
 * Emits the `tool_use` for one `item.type: 'mcp_tool_call'` item, deduped per `item.id` via
 * `state.codex.toolUses` (the same dedup `command_execution`'s two call sites — `item.started` and
 * `item.completed` — already rely on, since Codex reports both frames for one call).
 *
 * `item.tool` — the literal MCP tool name Codex called (`search_tools`, `describe_tool`,
 * `execute_delegated_tool`) — is used verbatim (behind the `mcp__jini__` prefix, see
 * {@link codexMcpToolName}) as the emitted `name`, never unwrapped to the
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
  if (claimCodexToolUse(state, item.id)) emitCodexFileChange(item, onEvent);
  return true;
}

function emitCodexFileChange(item: CodexItem, onEvent: StreamEventHandler): void {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  onEvent({ type: 'tool_use', id: item.id, name: 'apply_patch',
    input: { paths: changes.filter(isRecord).map(change => change.path).filter(path => typeof path === 'string') } });
  onEvent({ type: 'tool_result', toolUseId: item.id, content: 'File change reported by Codex.', isError: item.status === 'failed' });
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

/**
 * Select a failed MCP call's diagnostic without exposing arguments or result metadata.
 * Codex 0.161.0's exec mapper carries result content/structured_content independently of error:
 * https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs#L195
 * @returns Sanitized error text, or the generic failure when no diagnostic is present.
 * @complexity O(n) time/space for n diagnostic characters, including the shared sanitizer pass.
 */
function codexMcpFailureContent({ item }: { item: CodexItem }, _options = {}): string {
  const error = trimmedNonBlank(extractErrorMessage(item.error, ''));
  const result = isRecord(item.result) ? item.result : {};
  const blocks = Array.isArray(result.content) ? result.content : [];
  // Keep text verbatim until sanitizing so JSON error envelopes retain codes and recovery hints.
  const text = blocks.filter(isRecord)
    .filter(block => block.type === 'text')
    .map(block => trimmedNonBlank(block.text))
    .filter(Boolean)
    .join('\n');
  const structuredText = extractErrorMessage(result.structured_content, '');
  const diagnostic = error || text || trimmedNonBlank(structuredText) || 'MCP tool call failed';
  return sanitizeUntrustedText({ text: diagnostic });
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
    ? codexMcpFailureContent({ item })
    : stringifyContent(item.result);
  onEvent({ type: 'tool_result', toolUseId: item.id, content, isError });
  return true;
}

function emitCodexAgentMessage(item: JsonObject, onEvent: StreamEventHandler, state: ParserState): boolean {
  const text = item.type === 'agent_message' ? nonEmptyString(item.text) : null;
  if (!text) return false;
  const needsBoundary =
    state.codex.previousEventWasAgentMessage &&
    !state.codex.lastAgentMessageEndedWithNewline &&
    !text.startsWith('\n');
  const delta = needsBoundary ? `\n${text}` : text;
  onEvent({ type: 'text_delta', delta });
  state.codex.previousEventWasAgentMessage = true;
  state.codex.lastAgentMessageEndedWithNewline = text.endsWith('\n');
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

export function handleCodexEvent(obj: unknown, onEvent: StreamEventHandler, state: ParserState): boolean {
  if (!isRecord(obj)) return false;
  return dispatchFrame(CODEX_FRAME_HANDLERS, obj, onEvent, state);
}

