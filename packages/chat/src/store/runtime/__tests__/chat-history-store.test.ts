import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { ChatMessage } from '../../../core/index.js';
import type { ChatDatabase } from '../kernel.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createSqlChatStore } from '../../sql/store.js';
import { createRunGuardedChatStore } from '../run-guarded-chat-store.js';
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


async function responseText(chunks: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) text += chunk;
  return text;
}

describe('history read allocation boundaries', () => {
  it('does not parse unused events and omits their column from the SQL projection', async () => {
    f = runtimeFixture();
    const store = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId });
    await store.create({ id: 'c' });
    await store.appendMessage({ conversationId: 'c', message: { ...answer('a', 1), events: [{ kind: 'text', text: 'large saved body' }] } });
    const saved = f.rows<{ events_json: string }>('SELECT events_json FROM ai_chat_messages')[0]!.events_json;
    const parse = vi.spyOn(JSON, 'parse');
    const queries: string[] = [];
    const originalRun = f.kernel.run;
    vi.spyOn(f.kernel, 'run').mockImplementation(body => originalRun(db => body(db.withPlugin({
      transformQuery: ({ node }) => { queries.push(JSON.stringify(node)); return node; },
      transformResult: async ({ result }) => result,
    }))));
    expect(await store.messages({ conversationId: 'c' }, { includeEvents: false })).toEqual([answer('a', 1)]);
    expect(parse.mock.calls.some(([value]) => value === saved)).toBe(false);
    expect(queries.some(query => query.includes('m.events_json') || query.includes('"kind":"ColumnNode","column":{"kind":"IdentifierNode","name":"events_json"}'))).toBe(false);
  });

  it('reads only the requested owned message', async () => {
    f = runtimeFixture();
    const store = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId });
    await store.create({ id: 'c' });
    await store.appendMessage({ conversationId: 'c', message: answer('a', 1) });
    await store.appendMessage({ conversationId: 'c', message: answer('b', 2) });
    expect(await store.message!({ conversationId: 'c', messageId: 'b' })).toEqual(answer('b', 2));
    expect(await store.message!({ conversationId: 'missing', messageId: 'b' })).toBeNull();
    const other = createChatHistoryStore({ kernel: f.kernel, scope: { ...scope, ownerId: 'bob' }, isDaemonRunId });
    expect(await other.message!({ conversationId: 'c', messageId: 'b' })).toBeNull();
  });

  it('streams SQLite assistant JSON without parsing it and preserves folders, repaired order and malformed omission', async () => {
    f = runtimeFixture();
    const store = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId });
    await store.create({ id: 'c' });
    const events = [{ kind: 'text', text: 'opaque assistant body' },
      { kind: 'tool_use', id: 'folders-tool', name: 'inspect', input: { folders: ['/tool/input'] } }] as const;
    await store.appendMessage({ conversationId: 'c', message: { ...answer('a', 10, 'daemon-1'), events: [...events] } });
    await store.appendMessage({ conversationId: 'c', message: { ...user('q', 9), folders: ['/saved/workspace'] } });
    await store.appendMessage({ conversationId: 'c', message: answer('broken', 11) });
    f.sql('UPDATE ai_chat_messages SET events_json = ? WHERE id = ?', '{broken', 'broken');
    const expected = await store.messages({ conversationId: 'c' });
    const eventJson = JSON.stringify(events);
    const parse = vi.spyOn(JSON, 'parse');
    const chunks = await store.messagesJson!({ conversationId: 'c' });
    const actual = await responseText(chunks);
    expect(parse.mock.calls.some(([value]) => value === eventJson)).toBe(false);
    expect(JSON.parse(actual)).toEqual({ messages: expected });
    expect(expected[0]?.folders).toEqual(['/saved/workspace']);
    const other = createChatHistoryStore({ kernel: f.kernel, scope: { ...scope, ownerId: 'bob' }, isDaemonRunId });
    expect(await responseText(await other.messagesJson!({ conversationId: 'c' }))).toBe('{"messages":[]}');
  });

  it('validates PostgreSQL 14 raw JSON one row at a time and omits malformed events', async () => {
    f = runtimeFixture();
    // The query uses portable SQL here; this exercises the PG14 validation policy without a server.
    const store = createSqlChatStore({ kernel: { ...f.kernel, dialect: 'postgres' }, scope });
    await store.create({ id: 'c' });
    await store.appendMessage({ conversationId: 'c', message: { ...answer('a', 1), events: [{ kind: 'text', text: 'saved' }] } });
    await store.appendMessage({ conversationId: 'c', message: answer('b', 2) });
    f.sql('UPDATE ai_chat_messages SET events_json = ? WHERE id = ?', '{broken', 'b');
    const expected = await store.messages({ conversationId: 'c' });
    const parse = vi.spyOn(JSON, 'parse');
    const chunks = await store.messagesJson!({ conversationId: 'c' });
    expect(parse.mock.calls.some(([value]) => value === '[{"kind":"text","text":"saved"}]')).toBe(false);
    const actual = await responseText(chunks);
    expect(parse.mock.calls.some(([value]) => value === '[{"kind":"text","text":"saved"}]')).toBe(true);
    expect(JSON.parse(actual)).toEqual({ messages: expected });
  });

  it('uses a single-row lookup for guarded daemon browser saves', async () => {
    const saved = answer('a', 1, 'daemon-1');
    const message = vi.fn(async () => saved);
    const messages = vi.fn(async () => { throw new Error('whole transcript read'); });
    const store = createRunGuardedChatStore({ store: { message, messages } as never, isDaemonRunId,
      ledger: { unlessSettled: async ({ write }: { write: () => Promise<ChatMessage> }) => ({ written: true, value: await write() }) } as never });
    expect(await store.appendMessage({ conversationId: 'c', message: saved })).toEqual(saved);
    expect(message).toHaveBeenCalledWith({ conversationId: 'c', messageId: 'a' }, {});
    expect(messages).not.toHaveBeenCalled();
  });
});


it('history versions are owner-scoped, parse-free and change on equal-length replacements', async () => {
  f = runtimeFixture();
  const store = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 5 });
  await store.create({ id: 'c' });
  await store.appendMessage({ conversationId: 'c', message: user('u', 1) });
  const version = await store.messagesVersion!({ conversationId: 'c' }, {});
  const parse = vi.spyOn(JSON, 'parse');
  expect(await store.messagesVersion!({ conversationId: 'c' }, {})).toBe(version);
  expect(parse).not.toHaveBeenCalled();
  const other = createChatHistoryStore({ kernel: f.kernel, scope: { ...scope, ownerId: 'bob' }, isDaemonRunId });
  expect(await other.messagesVersion!({ conversationId: 'c' }, {})).toBeNull();
  f.sql("UPDATE ai_chat_messages SET content = 'v' WHERE id = 'u'");
  expect(await store.messagesVersion!({ conversationId: 'c' }, {})).not.toBe(version);
});
