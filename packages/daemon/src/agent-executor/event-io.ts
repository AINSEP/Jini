import { appendSerialTask } from '@jini-ai/core/primitives';
import { createMessageRelay } from './message-relay.js';
import type { RunMessageRelay } from './message-relay.js';
import type { ChildProcess } from 'node:child_process';
import type { JournalEntry, RunAgentPayload } from '@jini-ai/protocol';

// A late emit can race a terminal run. Keep later events/cleanup ordered even after failure;
// lifecycle exceptions can contain provider text, so report only this fixed diagnostic.
function reportDroppedEmit(): void {
  console.warn('[daemon] Queued lifecycle event could not be delivered.');
}

/**
 * Gap 1's byte-journal record for bytes the host sent to the child's stdin — always `trust:
 * 'trusted'`, since these are bytes this driver itself composed and wrote, not agent output. See
 * `packages/daemon/src/continuation/journal.ts`'s module doc.
 */
export function sentJournalEntry(content: string): JournalEntry {
  return { content, provenance: { source: 'host', channel: 'stdin' }, trust: 'trusted' };
}

/**
 * Gap 1's byte-journal record for bytes a child agent process produced on `channel` — always
 * `trust: 'untrusted'`, since this is attacker-influenceable agent output the kernel does not
 * control (see `@jini-ai/protocol`'s `JournalEntry` doc on why `trust` exists).
 */
export function receivedJournalEntry(channel: 'stdout' | 'stderr', content: string): JournalEntry {
  return { content, provenance: { source: 'agent', channel }, trust: 'untrusted' };
}

/** Install once on a driver's FIFO; close synchronously before any terminal handler yields.
 * Native runs omit registration, so they allocate no relay and emit only CLI receipts. */
export function attachMessageRelay({ register, emit, child }: {
  register: ((relay: RunMessageRelay) => void) | undefined;
  emit: (payload: RunAgentPayload) => void; child: ChildProcess;
}, _options = {}): RunMessageRelay | undefined {
  if (!register) return undefined;
  const relay = createMessageRelay({ emit });
  register(relay);
  child.once('close', () => relay.close());
  return relay;
}

export function createRunEventQueue(_required: Record<string, never>, _options = {}) {
  let emitQueue: Promise<void> = Promise.resolve();

  function enqueueEmit(task: () => Promise<unknown>): void {
    emitQueue = appendSerialTask({ previous: emitQueue, task, onError: reportDroppedEmit });
  }

  return { enqueueEmit, getTail: () => emitQueue };
}
