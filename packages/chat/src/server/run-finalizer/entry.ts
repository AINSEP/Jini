import type { Clock } from '@jini-ai/core/primitives';
/** Saves completed run output independently of a connected client, through host ports. */

import type { ChatMessage } from '../../core/messages.js';
import { isTerminalRunStatus } from '../../core/messages.js';
import { readSseFrames, runContentFromEvents, runEventsForSave, runInterruptedNotice, translateRunFrame, type RunNotices } from '../../core/run-events/entry.js';
import type { RunDaemonClient, RunLedger, Scheduler, RunIdClassifier, RunProgress, RunSettlement } from './ports.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";
export type { RunDaemonClient, RunLedger, Scheduler, RunIdClassifier, RunRef, RunProgress, RunSettlement } from './ports.js';

/** All infrastructure and host messages are explicit; this factory opens no storage. */
export interface AssistantRunFinalizerArgs {
  readonly ledger: RunLedger;
  readonly daemon: RunDaemonClient;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly runIdClassifier: RunIdClassifier;
  readonly notices: RunNotices;
  readonly onError: (args: { operation: 'checkpoint' | 'watch'; runId: string; error: unknown }) => void;
}

/** Reconnect delay: 2000ms; retry count: 30; checkpoint interval: 1000ms. */
export interface AssistantRunFinalizerOptions {

  readonly reconnectDelayMs?: number;

  readonly maxReconnects?: number;

  readonly checkpointIntervalMs?: number;
}

export interface AssistantRunFinalizer {

  /** Ignore non-assistant, terminal, missing-status and externally held runs; deduplicate by run ID. */
  watch(input: { principalId: string; conversationId: string; message: ChatMessage }): void;

  /** Wait for current watches to finish; terminal writes may overtake pending checkpoints. */
  idle(args: Record<string, never>): Promise<void>;

  activeCount(args: Record<string, never>): number;
}

interface Watch {
  readonly principalId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
  events: AgentEvent[];
  failed: boolean;

  checkpointedEvents: number;
  checkpointedAt: number;

  checkpointPending: boolean;

  terminal: boolean;

  trailing?: { handle: unknown } | undefined;
}

type StreamResult = { kind: "ended"; status: RunSettlement["status"] } | { kind: "gone" } | { kind: "dropped" };
type OpenedStream = { kind: "open"; body: ReadableStream<Uint8Array> } | StreamResult;

/** An error frame keeps a later successful end from settling as a success. */
function endStatus({ failed, terminal }: { failed: boolean; terminal: RunSettlement["status"] }, _optional = {}): RunSettlement["status"] {
  return failed && terminal === "succeeded" ? "failed" : terminal;
}

/** Pure: the one atomic ledger write that ends a watched run. */
function settlementOf({ watch, status, events, endedAt }: { watch: Watch; status: RunSettlement["status"]; events: AgentEvent[]; endedAt: number }, _optional = {}): RunSettlement {
  return {
    conversationId: watch.conversationId,
    messageId: watch.messageId,
    runId: watch.runId,
    status,
    content: runContentFromEvents({ events }),
    events: runEventsForSave({ events }),
    endedAt,
  };
}

/** Pure: the growth-only progress write for a watched run's events so far. */
function progressOf({ watch }: { watch: Watch }, _optional = {}): RunProgress {
  return {
    conversationId: watch.conversationId,
    messageId: watch.messageId,
    runId: watch.runId,
    content: runContentFromEvents({ events: watch.events }),
    events: runEventsForSave({ events: watch.events }),
  };
}

/** Pure eligibility: only a non-terminal assistant message held by a daemon run is followed. */
function isWatchable({ message, runIdClassifier }: { message: ChatMessage; runIdClassifier: RunIdClassifier }, _optional = {}): boolean {
  const runId = message.runId;
  if (message.role !== "assistant" || !runId || !runIdClassifier.isDaemonRunId({ runId })) return false;
  return message.runStatus !== undefined && !isTerminalRunStatus({ status: message.runStatus });
}

function newWatch({ principalId, conversationId, message, runId }: { principalId: string; conversationId: string; message: ChatMessage; runId: string }, _optional = {}): Watch {
  return {
    principalId,
    conversationId,
    messageId: message.id,
    runId,
    events: [],
    failed: false,
    checkpointedEvents: 0,
    checkpointedAt: Number.NEGATIVE_INFINITY,
    checkpointPending: false,
    terminal: false,
  };
}

/** The connection's event body, or why it cannot be followed. Non-success bodies are cancelled. */
async function openStream({ daemon, watch }: { daemon: RunDaemonClient; watch: Watch }, _optional = {}): Promise<OpenedStream> {
  const response = await daemon.openEvents({ runId: watch.runId, principalId: watch.principalId });
  if (response.ok && response.body) return { kind: "open", body: response.body };
  await response.body?.cancel().catch(() => undefined);
  return response.status === 404 ? { kind: "gone" } : { kind: "dropped" };
}

async function consumeFrames({ watch, body, notices, onFrame }: { watch: Watch; body: ReadableStream<Uint8Array>; notices: RunNotices; onFrame: () => void }, _optional = {}): Promise<StreamResult> {
  // Each connection replays the complete history, rather than appending duplicate deltas.
  watch.events = [];
  watch.failed = false;
  const carry = {};
  for await (const frame of readSseFrames({ body })) {
    const outcome = translateRunFrame({ kind: frame.event, raw: frame.data, notices }, { carry });
    watch.events.push(...outcome.events);
    if (outcome.error) watch.failed = true;
    if (outcome.terminal) {
      watch.terminal = true;
      return { kind: "ended", status: endStatus({ failed: watch.failed, terminal: outcome.terminal }) };
    }
    onFrame();
  }
  return { kind: "dropped" };
}

async function readWatchStream({ daemon, watch, notices, onFrame }: { daemon: RunDaemonClient; watch: Watch; notices: RunNotices; onFrame: () => void }, _optional = {}): Promise<StreamResult> {
  const opened = await openStream({ daemon, watch });
  return opened.kind === "open" ? consumeFrames({ watch, body: opened.body, notices, onFrame }) : opened;
}

/** What checkpointing needs from the host; all effects are injected. */
interface CheckpointDeps {
  readonly ledger: RunLedger;
  readonly scheduler: Scheduler;
  readonly now: () => number;
  readonly intervalMs: number;
  readonly report: (input: Parameters<AssistantRunFinalizerArgs["onError"]>[0]) => void;
}

function clearTrailingTimer({ watch, scheduler }: { watch: Watch; scheduler: Scheduler }, _optional = {}): void {
  if (watch.trailing) scheduler.cancel({ handle: watch.trailing.handle });
  watch.trailing = undefined;
}

function scheduleTrailing({ watch, wait, deps }: { watch: Watch; wait: number; deps: CheckpointDeps }, _optional = {}): void {
  if (watch.trailing) return;
  watch.trailing = { handle: deps.scheduler.schedule({ task: () => {
    watch.trailing = undefined;
    void checkpointWatch({ watch, deps });
  }, delayMs: wait }) };
}

// Coalesce one pending write and one trailing timer. Never block frame consumption on storage.
// Growth-only checkpointing avoids shrinking a saved answer during replay from event zero.
async function checkpointWatch({ watch, deps }: { watch: Watch; deps: CheckpointDeps }, _optional = {}): Promise<void> {
  if (watch.terminal || watch.checkpointPending) return;
  if (watch.events.length <= watch.checkpointedEvents) return;
  const wait = deps.intervalMs - (deps.now() - watch.checkpointedAt);
  if (wait > 0) {
    scheduleTrailing({ watch, wait, deps });
    return;
  }
  clearTrailingTimer({ watch, scheduler: deps.scheduler });
  watch.checkpointedEvents = watch.events.length;
  watch.checkpointedAt = deps.now();
  watch.checkpointPending = true;
  await deps.ledger
    .checkpoint(progressOf({ watch }))
    .catch((error: unknown) => deps.report({ operation: "checkpoint", runId: watch.runId, error }))
    .finally(() => {
      watch.checkpointPending = false;
      void checkpointWatch({ watch, deps });
    });
}

/** Follow replayable run streams and save through atomic host ledger operations.
 * The host retains authorization, owner scope, kernel transactions, boot reconciliation, HTTP
 * credentials and excluded run-ID prefixes. Replay starts at zero; error-before-success and
 * reconnect exhaustion must not falsely settle a run. Checkpoints are throttled with a trailing
 * write, and checkpoint/settle atomically reject other runs or terminal rows: first terminal wins.
 * Frame vocabulary, paragraph boundaries and compaction are shared with the run-event reducer.
 * Non-success bodies are cancelled and progress scheduling stops at completion. Real database
 * restart/race coverage remains a host responsibility; this factory never opens storage. */
export function createAssistantRunFinalizer(args: AssistantRunFinalizerArgs, options: AssistantRunFinalizerOptions = {}): AssistantRunFinalizer {
  const { daemon, scheduler } = args;
  const now = () => args.clock.nowMs();
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const maxReconnects = options.maxReconnects ?? 30;
  const checkpointIntervalMs = options.checkpointIntervalMs ?? 1_000;
  // Diagnostics must not change run/checkpoint behavior, even when the host callback throws.
  function reportError(input: Parameters<AssistantRunFinalizerArgs["onError"]>[0]): void {
    try { args.onError(input); } catch { /* The host owns reporting failures. */ }
  }
  const active = new Map<string, { watch: Watch; done: Promise<void> }>();

  const clearTrailing = (watch: Watch): void => clearTrailingTimer({ watch, scheduler });

  async function settle(watch: Watch, status: RunSettlement["status"], events: AgentEvent[]): Promise<void> {
    watch.terminal = true;
    clearTrailing(watch);
    await args.ledger.settle(settlementOf({ watch, status, events, endedAt: now() }));
  }

  function settleInterrupted(watch: Watch): Promise<void> {
    return settle(watch, "canceled", [...watch.events, runInterruptedNotice({ notice: args.notices.interrupted })]);
  }

  const checkpointDeps: CheckpointDeps = { ledger: args.ledger, scheduler, now, intervalMs: checkpointIntervalMs, report: reportError };
  const checkpoint = (watch: Watch): Promise<void> => checkpointWatch({ watch, deps: checkpointDeps });

  const readStream = (watch: Watch) => readWatchStream({ daemon, watch, notices: args.notices, onFrame: () => { void checkpoint(watch); } });

  async function follow(watch: Watch): Promise<void> {
    for (let attempt = 0; attempt <= maxReconnects; attempt += 1) {
      const result = await readStream(watch).catch((): StreamResult => ({ kind: "dropped" }));
      if (result.kind === "ended") return settle(watch, result.status, watch.events);
      if (result.kind === "gone") return settleInterrupted(watch);
      if ((await daemon.runStatus({ runId: watch.runId, principalId: watch.principalId })) === 404) return settleInterrupted(watch);
      await scheduler.sleep({ delayMs: reconnectDelayMs });
    }
    // Exhaustion alone is not evidence of a terminal run; the host can reattach or repair at boot.
    return undefined;
  }

  return {
    watch({ principalId, conversationId, message }) {
      if (!isWatchable({ message, runIdClassifier: args.runIdClassifier })) return;
      const runId = message.runId!;
      if (active.has(runId)) return;

      const watch = newWatch({ principalId, conversationId, message, runId });
      const done = follow(watch)
        .catch((error: unknown) => {
          reportError({ operation: "watch", runId, error });
        })
        .finally(() => {
          watch.terminal = true;
          clearTrailing(watch);
          active.delete(runId);
        });
      active.set(runId, { watch, done });
    },

    async idle(_args) {
      while (active.size > 0) await Promise.all([...active.values()].map((entry) => entry.done));
    },

    activeCount: (_args) => active.size,
  };
}
