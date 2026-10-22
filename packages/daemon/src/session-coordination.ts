import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { SchedulerPort } from './scheduler.js';

export interface ConversationRun { readonly conversationId: string; readonly runId: string }
/** In-process occupancy only: durable answer ownership belongs to the unfinished message.
 * An empty tracker after restart does not prove a CLI child died; recovery must verify its saved
 * identity before native resume, otherwise reconstruct under a fresh session. */
export interface LiveRunTracker {
  /** Register synchronously before awaiting, so another start observes this run as live. */
  register(args: ConversationRun, optional?: Record<string, never>): void;
  /** Idempotent removal; safe for a run that was never registered. */
  unregister(args: ConversationRun, optional?: Record<string, never>): void;
  /** Excludes runId itself; concurrent processes must not resume the same CLI transcript. */
  hasConcurrentLiveRun(args: ConversationRun, optional?: Record<string, never>): boolean;
  concurrentLiveRunIds(args: ConversationRun, optional?: Record<string, never>): string[];
  /** Undefined after unregister; tool calls use this to resolve their conversation. */
  conversationIdForRun(args: { runId: string }, optional?: Record<string, never>): string | undefined;
}
/** Fresh private maps keep daemon instances independent. */
export function createLiveRunTracker(_args: Record<string, never>, _optional: Record<string, never> = {}): LiveRunTracker {
  const runs = new Map<string, Set<string>>();
  const conversations = new Map<string, string>();
  function unregister({ conversationId, runId }: ConversationRun): void {
    if (conversations.get(runId) === conversationId) conversations.delete(runId);
    const ids = runs.get(conversationId);
    ids?.delete(runId);
    if (ids?.size === 0) runs.delete(conversationId);
  }
  return {
    register({ conversationId, runId }) {
      const previous = conversations.get(runId);
      if (previous !== undefined && previous !== conversationId) unregister({ conversationId: previous, runId });
      conversations.set(runId, conversationId);
      const ids = runs.get(conversationId) ?? new Set<string>();
      ids.add(runId);
      runs.set(conversationId, ids);
    },
    unregister,
    concurrentLiveRunIds: ({ conversationId, runId }) => [...(runs.get(conversationId) ?? [])].filter(id => id !== runId),
    hasConcurrentLiveRun({ conversationId, runId }) {
      for (const id of runs.get(conversationId) ?? []) if (id !== runId) return true;
      return false;
    },
    conversationIdForRun: ({ runId }) => conversations.get(runId),
  };
}
export interface ConversationStartLock {
  /** Serialize each conversation separately; undefined runs immediately. Rejection reaches only
   * its caller and never poisons queued sections. Entries disappear once their queues drain. */
  run<T>(args: { conversationId: string | undefined; critical: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
  trackedConversationCount(required: Record<string, never>, optional?: Record<string, never>): number;
}
/** Serialize the session-binding read/decide/write so simultaneous first turns cannot mint competing
 * sessions and orphan a binding. Lock only initialization: holding it across execution would queue
 * turns behind minutes of work instead of allowing an immediate concurrency refusal. In-process only. */
export function createConversationStartLock(_args: Record<string, never>, _optional: Record<string, never> = {}): ConversationStartLock {
  const tails = new Map<string, Promise<void>>();
  return {
    run({ conversationId, critical }) {
      if (conversationId === undefined) return critical();
      const result = (tails.get(conversationId) ?? Promise.resolve()).then(critical);
      // A newer section may own this key already; deleting its tail would allow a third to race it.
      const release = (): void => { if (tails.get(conversationId) === tail) tails.delete(conversationId); };
      // Both settlements release immediately and make the tail non-rejecting for the next section.
      const tail = result.then(release, release);
      tails.set(conversationId, tail);
      return result;
    },
    trackedConversationCount: () => tails.size,
  };
}
/** Existing lifecycle port; no persistence is imported or implemented here. */
export interface StoppingRunLifecycle {
  onCancelRequested(args: { runId: string; listener: () => void }, optional?: Record<string, never>): () => void;
  waitForTerminal(args: { runId: string }, optional?: Record<string, never>): Promise<unknown>;
}
export const STOPPING_RUN_WAIT_MS = 20_000;
/** Wait only for cancelled peers: cancellation records intent before the CLI exits. Active peers
 * can run for minutes and stay subject to the concurrency rule. Remove ended peers here because
 * ordering against their own terminal cleanup is not guaranteed. The wait is bounded by timeoutMs. */
export async function waitForStoppingRuns({ tracker, lifecycle, scheduler, conversationId, runId }: {
  tracker: LiveRunTracker; lifecycle: StoppingRunLifecycle; scheduler: SchedulerPort; conversationId: string; runId: string;
}, { timeoutMs = STOPPING_RUN_WAIT_MS }: { timeoutMs?: number } = {}): Promise<void> {
  const stopping = tracker.concurrentLiveRunIds({ conversationId, runId }).filter(id => {
    let cancelled = false;
    // Subscription replays a past cancellation synchronously; immediate unsubscribe avoids leaks.
    try { lifecycle.onCancelRequested({ runId: id, listener: () => { cancelled = true; } })(); } catch { return false; }
    return cancelled;
  });
  if (stopping.length === 0) return;
  let cancelTimer: (() => void) | undefined;
  const timedOut = new Promise<void>(resolve => { cancelTimer = scheduler.schedule({ delayMs: timeoutMs, callback: resolve }); });
  // Promise.resolve also captures a synchronously throwing host port, ensuring timer cleanup.
  const ended = Promise.all(stopping.map(id => Promise.resolve().then(() => lifecycle.waitForTerminal({ runId: id })).then(() => tracker.unregister({ conversationId, runId: id }))));
  try { await Promise.race([ended, timedOut]); } finally { cancelTimer?.(); }
}
export interface FailingRunLifecycle {
  emit(args: { runId: string; input: { event: 'error'; data: { message: string } } }, optional?: Record<string, never>): Promise<unknown>;
  finish(input: { runId: string; status: 'failed'; code: null; signal: null; resumable: false }, optional?: Record<string, never>): Promise<unknown>;
}
/** Emit the refusal reason on the run stream so the chat can show and save it. Event delivery
 * is best-effort; finishing remains mandatory even when the stream cannot accept the event. */
export async function failRunBeforeStart({ lifecycle, runId, message }: { lifecycle: FailingRunLifecycle; runId: string; message: string }, _optional: Record<string, never> = {}): Promise<void> {
  try { await lifecycle.emit({ runId: runId, input: { event: 'error', data: { message } } }); } catch { /* Finishing remains mandatory. */ }
  await lifecycle.finish({ runId, status: 'failed', code: null, signal: null, resumable: false });
}

export interface AgentCapabilities { readonly resumesSessionViaCli?: boolean; readonly resumesSessionViaAcpLoad?: boolean; readonly capturesSessionIdFromStream?: boolean }
export interface AgentCapabilityResolver { lookup(args: { agentId: string }, optional?: Record<string, never>): AgentCapabilities | undefined }
/** Use declared CLI-resume capabilities, never a hand-kept agent list. Capture-style CLIs mint
 * their own ids; handing one a host id would persist a session that does not exist. ACP-only
 * resume uses session/load rather than CLI flags. Unknown agents fail closed. */
export function agentAcceptsHostMintedSessionId({ agentId, agents }: { agentId: string; agents: AgentCapabilityResolver }, _optional: Record<string, never> = {}): boolean {
  const def = agents.lookup({ agentId });
  return Boolean(def?.resumesSessionViaCli) && !def?.capturesSessionIdFromStream;
}
/** CLI/ACP-resuming agents carry prior turns and may receive only the newest user message.
 * Resolve capabilities synchronously through the port; no PATH probing is needed. */
export function agentCarriesOwnMemory({ agentId, agents }: { agentId: string; agents: AgentCapabilityResolver }, _optional: Record<string, never> = {}): boolean {
  const def = agents.lookup({ agentId });
  return Boolean(def?.resumesSessionViaCli) || Boolean(def?.resumesSessionViaAcpLoad);
}
/** Mint only a cold, conversation-scoped start for a host-id-capable agent. Persist and pass the
 * same id before spawning: relying only on a terminal report can orphan a crashed first turn.
 * A resume already has a binding; replacing it would fork the conversation. */
export function resolveHostMintedSessionId(input: { conversationId: string | undefined; effectiveResumeSessionId: string | null; acceptsHostMintedSessionId: boolean; mint: () => string }, _optional: Record<string, never> = {}): string | null {
  return input.conversationId !== undefined && input.effectiveResumeSessionId === null && input.acceptsHostMintedSessionId ? input.mint() : null;
}
/** Return { newSessionId } when present, otherwise omit the key entirely for the run-input spread. */
export function resolveNewSessionField({ hostMintedSessionId }: { hostMintedSessionId: string | null }, _optional: Record<string, never> = {}): { newSessionId?: string } {
  return hostMintedSessionId !== null ? { newSessionId: hostMintedSessionId } : {};
}
/** Return { resumeSessionId } when present, otherwise omit the key entirely for the run-input spread. */
export function resolveResumeSessionField({ storedSessionId }: { storedSessionId: string | null }, _optional: Record<string, never> = {}): { resumeSessionId?: string } {
  return storedSessionId !== null ? { resumeSessionId: storedSessionId } : {};
}
/** Only a terminal end with a nonempty sessionRef establishes a session id to persist. */
export function extractSessionRefFromEndEvent({ event }: { event: RunProtocolEvent }, _optional: Record<string, never> = {}): string | undefined {
  if (event.kind !== 'end') return undefined;
  const id = event.payload.sessionRef;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}
/** Clear only an attempted resume whose terminal event reconfirms no session. The event cannot
 * distinguish a dead session from an unrelated early failure: one cold turn costs less than
 * retrying an unrecoverable id forever. A cold run has no stored binding to clear. */
export function shouldClearSessionOnFailedResume({ event, attemptedResumeSessionId }: { event: RunProtocolEvent; attemptedResumeSessionId: string | null }, _optional: Record<string, never> = {}): boolean {
  return attemptedResumeSessionId !== null && event.kind === 'end' && extractSessionRefFromEndEvent({ event }) === undefined;
}
/** Refuse a forced cold start when a stored session, concurrent peer and memory-carrying agent
 * coincide: the client may have sent only the latest prompt, so cold execution loses prior turns.
 * A first turn or an agent receiving the full transcript has no such context to lose. */
export function wouldForcedColdStartLoseConversationContext(input: { storedSessionId: string | null; hasConcurrentLiveRun: boolean; carriesOwnMemory: boolean }, _optional: Record<string, never> = {}): boolean {
  return input.storedSessionId !== null && input.hasConcurrentLiveRun && input.carriesOwnMemory;
}

