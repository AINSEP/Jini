/** @module claude-stream-handler
 * Stateful Claude stream-json handler behind `createClaudeStreamHandler`.
 * One `StreamCtx` carries the per-stream scratch state (message ids, streamed
 * channels, artifact-echo suppression, role-marker guards) and every handler is
 * a small function over it. The pure frame helpers live in `./claude-stream-frames.js`.
 */
import { createBoundedLineStream } from './core/bounded-line-stream.js';
import { createRoleMarkerGuard, type RoleMarkerGuard } from './role-marker-guard.js';
import { createClaudeSegmentUsage } from './claude-segment-usage.js';
import {
  applyInputJsonDelta,
  artifactOpenCandidateLength,
  emitAssistantErrorIfPresent,
  emitCanonicalTaskSnapshot,
  fileWriteContent,
  handleSystemMessage,
  handleUserMessage,
  isFileWriteToolUse,
  isHtmlWriteToolInput,
  isRedundantWrittenArtifact,
  isUnstreamedTextBlock,
  isUnstreamedThinkingBlock,
  normalizeArtifactEchoContent,
  type BlockState,
  type EventSink,
  type RuntimeTask,
  type TaskRegistry,
} from './claude-stream-frames.js';

export interface ClaudeStreamHandlerOptions {
  suppressHtmlArtifactsAfterFileWrite?: boolean;
  /** Clock used only when an interrupted segment omits its duration. */
  nowMs?: () => number;
  /** Claude's results span a session; compatible CLIs can retain per-run cost semantics. */
  costBasis?: 'session' | 'run';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mutable per-stream scratch shared by the handler functions below. */
interface StreamCtx {
  onEvent: EventSink;
  options: ClaudeStreamHandlerOptions;
  lines: ReturnType<typeof createBoundedLineStream>;
  segmentUsage: ReturnType<typeof createClaudeSegmentUsage>;
  // Per-content-block scratch, keyed by `${messageId}:${blockIndex}`.
  blocks: Map<string, BlockState>;
  // Tool uses already emitted from streamed `input_json_delta` data OR full wrappers.
  // Claude Code still repeats them in the final assistant wrapper, often with
  // empty `{}` inputs, so we suppress that duplicate emission.
  streamedToolUseIds: Set<string>;
  // Most recent assistant message id so content_block_* events without an id
  // can be attributed correctly.
  currentMessageId: string | null;
  // Message ids that already streamed assistant text/thinking via
  // `stream_event` deltas.
  // When `--include-partial-messages` is OFF (older Claude Code, e.g. 1.0.84
  // pre-flag), no deltas arrive — only the final `assistant` wrapper carries
  // content. The fallback below emits that content once, but we must skip it for
  // newer builds that already streamed deltas, otherwise the message would
  // duplicate.
  textStreamed: Set<string>;
  thinkingStreamed: Set<string>;
  currentMessageStreamedText: boolean;
  currentMessageStreamedThinking: boolean;
  // Newer Claude Code builds put the terminal stop reason in the partial
  // stream's `message_delta`, while the accompanying top-level `assistant`
  // wrapper carries `stop_reason: null`. Older builds put it on the wrapper.
  // Remember the message id that already emitted `turn_end` so accepting
  // both wire shapes cannot double-trigger stdin continuation/closure.
  turnEndSignature: string | null;
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
  anonymousMessageEpoch: number;
  // Per-message role-marker guards for cross-chunk detection (#3247).
  roleGuards: Map<string, RoleMarkerGuard>;
  taskRegistry: TaskRegistry;
  suppressNextArtifactText: boolean;
  suppressDuplicateArtifactText: boolean;
  artifactOpenCandidate: string;
  pendingArtifactText: string;
  duplicateArtifactCandidate: string;
  recentWriteContents: string[];
  wroteHtmlFileThisTurn: boolean;
}

function createStreamCtx(onEvent: EventSink, options: ClaudeStreamHandlerOptions): StreamCtx {
  const s: StreamCtx = {
    onEvent,
    options,
    lines: createBoundedLineStream({
      onLine: line => { const trimmed = line.trim(); if (trimmed) feedLine(s, trimmed); },
      onOverflow: error => onEvent({ type: 'error', message: error.message, code: 'STREAM_LINE_TOO_LARGE' }),
    }),
    segmentUsage: createClaudeSegmentUsage({}, {
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
      ...(options.costBasis === undefined ? {} : { costBasis: options.costBasis }),
    }),
    blocks: new Map<string, BlockState>(),
    streamedToolUseIds: new Set<string>(),
    currentMessageId: null,
    textStreamed: new Set<string>(),
    thinkingStreamed: new Set<string>(),
    currentMessageStreamedText: false,
    currentMessageStreamedThinking: false,
    turnEndSignature: null,
    anonymousMessageEpoch: 0,
    roleGuards: new Map<string, RoleMarkerGuard>(),
    taskRegistry: {
      tasks: new Map<string, RuntimeTask>(),
      counter: { next: 1 },
      seenToolUseIds: new Set<string>(),
    },
    suppressNextArtifactText: false,
    suppressDuplicateArtifactText: false,
    artifactOpenCandidate: '',
    pendingArtifactText: '',
    duplicateArtifactCandidate: '',
    recentWriteContents: [],
    wroteHtmlFileThisTurn: false,
  };
  return s;
}

/** Builds the `{ feed, flush }` handler `createClaudeStreamHandler` returns. */
export function createStreamHandlerImpl(onEvent: EventSink, options: ClaudeStreamHandlerOptions) {
  const s = createStreamCtx(onEvent, options);
  return {
    feed: ({ chunk }: { chunk: string }) => feed(s, { chunk }),
    flush: () => flush(s),
  };
}

function emitTurnEnd(s: StreamCtx, stopReason: string): void {
  // `\u0001` prefixes the synthetic key so it can never collide with a real
  // message id, which is why this is safe to compare in the same slot.
  const messageKey = s.currentMessageId ?? `\u0001anon${s.anonymousMessageEpoch}`;
  const signature = `${messageKey}\u0000${stopReason}`;
  if (s.turnEndSignature === signature) return;
  s.onEvent({ type: 'turn_end', stopReason });
  s.turnEndSignature = signature;
  if (stopReason !== 'tool_use') {
    s.recentWriteContents.length = 0;
    s.wroteHtmlFileThisTurn = false;
  }
}

function emitToolUse(s: StreamCtx, id: unknown, name: unknown, input: unknown): void {
  if (typeof id === 'string') {
    if (s.streamedToolUseIds.has(id)) return;
    s.streamedToolUseIds.add(id);
  }
  if (emitCanonicalTaskSnapshot(id, name, input, s.taskRegistry, s.onEvent)) return;
  if (isFileWriteToolUse(name, input)) {
    s.suppressNextArtifactText = true;
    const content = fileWriteContent(input);
    if (content) {
      s.wroteHtmlFileThisTurn = s.wroteHtmlFileThisTurn || isHtmlWriteToolInput(input);
      s.recentWriteContents.push(normalizeArtifactEchoContent(content));
      if (s.recentWriteContents.length > 5) s.recentWriteContents.shift();
    }
  }
  s.onEvent({
    type: 'tool_use',
    id,
    name,
    input,
  });
}

function blockKey(s: StreamCtx, index: unknown): string {
  return `${s.currentMessageId ?? 'anon'}:${index}`;
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
function getOrCreateRoleGuard(s: StreamCtx, msgId: string): RoleMarkerGuard {
  let guard = s.roleGuards.get(msgId);
  if (!guard) {
    guard = createRoleMarkerGuard({ messageId: msgId });
    s.roleGuards.set(msgId, guard);
  }
  return guard;
}

function emitSafeText(s: StreamCtx, msgId: string | null, text: string, eventType: 'text_delta' | 'thinking_delta' = 'text_delta') {
  if (eventType === 'text_delta') {
    text = stripDuplicateArtifactText(s, text);
    if (!text) return;
  }
  if (eventType !== 'text_delta' || !msgId) {
    s.onEvent({ type: eventType, delta: text });
    return;
  }
  const guard = getOrCreateRoleGuard(s, msgId);
  if (guard.contaminated) return;

  const safe = guard.feedText({ text: text });
  if (safe.length > 0) {
    s.onEvent({ type: eventType, delta: safe });
  }
  if (guard.contaminated) {
    const warn = guard.warningEvent();
    if (warn) s.onEvent(warn);
  }
}

// Resolves an in-progress `<artifact>...</artifact>` echo once its close
// tag has arrived: drops it if it duplicates a recent file write, then
// resumes stripping on whatever text followed the close tag.
function resolveDuplicateArtifactCandidate(s: StreamCtx, current: string): string {
  s.duplicateArtifactCandidate += current;
  const closeIndex = s.duplicateArtifactCandidate.indexOf('</artifact>');
  if (closeIndex === -1) return '';
  const closeEnd = closeIndex + '</artifact>'.length;
  const candidate = s.duplicateArtifactCandidate.slice(0, closeEnd);
  const rest = s.duplicateArtifactCandidate.slice(closeEnd);
  s.duplicateArtifactCandidate = '';
  s.suppressDuplicateArtifactText = false;
  s.suppressNextArtifactText = false;
  const duplicate = isRedundantWrittenArtifact(candidate, {
    suppressHtmlArtifactsAfterFileWrite: s.options.suppressHtmlArtifactsAfterFileWrite === true,
    wroteHtmlFileThisTurn: s.wroteHtmlFileThisTurn,
    recentWriteContents: s.recentWriteContents,
  });
  if (s.options.suppressHtmlArtifactsAfterFileWrite !== true) {
    s.recentWriteContents.length = 0;
  }
  return `${duplicate ? '' : candidate}${stripDuplicateArtifactText(s, rest)}`;
}

// No open `<artifact` tag has been seen yet: either buffer a partial tag
// prefix at the end of `current` so it can match across chunk boundaries,
// or pass the text through untouched.
function bufferPartialArtifactOpenTag(s: StreamCtx, current: string, openTag: string): string {
  const candidateLength = artifactOpenCandidateLength(current, openTag);
  if ((s.suppressNextArtifactText || s.recentWriteContents.length > 0) && candidateLength > 0) {
    s.artifactOpenCandidate = current.slice(-candidateLength);
    return current.slice(0, -candidateLength);
  }
  return current;
}

// An `<artifact` open tag just arrived: start accumulating it as a
// duplicate-write candidate and flush whatever text preceded it.
function startDuplicateArtifactCandidate(s: StreamCtx, current: string, openIndex: number): string {
  s.suppressDuplicateArtifactText = true;
  s.suppressNextArtifactText = false;
  s.duplicateArtifactCandidate = current.slice(openIndex);
  const prefix = `${s.pendingArtifactText}${current.slice(0, openIndex)}`;
  s.pendingArtifactText = '';
  return `${prefix}${stripDuplicateArtifactText(s, '')}`;
}

function stripDuplicateArtifactText(s: StreamCtx, text: string): string {
  if (
    !s.suppressNextArtifactText &&
    !s.suppressDuplicateArtifactText &&
    s.artifactOpenCandidate.length === 0 &&
    s.recentWriteContents.length === 0
  ) {
    return text;
  }
  const openTag = '<artifact';
  const current = `${s.artifactOpenCandidate}${text}`;
  s.artifactOpenCandidate = '';
  if (s.suppressDuplicateArtifactText) {
    return resolveDuplicateArtifactCandidate(s, current);
  }
  const openIndex = current.indexOf(openTag);
  if (openIndex === -1) {
    return bufferPartialArtifactOpenTag(s, current, openTag);
  }
  return startDuplicateArtifactCandidate(s, current, openIndex);
}

function feed(s: StreamCtx, { chunk }: { chunk: string }) {
  s.lines.feed({ chunk: chunk });
}

/** One complete, non-blank line: a JSON object is handled, anything else passes through raw. */
function feedLine(s: StreamCtx, line: string) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    s.onEvent({ type: 'raw', line });
    return;
  }
  handleObject(s, obj);
}

function flush(s: StreamCtx) {
  s.lines.flush();
  flushPendingArtifactText(s);
  // A hard cancel has no result frame. Flush only counters actually observed, once.
  if (s.segmentUsage.hasObserved()) s.onEvent({ type: 'usage', ...s.segmentUsage.finish({ result: {}, interrupted: true }), stopReason: null });
}

function handleToolUseBlock(s: StreamCtx, block: Record<string, unknown>): void {
  if (typeof block.id === 'string' && s.streamedToolUseIds.has(block.id)) return;
  emitToolUse(s, block.id, block.name, block.input ?? null);
}

function handleAssistantContentBlock(s: StreamCtx, 
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
    handleToolUseBlock(s, block);
    return;
  }
  if (isUnstreamedTextBlock(block, ctx.textAlreadyStreamed)) {
    emitSafeText(s, ctx.textMsgId, block.text);
    return;
  }
  if (isUnstreamedThinkingBlock(block, ctx.thinkingAlreadyStreamed)) {
    emitSafeText(s, ctx.thinkingMsgId, block.thinking, 'thinking_delta');
  }
}

// Resolves the message id assistant text/thinking blocks should be
// attributed to (an explicit id on the wrapper, or the currently-tracked
// streaming id), and whether that channel already streamed via deltas.
// Also owns the message-id/epoch bookkeeping side effects that must
// happen exactly once per assistant wrapper.
function resolveAssistantMessageIds(s: StreamCtx, message: Record<string, unknown>): {
  textMsgId: string | null;
  thinkingMsgId: string | null;
  textAlreadyStreamed: boolean;
  thinkingAlreadyStreamed: boolean;
} {
  const explicitMsgId = typeof message.id === 'string' ? message.id : null;
  const textMsgId = explicitMsgId ?? (s.currentMessageStreamedText ? s.currentMessageId : null);
  const thinkingMsgId = explicitMsgId ?? (s.currentMessageStreamedThinking ? s.currentMessageId : null);
  if (explicitMsgId) s.currentMessageId = explicitMsgId;
  // An id-less assistant wrapper is itself a new message boundary: no
  // `message_start` announced it, so this is the only place the epoch can
  // advance before its own `turn_end` is emitted below. See
  // `anonymousMessageEpoch`'s declaration for why message_delta/result must
  // NOT advance it.
  if (s.currentMessageId === null) s.anonymousMessageEpoch += 1;
  return {
    textMsgId,
    thinkingMsgId,
    textAlreadyStreamed: textMsgId ? s.textStreamed.has(textMsgId) : false,
    thinkingAlreadyStreamed: thinkingMsgId ? s.thinkingStreamed.has(thinkingMsgId) : false,
  };
}

// `assistant` messages are the "block finished" signal for the current
// content block. For tool_use blocks whose input finished assembling,
// emit tool_use now with the final parsed input. For text blocks, emit
// the text as a single delta — but only if no streaming deltas already
// covered it (older Claude Code without --include-partial-messages
// delivers text only here; newer builds stream it and would duplicate).
function handleAssistantMessage(s: StreamCtx, obj: Record<string, unknown>): void {
  const message = obj.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return;
  if (typeof message.model === 'string') s.onEvent({ type: 'status', label: 'model', model: message.model });
  const { textMsgId, thinkingMsgId, textAlreadyStreamed, thinkingAlreadyStreamed } =
    resolveAssistantMessageIds(s, message);
  s.segmentUsage.observe({ messageId: usageMessageKey(s), usage: message.usage });
  // Per-turn `stop_reason` is emitted as `turn_end` AFTER the content
  // blocks have been processed (see below). When `--include-partial-
  // messages` is unsupported, tool_use events surface only from the
  // assistant wrapper here — emitting `turn_end` before that loop would
  // let the daemon's stdin-close handler act on the turn before its
  // tool_use blocks were seen, closing stdin mid-tool. Read the
  // stop_reason now, emit after.
  const stopReason = typeof message.stop_reason === 'string' ? message.stop_reason : null;

  for (const block of message.content) {
    handleAssistantContentBlock(s, block, { textMsgId, thinkingMsgId, textAlreadyStreamed, thinkingAlreadyStreamed });
  }

  // Surface the turn_end signal now that every tool_use in this
  // assistant message has been emitted, so the daemon's stdin-close
  // handler sees the final `stop_reason` before deciding whether to
  // close stream-json input stdin.
  if (stopReason) {
    emitTurnEnd(s, stopReason);
  }
  emitAssistantErrorIfPresent(obj, message.content, s.onEvent);
  s.currentMessageStreamedText = false;
  s.currentMessageStreamedThinking = false;
}

function handleResultMessage(s: StreamCtx, obj: Record<string, unknown>): void {
  // The first non-empty string of `stop_reason`, then `terminal_reason`; otherwise null.
  const stopReason: string | null =
    [obj.stop_reason, obj.terminal_reason].find((reason): reason is string => typeof reason === 'string' && reason !== '') ?? null;
  // Claude Code 2.1.201 does not always emit a terminal
  // stream_event/message_delta. In that wire shape, the top-level result
  // is the only frame carrying `end_turn`. Surface it as a turn boundary
  // so AgentExecutor can close stream-json stdin and reap the process.
  if (stopReason) {
    emitTurnEnd(s, stopReason);
  }
  s.onEvent({
    type: 'usage',
    ...s.segmentUsage.finish({ result: obj, interrupted: stopReason?.startsWith('aborted') === true }),
    stopReason,
  });
}

function handleObject(s: StreamCtx, obj: unknown) {
  if (!isRecord(obj)) return;
  s.segmentUsage.setSession({ id: obj.session_id });
  switch (obj.type) {
    case 'system':
      handleSystemMessage(obj, s.onEvent);
      return;
    case 'stream_event':
      if (isRecord(obj.event)) handleStreamEvent(s, obj.event);
      return;
    case 'assistant':
      handleAssistantMessage(s, obj);
      return;
    case 'user':
      handleUserMessage(obj, s.onEvent);
      return;
    case 'result':
      handleResultMessage(s, obj);
      return;
  }
}

function handleMessageStart(s: StreamCtx, ev: Record<string, unknown>): void {
  if (isRecord(ev.message) && typeof ev.message.model === 'string') s.onEvent({ type: 'status', label: 'model', model: ev.message.model });
  flushPendingArtifactText(s);
  // Clean up per-message role-marker guard from the previous message.
  if (s.currentMessageId) s.roleGuards.delete(s.currentMessageId);
  s.currentMessageId = isRecord(ev.message) && typeof ev.message.id === 'string' ? ev.message.id : null;
  // New message boundary — see `anonymousMessageEpoch`'s declaration.
  if (s.currentMessageId === null) s.anonymousMessageEpoch += 1;
  s.segmentUsage.observe({ messageId: usageMessageKey(s), usage: isRecord(ev.message) ? ev.message.usage : undefined });
  s.currentMessageStreamedText = false;
  s.currentMessageStreamedThinking = false;
  if (typeof ev.ttft_ms === 'number') {
    s.onEvent({ type: 'status', label: 'streaming', ttftMs: ev.ttft_ms });
  }
}

function handleContentBlockStart(s: StreamCtx, index: unknown, block: Record<string, unknown>): void {
  const key = blockKey(s, index);
  s.blocks.set(key, {
    type: block.type,
    name: block.name,
    id: block.id,
    input: '',
    inputValue: 'input' in block ? block.input : undefined,
  });
  if (block.type === 'thinking') {
    s.onEvent({ type: 'thinking_start' });
  }
}

function handleContentBlockDelta(s: StreamCtx, index: unknown, delta: Record<string, unknown>): void {
  const state = s.blocks.get(blockKey(s, index));

  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    if (s.currentMessageId) s.textStreamed.add(s.currentMessageId);
    s.currentMessageStreamedText = true;
    emitSafeText(s, s.currentMessageId, delta.text);
    return;
  }
  if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    if (s.currentMessageId) s.thinkingStreamed.add(s.currentMessageId);
    s.currentMessageStreamedThinking = true;
    emitSafeText(s, s.currentMessageId, delta.thinking, 'thinking_delta');
    return;
  }
  if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
    applyInputJsonDelta(state, delta.partial_json, s.onEvent);
  }
}

/** Emits a finished tool_use block from its streamed JSON text, else from its complete input value. */
function emitFinishedToolBlock(s: StreamCtx, state: BlockState, id: string): void {
  if (state.input.trim()) {
    try {
      emitToolUse(s, id, state.name, JSON.parse(state.input));
      s.streamedToolUseIds.add(id);
    } catch {
      // Fall through to the final assistant wrapper's input if the
      // streamed JSON is malformed or incomplete.
    }
    return;
  }
  if (state.inputValue === undefined) return;
  emitToolUse(s, id, state.name, state.inputValue);
  s.streamedToolUseIds.add(id);
}

function handleContentBlockStop(s: StreamCtx, ev: Record<string, unknown>): void {
  const key = blockKey(s, ev.index);
  const state = s.blocks.get(key);
  if (state?.type === 'tool_use' && typeof state.id === 'string') emitFinishedToolBlock(s, state, state.id);
  s.blocks.delete(key);
}

// Usage is keyed per message; an id-less message is keyed by its epoch.
function usageMessageKey(s: StreamCtx): string {
  return s.currentMessageId ?? `anon${s.anonymousMessageEpoch}`;
}

function handleMessageDeltaStreamEvent(s: StreamCtx, ev: Record<string, unknown>): void {
  s.segmentUsage.observe({ messageId: usageMessageKey(s), usage: ev.usage ?? (isRecord(ev.delta) ? ev.delta.usage : undefined) });
  if (isRecord(ev.delta)) handleMessageDeltaEvent(s, ev.delta);
}

function handleMessageDeltaEvent(s: StreamCtx, delta: Record<string, unknown>): void {
  const stopReason = typeof delta.stop_reason === 'string' ? delta.stop_reason : null;
  if (stopReason) emitTurnEnd(s, stopReason);
}

function handleStreamEvent(s: StreamCtx, ev: Record<string, unknown>) {
  switch (ev.type) {
    case 'message_start':
      handleMessageStart(s, ev);
      return;
    case 'content_block_start':
      if (isRecord(ev.content_block)) handleContentBlockStart(s, ev.index, ev.content_block);
      return;
    case 'content_block_delta':
      if (isRecord(ev.delta)) handleContentBlockDelta(s, ev.index, ev.delta);
      return;
    case 'content_block_stop':
      handleContentBlockStop(s, ev);
      return;
    case 'message_delta':
      handleMessageDeltaStreamEvent(s, ev);
      return;
  }
}

function flushPendingArtifactText(s: StreamCtx) {
  const text = `${s.pendingArtifactText}${s.artifactOpenCandidate}${s.duplicateArtifactCandidate}`;
  if (!text) return;
  s.pendingArtifactText = '';
  s.artifactOpenCandidate = '';
  s.duplicateArtifactCandidate = '';
  s.suppressNextArtifactText = false;
  s.suppressDuplicateArtifactText = false;
  s.recentWriteContents.length = 0;
  s.wroteHtmlFileThisTurn = false;
  emitSafeText(s, s.currentMessageId, text);
}
