import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { SchedulerPort } from './scheduler.js';

export interface ConversationRun { readonly conversationId: string; readonly runId: string }
export interface LiveRunTracker {
  register(args: ConversationRun): void;
  unregister(args: ConversationRun): void;
  hasConcurrentLiveRun(args: ConversationRun): boolean;
  concurrentLiveRunIds(args: ConversationRun): string[];
  conversationIdForRun(args: { runId: string }): string | undefined;
}
export function createLiveRunTracker(_args: Record<string, never>): LiveRunTracker {
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
  run<T>(args: { conversationId: string | undefined; critical: () => Promise<T> }): Promise<T>;
  trackedConversationCount(): number;
}
/** Serialize initialization only. Run execution belongs outside the critical section. */
export function createConversationStartLock(_args: Record<string, never>): ConversationStartLock {
  const tails = new Map<string, Promise<void>>();
  return {
    run({ conversationId, critical }) {
      if (conversationId === undefined) return critical();
      const result = (tails.get(conversationId) ?? Promise.resolve()).then(critical);
      const release = (): void => { if (tails.get(conversationId) === tail) tails.delete(conversationId); };
      const tail = result.then(release, release);
      tails.set(conversationId, tail);
      return result;
    },
    trackedConversationCount: () => tails.size,
  };
}
/** Existing lifecycle port; no persistence is imported or implemented here. */
export interface StoppingRunLifecycle {
  onCancelRequested(args: { runId: string; listener: () => void }): () => void;
  waitForTerminal(args: { runId: string }): Promise<unknown>;
}
export const STOPPING_RUN_WAIT_MS = 20_000;
export async function waitForStoppingRuns({ tracker, lifecycle, scheduler, conversationId, runId }: {
  tracker: LiveRunTracker; lifecycle: StoppingRunLifecycle; scheduler: SchedulerPort; conversationId: string; runId: string;
}, { timeoutMs = STOPPING_RUN_WAIT_MS }: { timeoutMs?: number } = {}): Promise<void> {
  const stopping = tracker.concurrentLiveRunIds({ conversationId, runId }).filter(id => {
    let cancelled = false;
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
  emit(args: { runId: string; input: { event: 'error'; data: { message: string } } }): Promise<unknown>;
  finish(input: { runId: string; status: 'failed'; code: null; signal: null; resumable: false }): Promise<unknown>;
}
export async function failRunBeforeStart({ lifecycle, runId, message }: { lifecycle: FailingRunLifecycle; runId: string; message: string }): Promise<void> {
  try { await lifecycle.emit({ runId: runId, input: { event: 'error', data: { message } } }); } catch { /* Finishing remains mandatory. */ }
  await lifecycle.finish({ runId, status: 'failed', code: null, signal: null, resumable: false });
}

export interface AgentCapabilities { readonly resumesSessionViaCli?: boolean; readonly resumesSessionViaAcpLoad?: boolean; readonly capturesSessionIdFromStream?: boolean }
export interface AgentCapabilityResolver { lookup(args: { agentId: string }): AgentCapabilities | undefined }
export function agentAcceptsHostMintedSessionId({ agentId, agents }: { agentId: string; agents: AgentCapabilityResolver }): boolean {
  const def = agents.lookup({ agentId });
  return Boolean(def?.resumesSessionViaCli) && !def?.capturesSessionIdFromStream;
}
export function agentCarriesOwnMemory({ agentId, agents }: { agentId: string; agents: AgentCapabilityResolver }): boolean {
  const def = agents.lookup({ agentId });
  return Boolean(def?.resumesSessionViaCli) || Boolean(def?.resumesSessionViaAcpLoad);
}
export function resolveHostMintedSessionId(input: { conversationId: string | undefined; effectiveResumeSessionId: string | null; acceptsHostMintedSessionId: boolean; mint: () => string }): string | null {
  return input.conversationId !== undefined && input.effectiveResumeSessionId === null && input.acceptsHostMintedSessionId ? input.mint() : null;
}
export function resolveNewSessionField({ hostMintedSessionId }: { hostMintedSessionId: string | null }): { newSessionId?: string } {
  return hostMintedSessionId !== null ? { newSessionId: hostMintedSessionId } : {};
}
export function resolveResumeSessionField({ storedSessionId }: { storedSessionId: string | null }): { resumeSessionId?: string } {
  return storedSessionId !== null ? { resumeSessionId: storedSessionId } : {};
}
export function extractSessionRefFromEndEvent({ event }: { event: RunProtocolEvent }): string | undefined {
  if (event.kind !== 'end') return undefined;
  const id = event.payload.sessionRef;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}
export function shouldClearSessionOnFailedResume({ event, attemptedResumeSessionId }: { event: RunProtocolEvent; attemptedResumeSessionId: string | null }): boolean {
  return attemptedResumeSessionId !== null && event.kind === 'end' && extractSessionRefFromEndEvent({ event }) === undefined;
}
export function wouldForcedColdStartLoseConversationContext(input: { storedSessionId: string | null; hasConcurrentLiveRun: boolean; carriesOwnMemory: boolean }): boolean {
  return input.storedSessionId !== null && input.hasConcurrentLiveRun && input.carriesOwnMemory;
}
