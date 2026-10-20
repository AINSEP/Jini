import { afterEach, expect, it, vi } from 'vitest';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

// Postgres runs the snapshot reads under the run lock only, so a chat deletion can cascade
// between the row read and the transcript read; the transcript is then missing the message.
const dropFromTranscript = vi.hoisted(() => ({ id: '' }));
vi.mock('../chat-history-store.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../chat-history-store.js')>();
  return { ...original, createChatHistoryStore: (...args: Parameters<typeof original.createChatHistoryStore>) => {
    const store = original.createChatHistoryStore(...args);
    return { ...store, messages: async (...input: Parameters<typeof store.messages>) =>
      (await store.messages(...input)).filter(message => message.id !== dropFromTranscript.id) };
  } };
});
const { createChatHistoryStore } = await import('../chat-history-store.js');
const { createDurableRunStore } = await import('../durable-run-store.js');

let f: RuntimeFixture;
afterEach(() => { dropFromTranscript.id = ''; f?.close(); });

it('load returns null when the message vanished from the transcript between reads', async () => {
  f = runtimeFixture();
  const isDaemonRunId = () => true;
  const history = createChatHistoryStore({ kernel: f.kernel, scope: { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' }, isDaemonRunId });
  await history.create({ id: 'c' });
  await history.appendMessage({ conversationId: 'c', message: { id: 'a1', role: 'assistant', content: '', runId: 'daemon-1', runStatus: 'running' } });
  const store = createDurableRunStore({ kernel: f.kernel, isDaemonRunId });
  expect((await store.load({ messageId: 'a1' }, {}))?.messageId).toBe('a1');
  dropFromTranscript.id = 'a1';
  expect(await store.load({ messageId: 'a1' }, {})).toBeNull();
});
