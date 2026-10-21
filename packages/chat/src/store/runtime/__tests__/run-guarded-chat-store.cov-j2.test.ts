import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import type { ChatOwnerScope } from '../../ports.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createChatRunLedger } from '../run-ledger.js';
import { createRunGuardedChatStore } from '../run-guarded-chat-store.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const alice: ChatOwnerScope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' };
const mallory: ChatOwnerScope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'mallory' };
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');

let f: RuntimeFixture;
afterEach(() => { f?.close(); });

async function setup() {
  f = runtimeFixture();
  const ledger = createChatRunLedger({ kernel: f.kernel, isDaemonRunId });
  const guarded = (scope: ChatOwnerScope = alice) =>
    createRunGuardedChatStore({ store: createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 }), ledger, isDaemonRunId });
  const store = guarded();
  await store.create({ id: 'c' });
  return { ledger, store, guarded };
}
const answer = (over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: 'a1', role: 'assistant', content: 'answer', events: [], runId: 'daemon-1', runStatus: 'running', createdAt: 2, ...over });
const stored = () => f.rows<{ content: string; run_status: string | null; run_id: string | null }>('SELECT content, run_status, run_id FROM ai_chat_messages WHERE id = ?', 'a1')[0];

describe('createRunGuardedChatStore', () => {
  it('keeps every other store method and passes user turns and run-less answers straight through', async () => {
    const { store } = await setup();
    expect((await store.get({ id: 'c' }))?.id).toBe('c');
    expect(await store.appendMessage({ conversationId: 'c', message: { id: 'u1', role: 'user', content: 'hi', createdAt: 1 } })).toMatchObject({ id: 'u1', role: 'user' });
    const { runId: _runId, runStatus: _runStatus, ...runless } = answer();
    expect(await store.appendMessage({ conversationId: 'c', message: runless })).toMatchObject({ id: 'a1', content: 'answer' });
    expect((await store.messages({ conversationId: 'c' })).map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('lets acceptance write a queued daemon stub, then fences later daemon snapshots to the stored row', async () => {
    const { store } = await setup();
    expect(await store.appendMessage({ conversationId: 'c', message: answer({ content: '', runStatus: 'queued' }) })).toMatchObject({ runStatus: 'queued' });
    const replay = await store.appendMessage({ conversationId: 'c', message: answer({ runId: 'daemon-old', content: 'browser copy', runStatus: 'failed' }) });
    expect(replay).toMatchObject({ id: 'a1', content: '', runId: 'daemon-1', runStatus: 'queued' });
    expect(stored()).toEqual({ content: '', run_status: 'queued', run_id: 'daemon-1' });
  });

  it('refuses a browser-created terminal daemon row the server never accepted', async () => {
    const { store } = await setup();
    expect(await store.appendMessage({ conversationId: 'c', message: answer({ runStatus: 'failed' }) })).toBeNull();
    expect(stored()).toBeUndefined();
  });

  it('keeps browser writes for request-bound (non-daemon) runs until they settle', async () => {
    const { store } = await setup();
    await store.appendMessage({ conversationId: 'c', message: answer({ runId: 'byok-1', content: 'draft' }) });
    expect(await store.appendMessage({ conversationId: 'c', message: answer({ runId: 'byok-1', content: 'final', runStatus: 'succeeded' }) }))
      .toMatchObject({ content: 'final', runStatus: 'succeeded' });
    expect(stored()).toEqual({ content: 'final', run_status: 'succeeded', run_id: 'byok-1' });
  });

  it('returns the first terminal write instead of replacing it, and null to a caller that does not own the chat', async () => {
    const { store, ledger, guarded } = await setup();
    await store.appendMessage({ conversationId: 'c', message: answer({ content: '', runStatus: 'queued' }) });
    expect(await ledger.settle({ conversationId: 'c', messageId: 'a1', runId: 'daemon-1', content: 'finalized', events: [], status: 'succeeded', endedAt: 5 })).toBe(true);
    const late = answer({ content: '', runStatus: 'failed', events: [] });
    expect(await store.appendMessage({ conversationId: 'c', message: late })).toMatchObject({ content: 'finalized', runStatus: 'succeeded' });
    expect(await guarded(mallory).appendMessage({ conversationId: 'c', message: late })).toBeNull();
    expect(stored()).toEqual({ content: 'finalized', run_status: 'succeeded', run_id: 'daemon-1' });
  });
});
