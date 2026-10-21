/**
 * Bound proof for the durable run store's guard reads: a fence, lock or tool guard on one run
 * parses that run's own rows only, never every message's events in its conversation.
 * The JSON.parse count per call is the observable: it must not grow with the conversation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DurableRunStore } from '../../../core/durable-runs/ports.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createDurableRunStore } from '../durable-run-store.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
let f: RuntimeFixture;
afterEach(() => { vi.restoreAllMocks(); f?.close(); });

/** A conversation of `turns` finished question/answer pairs, then one accepted daemon run `daemon-1`. */
async function conversation({ turns }: { turns: number }): Promise<DurableRunStore> {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 });
  await history.create({ id: 'c' });
  for (let turn = 0; turn < turns; turn++) {
    await history.appendMessage({ conversationId: 'c', message: { id: `q${turn}`, role: 'user', content: 'q', createdAt: turn } });
    await history.appendMessage({ conversationId: 'c', message: { id: `r${turn}`, role: 'assistant', content: 'r', createdAt: turn,
      runId: `daemon-old-${turn}`, runStatus: 'succeeded', events: [{ kind: 'text', text: 'r' }] } });
  }
  const store = createDurableRunStore({ kernel: f.kernel, isDaemonRunId });
  await store.accept({ conversationId: 'c', messageId: 'a1', runId: 'daemon-1', principalId: 'alice', workspaceId: 'ws', now: 100,
    request: { agentId: 'codex', contextRef: JSON.stringify({ userMessage: { id: 'u1', role: 'user', content: 'hi', createdAt: 99 } }) } }, {});
  return store;
}

/** JSON.parse calls made while `operation` runs. */
async function parses(operation: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(JSON, 'parse');
  try { await operation(); return spy.mock.calls.length; } finally { spy.mockRestore(); }
}

/** One per-turn call sequence: the daemon's session captures, a delegated tool guard, its completion. */
async function perCallParses({ turns }: { turns: number }): Promise<Record<string, number>> {
  const store = await conversation({ turns });
  return {
    find: await parses(() => store.find({ runId: 'daemon-1' }, {})),
    captureSession: await parses(() => store.captureSession({ runId: 'daemon-1', sessionId: 's1' }, {})),
    guardTool: await parses(() => store.guardTool({ runId: 'daemon-1', toolId: 'write', input: {}, toolUseId: 't1' }, {})),
    completeTool: await parses(() => store.completeTool({ runId: 'daemon-1', toolUseId: 't1', content: 'ok' }, {})),
    clearSession: await parses(() => store.clearSession({ runId: 'daemon-1', sessionId: 's1' }, {})),
    recoveryClock: await parses(() => store.recoveryClock({ runId: 'daemon-1', now: 200, active: true }, {})),
    cancel: await parses(() => store.cancel({ runId: 'daemon-1', reason: 'user-stop' }, {})),
  };
}

describe('guard reads are bounded by the run, not the conversation', () => {
  it('parses the same number of JSON values per call for 10 and 200 prior turns', async () => {
    const small = await perCallParses({ turns: 10 });
    const large = await perCallParses({ turns: 200 });
    expect(large).toEqual(small);
    // A few fixed values each: the run's own events/attachments, accepted request, attempt base, context.
    for (const count of Object.values(large)) expect(count).toBeLessThanOrEqual(6);
  });
});
