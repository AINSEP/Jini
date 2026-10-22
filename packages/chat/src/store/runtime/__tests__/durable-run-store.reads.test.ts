/**
 * Bound proof for the durable run store's guard reads: a fence, lock or tool guard on one run
 * parses that run's own rows only, never every message's events in its conversation.
 * The JSON.parse count per call is the observable: it must not grow with the conversation.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPgliteKernel } from '@jini-ai/db/kernel/pglite';
import type { ChatDatabase } from '../kernel.js';
import type { DurableRunStore } from '../../../core/durable-runs/ports.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createDurableRunStore } from '../durable-run-store.js';
import { RUN_DDL, runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

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

describe('head reads and the SQL event append', () => {
  const eventsJson = () => f.rows<{ events_json: string | null }>("SELECT events_json FROM ai_chat_messages WHERE id = 'a1'")[0]!.events_json;
  const result = { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false };

  it('find returns the run with its own events and no transcript; load keeps the transcript', async () => {
    const store = await conversation({ turns: 2 });
    f.sql(`UPDATE ai_chat_messages SET events_json = '[{"kind":"text","text":"a"}]' WHERE id = 'a1'`);
    const head = await store.find({ runId: 'daemon-1' }, {});
    expect(head?.message.events).toEqual([{ kind: 'text', text: 'a' }]);
    expect(head).not.toHaveProperty('transcript');
    const run = await store.load({ messageId: 'a1' }, {});
    expect(run?.transcript.map((message) => message.id)).toEqual(['q0', 'r0', 'q1', 'r1', 'u1', 'a1']);
    expect(run?.message).toEqual(head?.message);
  });

  it('find reads a run deleted between its probe and its lock as gone', async () => {
    const store = await conversation({ turns: 0 });
    const lockKey = f.kernel.lockKey.bind(f.kernel);
    vi.spyOn(f.kernel, 'lockKey').mockImplementation(async (key) => {
      if (key.startsWith('chat-run:')) f.sql("DELETE FROM ai_chat_messages WHERE id = 'a1'");
      return lockKey(key);
    });
    expect(await store.find({ runId: 'daemon-1' }, {})).toBeNull();
  });

  it('appends to a saved array byte-for-byte as JSON.stringify of the appended array would', async () => {
    const store = await conversation({ turns: 0 });
    const saved = [{ kind: 'text', text: 'a "quoted" é\n' }, { kind: 'status', label: 'x' }];
    f.sql('UPDATE ai_chat_messages SET events_json = ? WHERE id = ?', JSON.stringify(saved), 'a1');
    await store.completeTool({ runId: 'daemon-1', toolUseId: 't1', content: 'ok' }, {});
    expect(eventsJson()).toBe(JSON.stringify([...saved, result]));
  });

  it.each([['an empty array', '[]'], ['no saved events', null], ['a truncated value', '[{"kind":"text"'], ['a non-array value', '{}']])(
    'starts a new array over %s', async (_label, saved) => {
      const store = await conversation({ turns: 0 });
      f.sql('UPDATE ai_chat_messages SET events_json = ? WHERE id = ?', saved, 'a1');
      await store.completeTool({ runId: 'daemon-1', toolUseId: 't1', content: 'ok' }, {});
      expect(eventsJson()).toBe(JSON.stringify([result]));
    });
});

describe('the SQL event append on PostgreSQL (PGlite)', () => {
  it('appends byte-for-byte and starts a new array over an empty one', async () => {
    const { PGlite } = createRequire(new URL('../../../../../db/package.json', import.meta.url))('@electric-sql/pglite');
    const kernel = openPgliteKernel<ChatDatabase>({ PGlite });
    try {
      // Epoch-millisecond clocks need BIGINT on PostgreSQL; SQLite's INTEGER is already 64-bit.
      const ddl = readFileSync(new URL('../../__tests__/pg-schema.sql', import.meta.url), 'utf8') + RUN_DDL.replaceAll('INTEGER', 'BIGINT');
      for (const statement of ddl.split(';').map((text) => text.trim()).filter(Boolean)) await kernel.execute(sql.raw(statement));
      const history = createChatHistoryStore({ kernel, scope, isDaemonRunId }, { now: () => 1 });
      await history.create({ id: 'c' });
      const store = createDurableRunStore({ kernel, isDaemonRunId });
      await store.accept({ conversationId: 'c', messageId: 'a1', runId: 'daemon-1', principalId: 'alice', workspaceId: 'ws', now: 100,
        request: { contextRef: JSON.stringify({ prompt: 'p' }) } }, {});
      const saved = async () => (await kernel.run((db) => db.selectFrom('ai_chat_messages').select('events_json').where('id', '=', 'a1').executeTakeFirstOrThrow())).events_json;
      const use = { kind: 'tool_use', id: 't1', name: 'write', input: { a: 'é "q"' } };
      expect(await store.guardTool({ runId: 'daemon-1', toolId: 'write', input: use.input, toolUseId: 't1' }, {})).toBe('allowed');
      expect(await saved()).toBe(JSON.stringify([use]));
      await store.completeTool({ runId: 'daemon-1', toolUseId: 't1', content: 'ok' }, {});
      expect(await saved()).toBe(JSON.stringify([use, { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false }]));
    } finally { await kernel.close(); }
  });
});
