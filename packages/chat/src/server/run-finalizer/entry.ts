import type { Clock } from '@jini-ai/core/primitives';
/** Saves completed run output independently of a connected client, through host ports. */

import type { ChatMessage } from '../../core/messages.js';
import { isTerminalRunStatus } from '../../core/messages.js';
import type { AgentEvent } from '../../core/events.js';
import { readSseFrames, runContentFromEvents, runEventsForSave, runInterruptedNotice, translateRunFrame, type RunNotices } from '../../core/run-events/entry.js';
import type { RunDaemonClient, RunLedger, Scheduler, RunIdClassifier, RunSettlement } from './ports.js';
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

  async function settle(watch: Watch, status: RunSettlement["status"], events: AgentEvent[]): Promise<void> {
    watch.terminal = true;
    if (watch.trailing) scheduler.cancel({ handle: watch.trailing.handle });
    watch.trailing = undefined;
    await args.ledger.settle({
      conversationId: watch.conversationId,
      messageId: watch.messageId,
      runId: watch.runId,
      status,
      content: runContentFromEvents({ events }),
      events: runEventsForSave({ events }),
      endedAt: now(),
    });
  }

  function settleInterrupted(watch: Watch): Promise<void> {
    return settle(watch, "canceled", [...watch.events, runInterruptedNotice({ notice: args.notices.interrupted })]);
  }

  // Coalesce one pending write and one trailing timer. Never block frame consumption on storage.
  // Growth-only checkpointing avoids shrinking a saved answer during replay from event zero.
  async function checkpoint(watch: Watch): Promise<void> {
    if (watch.terminal || watch.checkpointPending) return;
    if (watch.events.length <= watch.checkpointedEvents) return;
    const wait = checkpointIntervalMs - (now() - watch.checkpointedAt);
    if (wait > 0) {
      if (!watch.trailing) {
        watch.trailing = { handle: scheduler.schedule({ task: () => {
          watch.trailing = undefined;
          void checkpoint(watch);
        }, delayMs: wait }) };
      }
      return;
    }
    if (watch.trailing) scheduler.cancel({ handle: watch.trailing.handle });
    watch.trailing = undefined;
    watch.checkpointedEvents = watch.events.length;
    watch.checkpointedAt = now();
    watch.checkpointPending = true;
    await args.ledger
      .checkpoint({
        conversationId: watch.conversationId,
        messageId: watch.messageId,
        runId: watch.runId,
        content: runContentFromEvents({ events: watch.events }),
        events: runEventsForSave({ events: watch.events }),
      })
      .catch((error: unknown) => reportError({ operation: "checkpoint", runId: watch.runId, error }))
      .finally(() => {
        watch.checkpointPending = false;
        void checkpoint(watch);
      });
  }

  async function readStream(watch: Watch): Promise<StreamResult> {
    const response = await daemon.openEvents({ runId: watch.runId, principalId: watch.principalId });
    if (response.status === 404 || !response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      return response.status === 404 ? { kind: "gone" } : { kind: "dropped" };
    }
    // Each connection replays the complete history, rather than appending duplicate deltas.
    watch.events = [];
    watch.failed = false;
    const carry = {};
    for await (const frame of readSseFrames({ body: response.body })) {
      const outcome = translateRunFrame({ kind: frame.event, raw: frame.data, notices: args.notices }, { carry });
      watch.events.push(...outcome.events);
      if (outcome.error) watch.failed = true;
      if (outcome.terminal) {
        watch.terminal = true;
        return { kind: "ended", status: watch.failed && outcome.terminal === "succeeded" ? "failed" : outcome.terminal };
      }
      void checkpoint(watch);
    }
    return { kind: "dropped" };
  }

  async function follow(watch: Watch): Promise<void> {
    for (let attempt = 0; attempt <= maxReconnects; attempt += 1) {
      const result = await readStream(watch).catch((): StreamResult => ({ kind: "dropped" }));
      if (result.kind === "ended") return settle(watch, result.status, watch.events);
      if (result.kind === "gone") return settleInterrupted(watch);
      if ((await daemon.runStatus({ runId: watch.runId, principalId: watch.principalId })) === 404) return settleInterrupted(watch);
      await scheduler.sleep({ delayMs: reconnectDelayMs });
    }
    // Exhaustion alone is not evidence of a terminal run; the host can reattach or repair at boot.
  }

  return {
    watch({ principalId, conversationId, message }) {
      const runId = message.runId;
      if (message.role !== "assistant" || !runId || !args.runIdClassifier.isDaemonRunId({ runId })) return;
      if (message.runStatus === undefined || isTerminalRunStatus({ status: message.runStatus })) return;
      if (active.has(runId)) return;

      const watch: Watch = {
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
      const done = follow(watch)
        .catch((error: unknown) => {
          reportError({ operation: "watch", runId, error });
        })
        .finally(() => {
          watch.terminal = true;
          if (watch.trailing) scheduler.cancel({ handle: watch.trailing.handle });
          watch.trailing = undefined;
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
