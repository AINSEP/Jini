import { createConsoleLogger, type Logger } from '@jini-ai/core/primitives';
import type { ChatMessage } from "../messages.js";
import type { RunHandlers } from "../transport.js";
import { translateRunFrame } from "../run-events/entry.js";
import type { RunNotices } from "../run-events/entry.js";

export interface DurableRunBinding { readonly messageId: string; readonly conversationId: string }


export interface DurableSubscriptionPorts {
  /** Absent recover intent preserves legacy recovery; false requests only the saved checkpoint. */
  readonly read: (required: { runId: string; messageId?: string }, optional: { recover?: boolean }) => Promise<ChatMessage | null | "gone">;
  readonly stream: (required: { runId: string; cursor: string; frame: (kind: string, data: string, cursor: string) => void; dropped: (reason?: string) => void }, optional: {}) => () => void;
  readonly schedule: (required: { work: () => void; delayMs: number }, optional: {}) => () => void;
}

type CheckpointHandlers = RunHandlers & { onCheckpoint?: (message: ChatMessage) => void };

/** Mutable state of one followed run; every helper below reads and writes this one object. */
interface FollowState {
  streamEpoch: number;
  runId: string;
  cursor: string;
  stopped: boolean;
  reading: boolean;
  recoveryPending: boolean;
  dropped: boolean;
  reconnectDelayMs: number;
  stopStream: (() => void) | undefined;
  stopTimer: (() => void) | undefined;
  messageId: string | undefined;
  /** The abort listener registered on the caller's signal, so teardown can remove exactly it. */
  abortListener: () => void;
}

/** Injected collaborators of one followed run; never mutated. */
interface FollowEnv {
  readonly handlers: CheckpointHandlers;
  readonly signal: AbortSignal | undefined;
  readonly binding: DurableRunBinding | undefined;
  readonly ports: DurableSubscriptionPorts;
  readonly notices: RunNotices;
  readonly bindings: Map<string, DurableRunBinding>;
  readonly report: Pick<Logger, "info">;
}

type FollowCtx = { s: FollowState; env: FollowEnv };

/** Each stream is torn down exactly once: a dropped stream is closed on disconnect, and a later reopen or stop must not close it again. */
function closeStream({ s }: FollowCtx) {
  const close = s.stopStream;
  s.stopStream = undefined;
  close?.();
}

function stopFollowing(ctx: FollowCtx) {
  const { s, env } = ctx;
  s.stopped = true;
  s.streamEpoch += 1;
  closeStream(ctx);
  s.stopTimer?.();
  env.signal?.removeEventListener("abort", s.abortListener);
}

function finish(ctx: FollowCtx, message: ChatMessage) {
  const { handlers } = ctx.env;
  stopFollowing(ctx);
  handlers.onCheckpoint?.(message);
  if (message.runStatus === "failed" && !handlers.onCheckpoint) handlers.onError(new Error("The assistant could not finish this answer. Saved work is above."));
  handlers.onDone(message.events ?? []);
}

function openStream(ctx: FollowCtx) {
  const { s, env } = ctx;
  s.streamEpoch += 1;
  const epoch = s.streamEpoch;
  s.dropped = false;
  closeStream(ctx);
  s.stopStream = env.ports.stream({ runId: s.runId, cursor: s.cursor,
    frame: (...args) => { if (epoch === s.streamEpoch) deliverFrame(ctx, ...args); },
    dropped: () => { if (epoch === s.streamEpoch) onDisconnected(ctx); },
  }, {});
}

/** One timer owns reconnects, including faults during a checkpoint read. No cursor reset. */
function onDisconnected(ctx: FollowCtx) {
  const { s, env } = ctx;
  if (s.stopped || s.dropped) return;
  s.dropped = true;
  s.streamEpoch += 1;
  s.recoveryPending = true;
  s.reconnectDelayMs = Math.min(30_000, Math.max(1_000, s.reconnectDelayMs * 2));
  // Metadata only: neither frame contents nor saved user messages belong in transport logs.
  env.report.info({ message: "[durable-subscription] Stream disconnected; retrying." }, { meta: { runId: s.runId, cursor: s.cursor, retryDelayMs: s.reconnectDelayMs } });
  closeStream(ctx);
  if (!s.reading) scheduleRead(ctx);
}

function scheduleRead(ctx: FollowCtx) {
  const { s, env } = ctx;
  s.stopTimer?.();
  s.stopTimer = env.ports.schedule({ work: () => void readSaved(ctx).catch(() => undefined), delayMs: s.dropped ? s.reconnectDelayMs : 1_000 }, {});
}

function deliverFrame(ctx: FollowCtx, kind: string, data: string, nextCursor: string) {
  const { s, env } = ctx;
  if (s.stopped) return;
  if (nextCursor) {
    if (nextCursor !== s.cursor) s.reconnectDelayMs = 0;
    s.cursor = nextCursor;
  }
  const outcome = translateRunFrame({ kind, raw: data, notices: env.notices }, {});
  // An attempt's error/end may be followed by a continuation. Only the row can finalize it.
  if (outcome.terminal || outcome.error) { s.recoveryPending = true; void readSaved(ctx).catch(() => undefined); return; }
  // With the checkpoint-capable hook, render only durable projections. Replaying a daemon
  // prefix into a seeded bubble would duplicate its text; the server folds those deltas once.
  if (env.handlers.onCheckpoint) return;
  for (const event of outcome.events) env.handlers.onEvent(event);
}

async function readSaved(ctx: FollowCtx) {
  const { s, env } = ctx;
  if (s.stopped || s.reading) return;
  s.reading = true;
  s.stopTimer?.();
  s.stopTimer = undefined;
  const recover = s.recoveryPending;
  let retryRecovery = recover;
  // Consume only when a read starts: faults during its await latch one follow-up recovery.
  s.recoveryPending = false;
  try {
    const message = await env.ports.read({ runId: s.runId, ...(s.messageId ? { messageId: s.messageId } : {}) }, { recover });
    if (s.stopped || !message) return;
    retryRecovery = false;
    if (message === "gone") { stopFollowing(ctx); env.handlers.onDone([]); return; }
    applySavedMessage(ctx, message);
  } finally {
    // Recovery must return a body before conditional polls resume: a failed recovery followed
    // by unchanged (304) polls would otherwise leave a quiet run's dropped stream closed.
    if (retryRecovery) s.recoveryPending = true;
    s.reading = false;
    if (!s.stopped) {
      // Always schedule: an error arriving during read must not create a tight recovery loop.
      scheduleRead(ctx);
    }
  }
}

function applySavedMessage(ctx: FollowCtx, message: ChatMessage) {
  const { s, env } = ctx;
  s.messageId = message.id;
  if (["succeeded", "failed", "canceled"].includes(message.runStatus ?? "")) { finish(ctx, message); return; }
  env.handlers.onCheckpoint?.(message);
  if (message.runId && message.runId !== s.runId) {
    s.runId = message.runId;
    s.cursor = "";
    s.reconnectDelayMs = 0;
    if (env.binding) env.bindings.set(s.runId, env.binding);
    s.dropped = true;
  }
  if (s.dropped) openStream(ctx);
}

/** SSE is a view of one attempt. The saved message owns terminal state and can point at a new
 * attempt after recovery; neither a browser 404 nor a closed stream may fail the logical run.
 * An explicit "gone" result ends observation and releases the caller's streaming state. */
export function followDurableRun(
  { runId: initialRunId, handlers, signal, binding, ports, notices, bindings }: { runId: string; handlers: CheckpointHandlers; signal?: AbortSignal; binding?: DurableRunBinding; ports: DurableSubscriptionPorts; notices: RunNotices; bindings: Map<string, DurableRunBinding> }, { report = createConsoleLogger({ prefix: '' }) }: { report?: Pick<Logger, "info"> } = {},
): () => void {
  const s: FollowState = {
    streamEpoch: 0, runId: initialRunId, cursor: "", stopped: false, reading: false, recoveryPending: true,
    dropped: false, reconnectDelayMs: 0, stopStream: undefined, stopTimer: undefined, messageId: binding?.messageId,
    abortListener: () => {},
  };
  const ctx: FollowCtx = { s, env: { handlers, signal, binding, ports, notices, bindings, report } };
  const stop = () => stopFollowing(ctx);
  s.abortListener = stop;
  if (!signal?.aborted) {
    signal?.addEventListener("abort", stop);
    openStream(ctx);
    // Polling also covers an attempt that dies before a first frame/connection error arrives.
    s.stopTimer = ports.schedule({ work: () => void readSaved(ctx).catch(() => undefined), delayMs: 1_000 }, {});
  }
  return stop;
}
