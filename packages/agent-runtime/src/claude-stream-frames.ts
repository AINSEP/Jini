/** @module claude-stream-frames
 * Pure frame helpers for Claude's stream-json output: task bookkeeping, artifact-echo
 * dedup, system/user frame handlers. Leaf module: `claude-stream-handler.ts` (the stateful
 * handler) and `claude-stream.ts` (the public entry) both import it, so neither imports the other
 * at runtime. `ClaudeStreamEvent` stays in `claude-stream.ts` and is imported here as a type only.
 */
import { readDelegatedResult } from '@jini-ai/protocol';
import type { ClaudeStreamEvent } from './claude-stream.js';

export type EventSink = (event: ClaudeStreamEvent) => void;
/** The first argument that is a string (possibly empty), or `undefined` when none is. */
function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}
export type BlockState = {
  type?: unknown;
  name?: unknown;
  id?: unknown;
  input: string;
  inputValue?: unknown;
};
export type RuntimeTask = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'stopped';
  activeForm?: string;
};

// Mutable counter backing `runtimeTaskIdFromCreate`'s auto-generated ids.
// A plain object (rather than a bare number) so it can be threaded through
// exported functions by reference and still observe each other's bumps.
export type RuntimeTaskIdCounter = { next: number };

// The task-registry subsystem's full mutable state: the tasks a
// `TaskCreate`/`TaskUpdate` snapshot has accumulated, the id counter, and
// which tool-use ids have already produced a canonical `TodoWrite` snapshot
// (so a re-seen id short-circuits to "already applied" instead of
// re-emitting). Grouped into one object so `emitCanonicalTaskSnapshot` and
// friends can be constructed and asserted on directly in tests.
export interface TaskRegistry {
  tasks: Map<string, RuntimeTask>;
  counter: RuntimeTaskIdCounter;
  seenToolUseIds: Set<string>;
}

// State `isRedundantWrittenArtifact` reads to decide whether an echoed
// `<artifact>` block duplicates a file the model just wrote. Read-only —
// unlike `TaskRegistry`, nothing here is mutated by the function.
export interface ArtifactEchoContext {
  suppressHtmlArtifactsAfterFileWrite: boolean;
  wroteHtmlFileThisTurn: boolean;
  recentWriteContents: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(['Write', 'Edit', 'write_file', 'replace']);

export function toolInputPath(input: Record<string, unknown>): string {
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  return '';
}

// Runtime-task status aliases the Claude Code wire format has used across
// versions, normalized to the four statuses the UI understands.
const TASK_STATUS_ALIASES: Readonly<Record<string, RuntimeTask['status']>> = {
  completed: 'completed',
  in_progress: 'in_progress',
  stopped: 'stopped',
  complete: 'completed',
  done: 'completed',
  doing: 'in_progress',
  active: 'in_progress',
  failed: 'stopped',
  canceled: 'stopped',
  cancelled: 'stopped',
};

export function normalizeTaskStatus(value: unknown): RuntimeTask['status'] {
  if (typeof value !== 'string') return 'pending';
  return TASK_STATUS_ALIASES[value] ?? 'pending';
}

function nextGeneratedRuntimeTaskId(counter: RuntimeTaskIdCounter): string {
  // Coverage-driven refactor (2026-07-18, no behavior change): the
  // original OD source guarded the returned id with
  // `while (runtimeTasks.has(String(nextRuntimeTaskId))) nextRuntimeTaskId += 1;`.
  // Tracing every path that can insert a numeric id into `runtimeTasks`
  // shows the guard can never trigger: the only two insertion paths are
  // (a) this function itself, which always hands out the current
  // `nextRuntimeTaskId` and then increments it, so that exact value is
  // never in the map yet; and (b) `runtimeTaskIdFromCreate`'s
  // explicit-id branch, which bumps `nextRuntimeTaskId` to
  // `numericId + 1` (strictly past itself) BEFORE this function could
  // ever be asked to reuse that id. Since `nextRuntimeTaskId` only ever
  // increases, it can never equal an id already present in the map at
  // this point. Removed per the coverage skill's Phase 6.5 "dead
  // branch" classification rather than fake a test for an unreachable
  // loop; see archived provenance ledger.
  const id = String(counter.next);
  counter.next += 1;
  return id;
}

export function runtimeTaskIdFromCreate(input: Record<string, unknown>, counter: RuntimeTaskIdCounter): string {
  if (typeof input.taskId === 'string' && input.taskId) {
    const numericId = Number(input.taskId);
    if (Number.isSafeInteger(numericId) && numericId >= counter.next) {
      counter.next = numericId + 1;
    }
    return input.taskId;
  }
  return nextGeneratedRuntimeTaskId(counter);
}

export function applyTaskCreate(
  input: Record<string, unknown>,
  tasks: Map<string, RuntimeTask>,
  counter: RuntimeTaskIdCounter,
): boolean {
  const content = firstString(input.subject, input.description) ?? '';
  if (!content) return false;
  const id = runtimeTaskIdFromCreate(input, counter);
  const activeForm = typeof input.activeForm === 'string' ? input.activeForm : undefined;
  tasks.set(id, {
    id,
    content,
    status: normalizeTaskStatus(input.status),
    ...(activeForm ? { activeForm } : {}),
  });
  return true;
}

export function applyTaskUpdate(input: Record<string, unknown>, tasks: Map<string, RuntimeTask>): boolean {
  if (typeof input.taskId !== 'string') return false;
  const existing = tasks.get(input.taskId);
  if (!existing) return false;
  const content = firstString(input.subject, input.description) ?? existing.content;
  const activeForm = typeof input.activeForm === 'string' ? input.activeForm : existing.activeForm;
  tasks.set(input.taskId, {
    ...existing,
    content,
    status: normalizeTaskStatus(input.status),
    ...(activeForm ? { activeForm } : {}),
  });
  return true;
}

export function emitCanonicalTaskSnapshot(
  toolUseId: unknown,
  name: unknown,
  input: unknown,
  registry: TaskRegistry,
  onEvent: EventSink,
): boolean {
  if (typeof toolUseId !== 'string' || typeof name !== 'string' || !isRecord(input)) return false;
  if (registry.seenToolUseIds.has(toolUseId)) return true;
  const applied = name === 'TaskCreate'
    ? applyTaskCreate(input, registry.tasks, registry.counter)
    : name === 'TaskUpdate' && applyTaskUpdate(input, registry.tasks);
  if (!applied) return false;
  // Coverage-driven refactor (2026-07-18, no behavior change): the
  // original OD source guarded this emission with
  // `if (!changed || runtimeTasks.size === 0) return false;`. Tracing
  // every path into this point shows both conditions are unreachable —
  // the `TaskCreate` and `TaskUpdate` branches above only fall through
  // to here after an unconditional `runtimeTasks.set(...)` (so `size`
  // can never be 0), and every early-return path above returns before
  // reaching here (so the "changed" flag those returns guarded was
  // always true here). Removed the dead double-guard per the coverage
  // skill's Phase 6.5 "dead branch" classification rather than fake a
  // test for an unreachable condition; see archived provenance ledger.
  registry.seenToolUseIds.add(toolUseId);
  onEvent({
    type: 'tool_use',
    id: `${toolUseId}:todo-task`,
    name: 'TodoWrite',
    input: {
      todos: Array.from(registry.tasks.values()).map(({ content, status, activeForm }) => ({
        content,
        status,
        ...(activeForm ? { activeForm } : {}),
      })),
    },
  });
  return true;
}

export function isFileWriteToolUse(name: unknown, input: unknown): boolean {
  if (typeof name !== 'string' || !isRecord(input)) return false;
  if (!WRITE_TOOL_NAMES.has(name)) return false;
  if (/\.(html|htm|css|js|jsx|ts|tsx|md)$/iu.test(toolInputPath(input))) return true;
  return typeof input.content === 'string' || typeof input.new_string === 'string';
}

// Coverage-driven refactor (2026-07-18, no behavior change): both
// `fileWriteContent` and `isHtmlWriteToolInput` originally opened with
// their own `if (!isRecord(input)) return ...;` guard. Each function
// has exactly one call site (`emitToolUse`, for both), and both call
// sites already sit inside an `if (isFileWriteToolUse(name, input))`
// block, which itself already asserted `isRecord(input)` before
// returning true. So `input` is always a record by the time either
// function runs — the guards duplicated a check the shared caller
// already made. Removed the runtime early-return per the coverage
// skill's Phase 6.5 "dead branch" classification rather than fake a
// test with a non-record `input` neither function can ever actually
// receive (see archived provenance ledger), replaced by a one-line type assertion
// (classification 4: TS-required, no real runtime path) so the
// parameter can stay `unknown` without disturbing the call sites.
export function fileWriteContent(input: unknown): string | null {
  const record = input as Record<string, unknown>;
  if (typeof record.content === 'string') return record.content;
  if (typeof record.new_string === 'string') return record.new_string;
  return null;
}

export function isHtmlWriteToolInput(input: unknown): boolean {
  const record = input as Record<string, unknown>;
  const rawPath = record.file_path ?? record.filePath;
  if (typeof rawPath === 'string' && /\.(?:html?|xhtml)$/i.test(rawPath)) return true;
  const content = fileWriteContent(input);
  return typeof content === 'string' && /<!doctype\s+html\b|<html\b/i.test(content);
}

export function artifactOpenCandidateLength(text: string, openTag: string): number {
  const max = Math.min(openTag.length - 1, text.length);
  for (let len = max; len > 0; len -= 1) {
    if (openTag.startsWith(text.slice(-len))) return len;
  }
  return 0;
}

function isHtmlArtifact(candidate: string): boolean {
  const openTag = candidate.slice(0, Math.max(0, candidate.indexOf('>') + 1));
  return /\btype\s*=\s*["']text\/html["']/i.test(openTag);
}

export function normalizeArtifactEchoContent(value: string): string {
  const normalized = value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  return trimEchoPadding(normalized);
}

/** Length of the padding token (whitespace, or a literal `\r`/`\n` escape) starting at `index`; 0 if none. */
function echoPaddingAt(text: string, index: number): number {
  if (/\s/.test(text.charAt(index))) return 1;
  return text.startsWith('\\r', index) || text.startsWith('\\n', index) ? 2 : 0;
}

/** Length of the padding token ending just before `end`; 0 if none. */
function echoPaddingBefore(text: string, end: number): number {
  if (end > 0 && /\s/.test(text.charAt(end - 1))) return 1;
  return end > 1 && echoPaddingAt(text, end - 2) === 2 ? 2 : 0;
}

/** Strips leading and trailing runs of whitespace and literal `\r`/`\n` escapes. Same result as
 *  `text.replace(/^(?:\s|\\r|\\n)+|(?:\s|\\r|\\n)+$/g, '')`, without its quadratic backtracking. */
function trimEchoPadding(text: string): string {
  let start = 0;
  for (let step = echoPaddingAt(text, start); step > 0; step = echoPaddingAt(text, start)) start += step;
  let end = text.length;
  for (let step = echoPaddingBefore(text, end); step > 0 && end - step >= start; step = echoPaddingBefore(text, end)) end -= step;
  return text.slice(start, end);
}

export function isRedundantWrittenArtifact(candidate: string, ctx: ArtifactEchoContext): boolean {
  const gt = candidate.indexOf('>');
  const close = candidate.lastIndexOf('</artifact>');
  if (gt === -1 || close === -1 || close <= gt) return false;
  if (ctx.suppressHtmlArtifactsAfterFileWrite && isHtmlArtifact(candidate) && ctx.wroteHtmlFileThisTurn) {
    return true;
  }
  const body = normalizeArtifactEchoContent(candidate.slice(gt + 1, close));
  return ctx.recentWriteContents.some((content) => content === body);
}

export function assistantText(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

export function isUnstreamedTextBlock(
  block: Record<string, unknown>,
  alreadyStreamed: boolean,
): block is Record<string, unknown> & { text: string } {
  return !alreadyStreamed && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0;
}

export function isUnstreamedThinkingBlock(
  block: Record<string, unknown>,
  alreadyStreamed: boolean,
): block is Record<string, unknown> & { thinking: string } {
  return (
    !alreadyStreamed && block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0
  );
}

/** One MCP server's state from an init frame's `mcp_servers`, e.g. `{ name: 'jini', status: 'failed' }`. */
export interface McpServerStatus {
  readonly name: string;
  readonly status: string;
}

/**
 * The init frame's `mcp_servers`, reduced to `{name, status}`, or `undefined` when the frame has no
 * such list. Kept on the event so a host can tell "its bridge did not connect" from "no bridge was
 * configured": Claude Code times a dead MCP server out, reports it `failed` here, and carries on
 * without its tools (the 2026-10-01 desktop incident). Entries without a string name and status are
 * dropped rather than guessed at.
 */
export function initMcpServers(obj: Record<string, unknown>): McpServerStatus[] | undefined {
  if (!Array.isArray(obj.mcp_servers)) return undefined;
  return obj.mcp_servers.flatMap((server) =>
    isRecord(server) && typeof server.name === 'string' && typeof server.status === 'string'
      ? [{ name: server.name, status: server.status }]
      : [],
  );
}

export function handleSystemMessage(obj: Record<string, unknown>, onEvent: EventSink): void {
  if (obj.subtype === 'init') {
    const mcpServers = initMcpServers(obj);
    onEvent({
      type: 'status',
      label: 'initializing',
      model: obj.model ?? null,
      sessionId: obj.session_id ?? null,
      ...(mcpServers !== undefined ? { mcpServers } : {}),
    });
    return;
  }
  if (obj.subtype === 'status') {
    onEvent({ type: 'status', label: typeof obj.status === 'string' ? obj.status : 'working' });
  }
}

export function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (isRecord(c) && c.type === 'text' ? String(c.text) : JSON.stringify(c)))
      .join('\n');
  }
  return JSON.stringify(content);
}

// `user` messages in a stream-json transcript are usually tool_result
// wrappers from prior turns.
export function handleUserMessage(obj: Record<string, unknown>, onEvent: EventSink): void {
  if (!isRecord(obj.message) || !Array.isArray(obj.message.content)) return;
  for (const block of obj.message.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'tool_result') {
      const delegated = readDelegatedResult({ content: block.content });
      onEvent({
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        // Keep original pixels until the daemon verifies the run, outcome and digest.
        content: stringifyToolResult(block.content),
        ...(delegated ? { delegatedToolUseId: delegated.marker.toolUseId, delegatedResultContent: delegated.content } : {}),
        isError: Boolean(block.is_error),
      });
    }
  }
}

export function applyInputJsonDelta(state: BlockState | undefined, partialJson: string, onEvent: EventSink): void {
  if (!state || state.type !== 'tool_use') return;
  state.input += partialJson;
  if (typeof state.id === 'string' && typeof state.name === 'string') {
    onEvent({
      type: 'tool_input_delta',
      id: state.id,
      name: state.name,
      delta: partialJson,
    });
  }
}

export function emitAssistantErrorIfPresent(obj: Record<string, unknown>, content: unknown[], onEvent: EventSink): void {
  if (typeof obj.error !== 'string' || !obj.error.trim()) return;
  onEvent({
    type: 'error',
    message: assistantText(content) || obj.error,
    code: obj.error,
  });
}
