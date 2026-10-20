import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { ChatMessage } from '../../../core/index.js';
import type { ChatDatabase } from '../kernel.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
let f: RuntimeFixture;
afterEach(() => { vi.restoreAllMocks(); f?.close(); });

async function transcript(rows: ChatMessage[]): Promise<string[]> {
  f = runtimeFixture();
  const store = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 5 });
  await store.create({ id: 'c' });
  for (const message of rows) await store.appendMessage({ conversationId: 'c', message });
  return (await store.messages({ conversationId: 'c' })).map(message => message.id);
}
const user = (id: string, createdAt: number): ChatMessage => ({ id, role: 'user', content: id, createdAt });
const answer = (id: string, createdAt: number, runId?: string): ChatMessage =>
  ({ id, role: 'assistant', content: id, createdAt, ...(runId ? { runId, runStatus: 'succeeded' } : {}) });

describe('createChatHistoryStore legacy turn repair', () => {
  it('moves an orphan daemon answer after the earlier-clock question that follows it', async () => {
    expect(await transcript([answer('a', 10, 'daemon-1'), user('q', 9)])).toEqual(['q', 'a']);
  });
  it('repairs an equal-clock question too', async () => {
    expect(await transcript([answer('a', 10, 'daemon-1'), user('q', 10)])).toEqual(['q', 'a']);
  });
  it('keeps an answer that a preceding question already owns', async () => {
    expect(await transcript([user('q0', 1), answer('a', 10, 'daemon-1'), user('q', 9)])).toEqual(['q0', 'a', 'q']);
  });
  it('keeps a request-bound (non-daemon) answer in stored order', async () => {
    expect(await transcript([answer('a', 10, 'browser-1'), user('q', 9)])).toEqual(['a', 'q']);
  });
  it('keeps an answer without a run id in stored order', async () => {
    expect(await transcript([answer('a', 10), user('q', 9)])).toEqual(['a', 'q']);
  });
  it('keeps a later-clock follow-up question after the answer', async () => {
    expect(await transcript([answer('a', 10, 'daemon-1'), user('q', 11)])).toEqual(['a', 'q']);
  });
  it('keeps an orphan answer followed by another answer', async () => {
    expect(await transcript([answer('a', 10, 'daemon-1'), answer('b', 9, 'daemon-2')])).toEqual(['a', 'b']);
  });
  it('keeps a trailing orphan answer with no following row', async () => {
    expect(await transcript([user('q0', 1), answer('a0', 2), answer('a', 10, 'daemon-1')])).toEqual(['q0', 'a0', 'a']);
  });
  it('repairs consecutive orphan pairs independently', async () => {
    expect(await transcript([answer('a1', 10, 'daemon-1'), user('q1', 9), answer('a2', 20, 'daemon-2'), user('q2', 19)]))
      .toEqual(['q1', 'a1', 'q2', 'a2']);
  });
});

describe('createChatHistoryStore construction', () => {
  it('stamps rows with the injected clock', async () => {
    f = runtimeFixture();
    const store = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1234 });
    expect((await store.create({ id: 'c' })).createdAt).toBe(1234);
  });
  it('defaults the clock to Date.now', async () => {
    f = runtimeFixture();
    vi.spyOn(Date, 'now').mockReturnValue(4321);
    const store = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId });
    expect((await store.create({ id: 'c' })).createdAt).toBe(4321);
  });
  it.each(['pglite', 'pglite-socket', 'node-postgres'] as const)('routes a postgres %s kernel to its adapter without SQL', (transport) => {
    f = runtimeFixture();
    const run = vi.spyOn(f.kernel, 'run');
    const kernel: StorageKernel<ChatDatabase> = { ...f.kernel, dialect: 'postgres', transport };
    expect(typeof createChatHistoryStore({ kernel, scope, isDaemonRunId }).messages).toBe('function');
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['pglite', 'pglite-socket', 'node-postgres'] as const)('a sqlite-dialect %s kernel is refused by the selected postgres adapter', (transport) => {
    f = runtimeFixture();
    const kernel: StorageKernel<ChatDatabase> = { ...f.kernel, transport };
    expect(() => createChatHistoryStore({ kernel, scope, isDaemonRunId })).toThrow('Invalid chat store input.');
  });
});
