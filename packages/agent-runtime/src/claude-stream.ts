/**
 * @module claude-stream
 *
 * Ported verbatim from OD's `apps/daemon/src/runtimes/stream/claude-stream.ts`
 * (only the `role-marker-guard` import path changed — it now resolves
 * within this package instead of two directories up). See `source-map.md`.
 *
 * Parses Claude Code's `--output-format stream-json --verbose` JSONL stream
 * (with or without `--include-partial-messages`) into a small set of
 * UI-friendly events. With partial messages on, text arrives as
 * `stream_event` deltas; without it (older builds <1.0.86, or any build
 * where the flag isn't passed) text arrives only in the final `assistant`
 * wrapper. We handle both. The UI only needs to know five things:
 *
 *   - status        : high-level lifecycle ("initializing", "requesting",
 *                     "thinking")
 *   - text_delta    : assistant text chunk (gets fed to the artifact parser)
 *   - thinking_delta: extended-thinking chunk (shown in a collapsed block)
 *   - tool_use      : { id, name, input }     (fires when input is complete)
 *   - tool_result   : { toolUseId, content, isError } (camelCase — this is our own emitted
 *                     event shape, not a passthrough of Claude's `tool_use_id`/`is_error` wire
 *                     field names; see the `user`-message handling below)
 *   - usage         : aggregated input/output/cache tokens + cost
 *
 * Callers give us `onEvent({ type, ...payload })`. We track per-content-block
 * state to accumulate partial tool_use input JSON and emit a single
 * `tool_use` event when that block stops.
 *
 * Module layout: functions above `createClaudeStreamHandler` are hoisted,
 * exported, unit-testable pure (or near-pure, dependency-injected) decision
 * logic — they take their inputs explicitly rather than reading them off a
 * closure. `createClaudeStreamHandler` itself, and everything declared
 * inside it, is the genuinely stateful part: per-message id/epoch
 * bookkeeping, the block-accumulation map, and the artifact-echo
 * dedup state machine all mutate several interdependent fields together
 * (see the inline comments on `anonymousMessageEpoch` and
 * `stripDuplicateArtifactText` for the specific invariants), so pulling
 * those out into standalone functions would mean designing an explicit
 * reducer over the whole stream state rather than extracting a helper —
 * a larger, riskier change than this pass makes. They stay as closures,
 * exercised only through `feed`/`flush` in the test suite.
 */

import { createRoleMarkerGuard, type RoleMarkerGuard, type RoleMarkerWarningEvent } from './role-marker-guard.js';

/**
 * Every event `createClaudeStreamHandler` can emit, discriminated on `type`. Exported (via
 * `index.ts`) precisely because it wasn't before: a consumer outside this package previously had
 * only `Record<string, unknown>` to go on, guessed a field name that doesn't exist
 * (`event.text` instead of the real `event.delta` on `text_delta`), and silently lost every
 * streamed token — no type error, no runtime error. Field types stay `unknown` wherever the
 * parser itself never validates that field's shape (e.g. `tool_use.input` is whatever Claude's
 * CLI sent, unchecked) — narrower than that would assert a guarantee this module doesn't actually
 * enforce.
 */
export type ClaudeStreamEvent =
  | { type: 'status'; label: string; model?: unknown; sessionId?: unknown; ttftMs?: number }
  | { type: 'text_delta' | 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'tool_use'; id: unknown; name: unknown; input: unknown }
  | { type: 'tool_input_delta'; id: string; name: string; delta: string }
  | { type: 'tool_result'; toolUseId: unknown; content: string; isError: boolean }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'usage'; usage: unknown; costUsd: unknown; durationMs: unknown; stopReason: string | null }
  | { type: 'error'; message: string; code: string }
  | { type: 'raw'; line: string }
  | RoleMarkerWarningEvent;

export type EventSink = (event: ClaudeStreamEvent) => void;
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

const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'write_file', 'replace']);

export function toolInputPath(input: Record<string, unknown>): string {
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  return '';
}

// Runtime-task status aliases the Claude Code wire format has used across
// versions, normalized to the four statuses the UI understands.
const TASK_STATUS_ALIASES: Record<string, RuntimeTask['status']> = {
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
  // loop; see source-map.md.
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
  const content = typeof input.subject === 'string'
    ? input.subject
    : typeof input.description === 'string'
      ? input.description
      : '';
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
  const content = typeof input.subject === 'string'
    ? input.subject
    : typeof input.description === 'string'
      ? input.description
      : existing.content;
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
    : name === 'TaskUpdate'
      ? applyTaskUpdate(input, registry.tasks)
      : false;
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
  // test for an unreachable condition; see source-map.md.
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
// receive (see source-map.md), replaced by a one-line type assertion
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

function normalizeArtifactEchoContent(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:\s|\\r|\\n)+|(?:\s|\\r|\\n)+$/g, '');
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

export function handleSystemMessage(obj: Record<string, unknown>, onEvent: EventSink): void {
  if (obj.subtype === 'init') {
    onEvent({
      type: 'status',
      label: 'initializing',
      model: obj.model ?? null,
      sessionId: obj.session_id ?? null,
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
      onEvent({
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content: stringifyToolResult(block.content),
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

interface ClaudeStreamHandlerOptions {
  suppressHtmlArtifactsAfterFileWrite?: boolean;
}

export function createClaudeStreamHandler(
  onEvent: EventSink,
  options: ClaudeStreamHandlerOptions = {},
) {
  let buffer = '';

  // Per-content-block scratch, keyed by `${messageId}:${blockIndex}`.
  const blocks = new Map<string, BlockState>();
  // Tool uses already emitted from streamed `input_json_delta` data.
  // Claude Code still repeats them in the final assistant wrapper, often with
  // empty `{}` inputs, so we suppress that duplicate emission.
  const streamedToolUseIds = new Set<string>();
  // Most recent assistant message id so content_block_* events without an id
  // can be attributed correctly.
  let currentMessageId: string | null = null;
  // Message ids that already streamed assistant text/thinking via
  // `stream_event` deltas.
  // When `--include-partial-messages` is OFF (older Claude Code, e.g. 1.0.84
  // pre-flag), no deltas arrive — only the final `assistant` wrapper carries
  // content. The fallback below emits that content once, but we must skip it for
  // newer builds that already streamed deltas, otherwise the message would
  // duplicate.
  const textStreamed = new Set<string>();
  const thinkingStreamed = new Set<string>();
  let currentMessageStreamedText = false;
  let currentMessageStreamedThinking = false;
  // Newer Claude Code builds put the terminal stop reason in the partial
  // stream's `message_delta`, while the accompanying top-level `assistant`
  // wrapper carries `stop_reason: null`. Older builds put it on the wrapper.
  // Remember the message id that already emitted `turn_end` so accepting
  // both wire shapes cannot double-trigger stdin continuation/closure.
  let turnEndSignature: string | null = null;
  // Stands in for `currentMessageId` in the dedup key when a frame carried no
  // message id at all. Without it the key is null and the guard below cannot
  // fire, so an id-less assistant wrapper plus the same-reason `result` frame
  // that follows it emit two identical `turn_end` events. It is bumped only at
  // `message_start` and at an id-less `assistant` wrapper — the two frames that
  // actually begin a new assistant message — and deliberately NOT at
  // `message_delta`/`result`, which report on the message already in flight.
  // Bumping it on a real message boundary is what keeps this from over-deduping:
  // two consecutive id-less `tool_use` turns still emit twice, and a suppressed
  // `tool_use` turn_end would strand the daemon's stdin-close handler.
  let anonymousMessageEpoch = 0;
  // Per-message role-marker guards for cross-chunk detection (#3247).
  const roleGuards = new Map<string, RoleMarkerGuard>();
  const taskRegistry: TaskRegistry = {
    tasks: new Map<string, RuntimeTask>(),
    counter: { next: 1 },
    seenToolUseIds: new Set<string>(),
  };
  let suppressNextArtifactText = false;
  let suppressDuplicateArtifactText = false;
  let artifactOpenCandidate = '';
  let pendingArtifactText = '';
  let duplicateArtifactCandidate = '';
  const recentWriteContents: string[] = [];
  let wroteHtmlFileThisTurn = false;

  function emitTurnEnd(stopReason: string): void {
    // `\u0001` prefixes the synthetic key so it can never collide with a real
    // message id, which is why this is safe to compare in the same slot.
    const messageKey = currentMessageId ?? `\u0001anon${anonymousMessageEpoch}`;
    const signature = `${messageKey}\u0000${stopReason}`;
    if (turnEndSignature === signature) return;
    onEvent({ type: 'turn_end', stopReason });
    turnEndSignature = signature;
    if (stopReason !== 'tool_use') {
      recentWriteContents.length = 0;
      wroteHtmlFileThisTurn = false;
    }
  }

  function emitToolUse(id: unknown, name: unknown, input: unknown): void {
    if (emitCanonicalTaskSnapshot(id, name, input, taskRegistry, onEvent)) return;
    if (isFileWriteToolUse(name, input)) {
      suppressNextArtifactText = true;
      const content = fileWriteContent(input);
      if (content) {
        wroteHtmlFileThisTurn = wroteHtmlFileThisTurn || isHtmlWriteToolInput(input);
        recentWriteContents.push(normalizeArtifactEchoContent(content));
        if (recentWriteContents.length > 5) recentWriteContents.shift();
      }
    }
    onEvent({
      type: 'tool_use',
      id,
      name,
      input,
    });
  }

  function blockKey(index: unknown): string {
    return `${currentMessageId ?? 'anon'}:${index}`;
  }

  // Per-message role-marker guard (#3247). Covers text_delta ONLY.
  //
  // Why not thinking_delta: extended thinking is rendered to a
  // separate `kind: 'thinking'` payload and is never folded into
  // `m.content` by `buildDaemonTranscript` (apps/web/src/providers/daemon.ts),
  // so it cannot be re-serialized as a turn boundary on the next
  // round-trip — it is not a #3247 re-injection vector. Models
  // routinely emit literal `## user` / `## assistant` lines in
  // chain-of-thought when reasoning about conversation structure,
  // and with kill-on-detection wired in server.ts a guard on the
  // thinking channel would abort otherwise-legitimate runs without
  // any compensating security benefit. See PR #3303 review
  // r3324xxxxxx. Thinking is passed through unguarded; only the
  // user-visible text channel is policed.
  function getOrCreateRoleGuard(msgId: string): RoleMarkerGuard {
    let guard = roleGuards.get(msgId);
    if (!guard) {
      guard = createRoleMarkerGuard(msgId);
      roleGuards.set(msgId, guard);
    }
    return guard;
  }

  function emitSafeText(msgId: string | null, text: string, eventType: 'text_delta' | 'thinking_delta' = 'text_delta') {
    if (eventType === 'text_delta') {
      text = stripDuplicateArtifactText(text);
      if (!text) return;
    }
    if (eventType !== 'text_delta' || !msgId) {
      onEvent({ type: eventType, delta: text });
      return;
    }
    const guard = getOrCreateRoleGuard(msgId);
    if (guard.contaminated) return;

    const safe = guard.feedText(text);
    if (safe.length > 0) {
      onEvent({ type: eventType, delta: safe });
    }
    if (guard.contaminated) {
      const warn = guard.warningEvent();
      if (warn) onEvent(warn);
    }
  }

  // Resolves an in-progress `<artifact>...</artifact>` echo once its close
  // tag has arrived: drops it if it duplicates a recent file write, then
  // resumes stripping on whatever text followed the close tag.
  function resolveDuplicateArtifactCandidate(current: string): string {
    duplicateArtifactCandidate += current;
    const closeIndex = duplicateArtifactCandidate.indexOf('</artifact>');
    if (closeIndex === -1) return '';
    const closeEnd = closeIndex + '</artifact>'.length;
    const candidate = duplicateArtifactCandidate.slice(0, closeEnd);
    const rest = duplicateArtifactCandidate.slice(closeEnd);
    duplicateArtifactCandidate = '';
    suppressDuplicateArtifactText = false;
    suppressNextArtifactText = false;
    const duplicate = isRedundantWrittenArtifact(candidate, {
      suppressHtmlArtifactsAfterFileWrite: options.suppressHtmlArtifactsAfterFileWrite === true,
      wroteHtmlFileThisTurn,
      recentWriteContents,
    });
    if (options.suppressHtmlArtifactsAfterFileWrite !== true) {
      recentWriteContents.length = 0;
    }
    return `${duplicate ? '' : candidate}${stripDuplicateArtifactText(rest)}`;
  }

  // No open `<artifact` tag has been seen yet: either buffer a partial tag
  // prefix at the end of `current` so it can match across chunk boundaries,
  // or pass the text through untouched.
  function bufferPartialArtifactOpenTag(current: string, openTag: string): string {
    const candidateLength = artifactOpenCandidateLength(current, openTag);
    if ((suppressNextArtifactText || recentWriteContents.length > 0) && candidateLength > 0) {
      artifactOpenCandidate = current.slice(-candidateLength);
      return current.slice(0, -candidateLength);
    }
    return current;
  }

  // An `<artifact` open tag just arrived: start accumulating it as a
  // duplicate-write candidate and flush whatever text preceded it.
  function startDuplicateArtifactCandidate(current: string, openIndex: number): string {
    suppressDuplicateArtifactText = true;
    suppressNextArtifactText = false;
    duplicateArtifactCandidate = current.slice(openIndex);
    const prefix = `${pendingArtifactText}${current.slice(0, openIndex)}`;
    pendingArtifactText = '';
    return `${prefix}${stripDuplicateArtifactText('')}`;
  }

  function stripDuplicateArtifactText(text: string): string {
    if (
      !suppressNextArtifactText &&
      !suppressDuplicateArtifactText &&
      artifactOpenCandidate.length === 0 &&
      recentWriteContents.length === 0
    ) {
      return text;
    }
    const openTag = '<artifact';
    const current = `${artifactOpenCandidate}${text}`;
    artifactOpenCandidate = '';
    if (suppressDuplicateArtifactText) {
      return resolveDuplicateArtifactCandidate(current);
    }
    const openIndex = current.indexOf(openTag);
    if (openIndex === -1) {
      return bufferPartialArtifactOpenTag(current, openTag);
    }
    return startDuplicateArtifactCandidate(current, openIndex);
  }

  function feed(chunk: string) {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        onEvent({ type: 'raw', line });
        continue;
      }
      handleObject(obj);
    }
  }

  function flush() {
    const rem = buffer.trim();
    buffer = '';
    if (rem) {
      try {
        handleObject(JSON.parse(rem));
      } catch {
        onEvent({ type: 'raw', line: rem });
      }
    }
    flushPendingArtifactText();
  }

  function handleToolUseBlock(block: Record<string, unknown>): void {
    if (typeof block.id === 'string' && streamedToolUseIds.has(block.id)) return;
    emitToolUse(block.id, block.name, block.input ?? null);
  }

  function handleAssistantContentBlock(
    block: unknown,
    ctx: {
      textMsgId: string | null;
      thinkingMsgId: string | null;
      textAlreadyStreamed: boolean;
      thinkingAlreadyStreamed: boolean;
    },
  ): void {
    if (!isRecord(block)) return;
    if (block.type === 'tool_use') {
      handleToolUseBlock(block);
      return;
    }
    if (isUnstreamedTextBlock(block, ctx.textAlreadyStreamed)) {
      emitSafeText(ctx.textMsgId, block.text);
      return;
    }
    if (isUnstreamedThinkingBlock(block, ctx.thinkingAlreadyStreamed)) {
      emitSafeText(ctx.thinkingMsgId, block.thinking, 'thinking_delta');
    }
  }

  // Resolves the message id assistant text/thinking blocks should be
  // attributed to (an explicit id on the wrapper, or the currently-tracked
  // streaming id), and whether that channel already streamed via deltas.
  // Also owns the message-id/epoch bookkeeping side effects that must
  // happen exactly once per assistant wrapper.
  function resolveAssistantMessageIds(message: Record<string, unknown>): {
    textMsgId: string | null;
    thinkingMsgId: string | null;
    textAlreadyStreamed: boolean;
    thinkingAlreadyStreamed: boolean;
  } {
    const explicitMsgId = typeof message.id === 'string' ? message.id : null;
    const textMsgId = explicitMsgId ?? (currentMessageStreamedText ? currentMessageId : null);
    const thinkingMsgId = explicitMsgId ?? (currentMessageStreamedThinking ? currentMessageId : null);
    if (explicitMsgId) currentMessageId = explicitMsgId;
    // An id-less assistant wrapper is itself a new message boundary: no
    // `message_start` announced it, so this is the only place the epoch can
    // advance before its own `turn_end` is emitted below. See
    // `anonymousMessageEpoch`'s declaration for why message_delta/result must
    // NOT advance it.
    if (currentMessageId === null) anonymousMessageEpoch += 1;
    return {
      textMsgId,
      thinkingMsgId,
      textAlreadyStreamed: textMsgId ? textStreamed.has(textMsgId) : false,
      thinkingAlreadyStreamed: thinkingMsgId ? thinkingStreamed.has(thinkingMsgId) : false,
    };
  }

  // `assistant` messages are the "block finished" signal for the current
  // content block. For tool_use blocks whose input finished assembling,
  // emit tool_use now with the final parsed input. For text blocks, emit
  // the text as a single delta — but only if no streaming deltas already
  // covered it (older Claude Code without --include-partial-messages
  // delivers text only here; newer builds stream it and would duplicate).
  function handleAssistantMessage(obj: Record<string, unknown>): void {
    const message = obj.message;
    if (!isRecord(message) || !Array.isArray(message.content)) return;
    const { textMsgId, thinkingMsgId, textAlreadyStreamed, thinkingAlreadyStreamed } =
      resolveAssistantMessageIds(message);
    // Per-turn `stop_reason` is emitted as `turn_end` AFTER the content
    // blocks have been processed (see below). When `--include-partial-
    // messages` is unsupported, tool_use events surface only from the
    // assistant wrapper here — emitting `turn_end` before that loop would
    // let the daemon's stdin-close handler act on the turn before its
    // tool_use blocks were seen, closing stdin mid-tool. Read the
    // stop_reason now, emit after.
    const stopReason = typeof message.stop_reason === 'string' ? message.stop_reason : null;

    for (const block of message.content) {
      handleAssistantContentBlock(block, { textMsgId, thinkingMsgId, textAlreadyStreamed, thinkingAlreadyStreamed });
    }

    // Surface the turn_end signal now that every tool_use in this
    // assistant message has been emitted, so the daemon's stdin-close
    // handler sees the final `stop_reason` before deciding whether to
    // close stream-json input stdin.
    if (stopReason) {
      emitTurnEnd(stopReason);
    }
    emitAssistantErrorIfPresent(obj, message.content, onEvent);
    currentMessageStreamedText = false;
    currentMessageStreamedThinking = false;
  }

  function handleResultMessage(obj: Record<string, unknown>): void {
    // Explicit annotation: the `&&`/`||` chain's inferred type includes a phantom `false` (TS
    // widens each unresolved `&&` branch to its check's boolean), even though no runtime path
    // through this chain can ever produce the literal `false` — the last `|| null` guarantees a
    // string or null. Pinning the declared type to what's actually true, not casting past it.
    const stopReason: string | null =
      (typeof obj.stop_reason === 'string' && obj.stop_reason) ||
      (typeof obj.terminal_reason === 'string' && obj.terminal_reason) ||
      null;
    // Claude Code 2.1.201 does not always emit a terminal
    // stream_event/message_delta. In that wire shape, the top-level result
    // is the only frame carrying `end_turn`. Surface it as a turn boundary
    // so AgentExecutor can close stream-json stdin and reap the process.
    if (stopReason) {
      emitTurnEnd(stopReason);
    }
    onEvent({
      type: 'usage',
      usage: obj.usage ?? null,
      costUsd: obj.total_cost_usd ?? null,
      durationMs: obj.duration_ms ?? null,
      stopReason,
    });
  }

  function handleObject(obj: unknown) {
    if (!isRecord(obj)) return;
    switch (obj.type) {
      case 'system':
        handleSystemMessage(obj, onEvent);
        return;
      case 'stream_event':
        if (isRecord(obj.event)) handleStreamEvent(obj.event);
        return;
      case 'assistant':
        handleAssistantMessage(obj);
        return;
      case 'user':
        handleUserMessage(obj, onEvent);
        return;
      case 'result':
        handleResultMessage(obj);
        return;
    }
  }

  function handleMessageStart(ev: Record<string, unknown>): void {
    flushPendingArtifactText();
    // Clean up per-message role-marker guard from the previous message.
    if (currentMessageId) roleGuards.delete(currentMessageId);
    currentMessageId = isRecord(ev.message) && typeof ev.message.id === 'string' ? ev.message.id : null;
    // New message boundary — see `anonymousMessageEpoch`'s declaration.
    if (currentMessageId === null) anonymousMessageEpoch += 1;
    currentMessageStreamedText = false;
    currentMessageStreamedThinking = false;
    if (typeof ev.ttft_ms === 'number') {
      onEvent({ type: 'status', label: 'streaming', ttftMs: ev.ttft_ms });
    }
  }

  function handleContentBlockStart(index: unknown, block: Record<string, unknown>): void {
    const key = blockKey(index);
    blocks.set(key, {
      type: block.type,
      name: block.name,
      id: block.id,
      input: '',
      inputValue: 'input' in block ? block.input : undefined,
    });
    if (block.type === 'thinking') {
      onEvent({ type: 'thinking_start' });
    }
  }

  function handleContentBlockDelta(index: unknown, delta: Record<string, unknown>): void {
    const state = blocks.get(blockKey(index));

    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      if (currentMessageId) textStreamed.add(currentMessageId);
      currentMessageStreamedText = true;
      emitSafeText(currentMessageId, delta.text);
      return;
    }
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      if (currentMessageId) thinkingStreamed.add(currentMessageId);
      currentMessageStreamedThinking = true;
      emitSafeText(currentMessageId, delta.thinking, 'thinking_delta');
      return;
    }
    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      applyInputJsonDelta(state, delta.partial_json, onEvent);
    }
  }

  function handleContentBlockStop(ev: Record<string, unknown>): void {
    const key = blockKey(ev.index);
    const state = blocks.get(key);
    if (state && state.type === 'tool_use' && typeof state.id === 'string' && state.input.trim()) {
      try {
        emitToolUse(state.id, state.name, JSON.parse(state.input));
        streamedToolUseIds.add(state.id);
      } catch {
        // Fall through to the final assistant wrapper's input if the
        // streamed JSON is malformed or incomplete.
      }
    } else if (
      state &&
      state.type === 'tool_use' &&
      typeof state.id === 'string' &&
      state.inputValue !== undefined
    ) {
      emitToolUse(state.id, state.name, state.inputValue);
      streamedToolUseIds.add(state.id);
    }
    blocks.delete(key);
  }

  function handleMessageDeltaEvent(delta: Record<string, unknown>): void {
    const stopReason = typeof delta.stop_reason === 'string' ? delta.stop_reason : null;
    if (stopReason) emitTurnEnd(stopReason);
  }

  function handleStreamEvent(ev: Record<string, unknown>) {
    switch (ev.type) {
      case 'message_start':
        handleMessageStart(ev);
        return;
      case 'content_block_start':
        if (isRecord(ev.content_block)) handleContentBlockStart(ev.index, ev.content_block);
        return;
      case 'content_block_delta':
        if (isRecord(ev.delta)) handleContentBlockDelta(ev.index, ev.delta);
        return;
      case 'content_block_stop':
        handleContentBlockStop(ev);
        return;
      case 'message_delta':
        if (isRecord(ev.delta)) handleMessageDeltaEvent(ev.delta);
        return;
    }
  }

  function flushPendingArtifactText() {
    const text = `${pendingArtifactText}${artifactOpenCandidate}${duplicateArtifactCandidate}`;
    if (!text) return;
    pendingArtifactText = '';
    artifactOpenCandidate = '';
    duplicateArtifactCandidate = '';
    suppressNextArtifactText = false;
    suppressDuplicateArtifactText = false;
    recentWriteContents.length = 0;
    wroteHtmlFileThisTurn = false;
    emitSafeText(currentMessageId, text);
  }

  return { feed, flush };
}
