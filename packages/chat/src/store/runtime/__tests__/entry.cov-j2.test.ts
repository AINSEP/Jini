import { afterEach, describe, expect, it } from 'vitest';
import * as entry from '../entry.js';
import * as durableRunStore from '../durable-run-store.js';
import * as runLedger from '../run-ledger.js';
import * as chatHistoryStore from '../chat-history-store.js';
import * as runGuarded from '../run-guarded-chat-store.js';
import * as expirySweep from '../chat-expiry-sweep.js';
import * as historyTools from '../history-tools.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

let f: RuntimeFixture;
afterEach(() => { f?.close(); });

describe('store/runtime entry', () => {
  it('re-exports every runtime value of its implementation modules unchanged, and nothing else', () => {
    const modules = [durableRunStore, runLedger, chatHistoryStore, runGuarded, expirySweep, historyTools];
    const expected = Object.fromEntries(modules.flatMap((module) => Object.entries(module)));
    expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, value] of Object.entries(expected)) expect(entry).toHaveProperty(name, value);
  });

  it('assembles a guarded, owner-scoped transcript over one kernel from the entry alone', async () => {
    f = runtimeFixture();
    const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
    const ledger = entry.createChatRunLedger({ kernel: f.kernel, isDaemonRunId });
    const store = entry.createRunGuardedChatStore({ ledger, isDaemonRunId,
      store: entry.createChatHistoryStore({ kernel: f.kernel, scope: { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' }, isDaemonRunId }) });
    await store.create({ id: 'c' });
    const run = { conversationId: 'c', messageId: 'a1', runId: 'daemon-1' };
    await store.appendMessage({ conversationId: 'c', message: { id: 'a1', role: 'assistant', content: '', runId: 'daemon-1', runStatus: 'queued', createdAt: 1 } });
    expect(await ledger.settle({ ...run, content: 'done', events: [], status: 'succeeded', endedAt: 2 })).toBe(true);
    expect(entry.runLockKey(run)).toBe('chat-run:c:a1');
    expect((await store.messages({ conversationId: 'c' }))[0]).toMatchObject({ content: 'done', runStatus: 'succeeded' });
  });
});
