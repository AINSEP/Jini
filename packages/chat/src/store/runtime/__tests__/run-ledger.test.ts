import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { openPgliteKernel } from '@jini-ai/db/kernel/pglite';
import type { ChatDatabase } from '../kernel.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import type { ChatRunLedger, CheckpointState, InterruptedChatTurn, RunProgress } from '../../../core/durable-runs/ledger-contracts.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createChatRunLedger } from '../run-ledger.js';
import { RUN_DDL, runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

/**
 * @file `createChatRunLedger` over a real in-memory SQLite kernel: checkpoint/settle/reconcile
 * semantics, plus the memory bounds of a checkpoint (memory cause 3: a multi-MB `events_json`
 * re-parsed twice and rewritten every second).
 */

const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
const run = { conversationId: 'c', messageId: 'a1', runId: 'daemon-1' } as const;
let f: RuntimeFixture;
afterEach(() => { vi.restoreAllMocks(); f?.close(); });

async function setup(message: Partial<ChatMessage> = {}, { dropRunId = false }: { dropRunId?: boolean } = {}): Promise<ChatRunLedger> {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 });
  await history.create({ id: 'c' });
  const seeded: ChatMessage = { id: 'a1', role: 'assistant', content: 'saved', runId: 'daemon-1', runStatus: 'running', createdAt: 50,
    events: [{ kind: 'text', text: 'saved' }], ...message };
  if (dropRunId) delete seeded.runId;
  await history.appendMessage({ conversationId: 'c', message: seeded });
  f.sql(`INSERT INTO assistant_run_attempts (message_id, engine, accepted_json, recovery_count, recovery_elapsed_ms,
    attempt_started_at, last_progress_at, session_confirmed, attempt_base_json) VALUES ('a1', 'daemon', '{}', 3, 9, 1, 1, 0, '[]')`);
  return createChatRunLedger({ kernel: f.kernel, isDaemonRunId });
}
interface Row { content: string; events_json: string | null; run_status: string | null; ended_at: number | null; run_id: string | null }
const row = (): Row => f.rows<Row>('SELECT * FROM ai_chat_messages WHERE id = ?', 'a1')[0]!;
const events = (): AgentEvent[] => JSON.parse(row().events_json ?? 'null');
const recoveryCount = () => f.rows<{ recovery_count: number }>('SELECT recovery_count FROM assistant_run_attempts')[0]!.recovery_count;
/** Rows changed by INSERT/UPDATE/DELETE on this connection so far: the write counter. */
const writes = () => f.rows<{ n: number }>('SELECT total_changes() AS n')[0]!.n;
const progress = (over: Partial<RunProgress> = {}): RunProgress => ({ ...run, content: 'saved more', events: [{ kind: 'text', text: 'saved more' }], ...over });
const toolUse = (id: string, input: Record<string, unknown> = {}): AgentEvent => ({ kind: 'tool_use', id, name: 'Read', input });
const toolResult = (toolUseId: string): AgentEvent => ({ kind: 'tool_result', toolUseId, content: 'ok', isError: false });
/** Makes the kernel's next UPDATE of `ai_chat_messages` report zero matched rows, as a lost race would. */
function missNextMessageUpdate(): void {
  const original = f.kernel.run.bind(f.kernel);
  let missed = false;
  vi.spyOn(f.kernel, 'run').mockImplementation(async (work) => {
    if (!missed && work.toString().includes('updateTable("ai_chat_messages")')) {
      missed = true;
      return (work.toString().includes('.returning(') ? undefined : { numUpdatedRows: 0n }) as never;
    }
    return original(work);
  });
}

describe('checkpoint memory bound (cause 3)', () => {
  it('parses the saved events_json once per checkpoint, even while only tools progress', async () => {
    const ledger = await setup({ events: [{ kind: 'text', text: 'saved' }, toolUse('t1')] });
    const parse = vi.spyOn(JSON, 'parse');
    // Equal text, a new tool result: the tool-heavy phase where the progress check needs the saved events.
    expect(await ledger.checkpoint(progress({ content: 'saved', events: [{ kind: 'text', text: 'saved' }, toolUse('t1'), toolResult('t1')] }))).toBe(true);
    // Before the fix: 2 (readEvents for the merge, and again for hasNewToolProgress). After: 1.
    expect(parse).toHaveBeenCalledTimes(1);
    expect(recoveryCount()).toBe(0);
  });

  it('does not rewrite the row for an identical checkpoint, and still accepts it', async () => {
    const ledger = await setup();
    expect(await ledger.checkpoint(progress())).toBe(true);
    const before = writes();
    expect(await ledger.checkpoint(progress())).toBe(true);
    // Before the fix: 1 changed row (the same multi-MB column written again). After: 0.
    expect(writes() - before).toBe(0);
    expect(row()).toMatchObject({ content: 'saved more', run_status: 'running' });
    expect(events()).toEqual([{ kind: 'text', text: 'saved more' }]);
  });

  it('still writes an identical projection that moves a queued row to running', async () => {
    const ledger = await setup({ runStatus: 'queued', content: 'saved more', events: [{ kind: 'text', text: 'saved more' }] });
    const before = writes();
    expect(await ledger.checkpoint(progress())).toBe(true);
    expect(writes() - before).toBe(1);
    expect(row().run_status).toBe('running');
    expect(recoveryCount()).toBe(3);
  });
});

describe('checkpoint', () => {
  it('rejects a shorter replay, a terminal row and another run', async () => {
    const ledger = await setup();
    expect(await ledger.checkpoint(progress({ content: 'sav' }))).toBe(false);
    expect(await ledger.checkpoint(progress({ runId: 'daemon-2' }))).toBe(false);
    f.sql("UPDATE ai_chat_messages SET run_status = 'succeeded'");
    expect(await ledger.checkpoint(progress())).toBe(false);
    expect(row().content).toBe('saved');
  });

  it('a replayed prefix of equal length is saved but earns no recovery budget', async () => {
    const ledger = await setup({ events: [{ kind: 'text', text: 'saved' }, toolUse('t1')] });
    expect(await ledger.checkpoint(progress({ content: 'saved', events: [{ kind: 'text', text: 'saved' }, { kind: 'status', label: 'Continuing' }] }))).toBe(true);
    expect(recoveryCount()).toBe(3);
    // The saved tool barrier absent from the replay is kept, after the replay's events.
    expect(events()).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'status', label: 'Continuing' }, toolUse('t1')]);
  });

  it('new tool progress without new text resets the recovery budget', async () => {
    const ledger = await setup();
    expect(await ledger.checkpoint(progress({ content: 'saved', events: [{ kind: 'text', text: 'saved' }, toolUse('t9')] }))).toBe(true);
    expect(recoveryCount()).toBe(0);
  });

  it('keeps one persisted use per tool id when a legacy checkpoint repeats it with other input', async () => {
    const ledger = await setup({ events: [toolUse('t1', { a: 1 }), toolUse('t1', { a: 2 }), toolResult('t1')] });
    expect(await ledger.checkpoint(progress({ events: [{ kind: 'text', text: 'saved more' }] }))).toBe(true);
    expect(events()).toEqual([{ kind: 'text', text: 'saved more' }, toolUse('t1', { a: 1 }), toolResult('t1')]);
  });

  it.each([['missing', null], ['unparseable', '{oops'], ['not an array', '{"kind":"text"}']])('treats %s saved events as none', async (_name, json) => {
    const ledger = await setup();
    f.sql('UPDATE ai_chat_messages SET events_json = ?', json);
    expect(await ledger.checkpoint(progress())).toBe(true);
    expect(events()).toEqual([{ kind: 'text', text: 'saved more' }]);
  });

  it('reports false when the guarded update matched no row', async () => {
    const ledger = await setup();
    missNextMessageUpdate();
    expect(await ledger.checkpoint(progress())).toBe(false);
    expect(recoveryCount()).toBe(3);
  });
});

describe('settle', () => {
  const settlement = { ...run, status: 'succeeded', endedAt: 500 } as const;

  it('writes the longer settlement, keeps saved tool barriers and touches the chat', async () => {
    const ledger = await setup({ events: [{ kind: 'text', text: 'saved' }, toolUse('t1')] });
    expect(await ledger.settle({ ...settlement, content: 'saved and done', events: [{ kind: 'text', text: 'saved and done' }] })).toBe(true);
    expect(row()).toMatchObject({ content: 'saved and done', run_status: 'succeeded', ended_at: 500 });
    expect(events()).toEqual([{ kind: 'text', text: 'saved and done' }, toolUse('t1')]);
    expect(f.rows<{ updated_at: number }>('SELECT updated_at FROM ai_chats')[0]!.updated_at).toBe(500);
    expect(await ledger.settle({ ...settlement, content: 'again', events: [] })).toBe(false);
  });

  it('retains a longer saved checkpoint, merging only non-text settlement events', async () => {
    const ledger = await setup({ content: 'saved long answer', events: [{ kind: 'text', text: 'saved long answer' }] });
    expect(await ledger.settle({ ...settlement, content: 'short', events: [{ kind: 'text', text: 'short' }, { kind: 'status', label: 'done' }] })).toBe(true);
    expect(row().content).toBe('saved long answer');
    expect(events()).toEqual([{ kind: 'text', text: 'saved long answer' }, { kind: 'status', label: 'done' }]);
  });

  it('restores the saved text when neither side carries a text event', async () => {
    const ledger = await setup({ content: 'saved long answer', events: [] });
    expect(await ledger.settle({ ...settlement, content: 'x', events: [{ kind: 'status', label: 'done' }] })).toBe(true);
    expect(events()).toEqual([{ kind: 'text', text: 'saved long answer' }, { kind: 'status', label: 'done' }]);
  });

  it('reports false when the guarded update matched no row', async () => {
    const ledger = await setup();
    missNextMessageUpdate();
    expect(await ledger.settle({ ...settlement, content: 'saved and done', events: [] })).toBe(false);
    expect(f.rows<{ updated_at: number }>('SELECT updated_at FROM ai_chats')[0]!.updated_at).not.toBe(500);
  });
});

describe('unlessSettled', () => {
  it('runs the write only while the row is unsettled', async () => {
    const ledger = await setup();
    expect(await ledger.unlessSettled({ run, write: async () => 7 })).toEqual({ written: true, value: 7 });
    f.sql("UPDATE ai_chat_messages SET run_status = 'canceled'");
    const write = vi.fn(async () => 8);
    expect(await ledger.unlessSettled({ run, write })).toEqual({ written: false });
    expect(write).not.toHaveBeenCalled();
  });
});

describe('reconcileInterrupted', () => {
  it('hands adoptable rows to the recovery port with the persisted owner', async () => {
    const ledger = await setup();
    const recover = vi.fn(async () => true);
    expect(await ledger.reconcileInterrupted({}, { recover })).toBe(1);
    expect(recover).toHaveBeenCalledWith({ principalId: 'alice', conversationId: 'c', message: {
      id: 'a1', role: 'assistant', content: 'saved', events: [{ kind: 'text', text: 'saved' }], runId: 'daemon-1', runStatus: 'running',
    } });
  });

  it('gives a guest row no principal and a run-less row no run id', async () => {
    const ledger = await setup({}, { dropRunId: true });
    f.sql("UPDATE ai_chats SET owner_kind = 'guest'");
    const recover = vi.fn(async (_turn: InterruptedChatTurn) => false);
    expect(await ledger.reconcileInterrupted({ now: 9 }, { recover })).toBe(1);
    expect(recover.mock.calls[0]![0]).toMatchObject({ principalId: null });
    expect(recover.mock.calls[0]![0].message).not.toHaveProperty('runId');
    expect(row()).toMatchObject({ run_status: 'canceled', ended_at: 9, run_id: null });
  });

  it('cancels rows nothing adopts, preserving saved work, at the current time by default', async () => {
    const ledger = await setup();
    vi.spyOn(Date, 'now').mockReturnValue(4242);
    expect(await ledger.reconcileInterrupted()).toBe(1);
    expect(row()).toMatchObject({ run_status: 'canceled', ended_at: 4242 });
    expect(events()).toEqual([{ kind: 'text', text: 'saved' }, { kind: 'status', label: 'Stopped. Saved work is above.' }]);
    expect(f.rows<{ updated_at: number }>('SELECT updated_at FROM ai_chats')[0]!.updated_at).toBe(4242);
  });

  it('skips a row that disappeared or was replaced before its cancellation', async () => {
    const ledger = await setup();
    const lockKey = f.kernel.lockKey.bind(f.kernel);
    vi.spyOn(f.kernel, 'lockKey').mockImplementation(async (key) => { f.sql('DELETE FROM ai_chat_messages'); return lockKey(key); });
    expect(await ledger.reconcileInterrupted({ now: 9 })).toBe(0);
  });

  it('does not count a cancellation whose guarded update matched no row', async () => {
    const ledger = await setup();
    missNextMessageUpdate();
    expect(await ledger.reconcileInterrupted({ now: 9 })).toBe(0);
    expect(row().run_status).toBe('running');
  });
});

describe('watch-owned checkpoint deltas', () => {
  let state: CheckpointState | undefined;
  function receipt(): CheckpointState | undefined { return state; }
  async function save(ledger: ChatRunLedger, next: RunProgress) {
    return ledger.checkpoint(next, { expected: state?.length, previous: state, onPersisted: value => { state = value; } });
  }

  it('extends coalesced Unicode text with one delta UPDATE and no saved JSON read/parse', async () => {
    const ledger = await setup();
    state = undefined;
    await save(ledger, progress({ content: 'saved 😀', events: [{ kind: 'text', text: 'saved 😀' }] }));
    expect(receipt()?.length).toBe([...row().events_json!].length);
    const queries: string[] = [];
    const runQuery = f.kernel.run.bind(f.kernel);
    vi.spyOn(f.kernel, 'run').mockImplementation(async work => { queries.push(work.toString()); return runQuery(work); });
    const parse = vi.spyOn(JSON, 'parse');
    await save(ledger, progress({ content: 'saved 😀 more', events: [{ kind: 'text', text: 'saved 😀 more' }] }));
    expect(parse).not.toHaveBeenCalled();
    expect(queries.filter(query => query.includes('selectFrom'))).toHaveLength(0);
    expect(queries.filter(query => query.includes('updateTable("ai_chat_messages")'))).toHaveLength(1);
    expect(row().events_json).toBe(JSON.stringify([{ kind: 'text', text: 'saved 😀 more' }]));
  });

  it('matches full rewrites through coalescing, a concurrent tool append and saved-only barriers', async () => {
    const ledger = await setup();
    state = undefined;
    const sequence = [progress(), progress({ content: 'saved more text', events: [{ kind: 'text', text: 'saved more text' }] })];
    for (const next of sequence) await save(ledger, next);
    await ledger.durable!.completeTool({ runId: run.runId, toolUseId: 'concurrent', content: 'ok' }, {});
    const afterTool = progress({ content: 'saved more text!', events: [{ kind: 'text', text: 'saved more text!' }] });
    const parse = vi.spyOn(JSON, 'parse');
    await save(ledger, afterTool);
    expect(parse).toHaveBeenCalledTimes(1); // length mismatch must read/merge the durable barrier
    expect(state).toBeUndefined(); // saved-only barriers disable the next delta
    parse.mockRestore();
    const final = progress({ content: 'saved more text!!', events: [{ kind: 'text', text: 'saved more text!!' }, toolUse('next')] });
    await save(ledger, final);
    const deltaJson = row().events_json;
    // The same sequence without a receipt always takes the authoritative full path.
    f.sql('UPDATE ai_chat_messages SET content = ?, events_json = ?', 'saved', JSON.stringify([{ kind: 'text', text: 'saved' }]));
    for (const next of sequence) await ledger.checkpoint(next);
    await ledger.durable!.completeTool({ runId: run.runId, toolUseId: 'concurrent', content: 'ok' }, {});
    await ledger.checkpoint(afterTool);
    await ledger.checkpoint(final);
    expect(deltaJson).toBe(row().events_json);
  });

  it('falls back on a same-length tail rewrite and preserves its barrier', async () => {
    const ledger = await setup();
    state = undefined;
    await save(ledger, progress({ events: [{ kind: 'text', text: 'saved more' }, toolUse('a')] }));
    f.sql('UPDATE ai_chat_messages SET events_json = replace(events_json, ?, ?)', '"id":"a"', '"id":"b"');
    await save(ledger, progress({ events: [{ kind: 'text', text: 'saved more' }, toolUse('a'), toolResult('a')] }));
    expect(events()).toEqual([{ kind: 'text', text: 'saved more' }, toolUse('a'), toolResult('a'), toolUse('b')]);
    expect(state).toBeUndefined();
  });
});


describe('checkpoint deltas on PostgreSQL (PGlite)', () => {
  it('uses SQL character lengths for text replacement, appends, and concurrent-barrier fallback', async () => {
    const { PGlite } = createRequire(new URL('../../../../../db/package.json', import.meta.url))('@electric-sql/pglite');
    const kernel = openPgliteKernel<ChatDatabase>({ PGlite });
    try {
      const ddl = readFileSync(new URL('../../__tests__/pg-schema.sql', import.meta.url), 'utf8') + RUN_DDL.replaceAll('INTEGER', 'BIGINT');
      for (const statement of ddl.split(';').map(text => text.trim()).filter(Boolean)) await kernel.execute(sql.raw(statement));
      const history = createChatHistoryStore({ kernel, scope, isDaemonRunId });
      await history.create({ id: 'c' });
      const ledger = createChatRunLedger({ kernel, isDaemonRunId });
      await ledger.durable!.accept({ ...run, principalId: 'alice', workspaceId: 'ws', now: 1, request: { contextRef: '{}' } }, {});
      let state: CheckpointState | undefined;
      const save = (next: RunProgress) => ledger.checkpoint(next, { expected: state?.length, previous: state, onPersisted: value => { state = value; } });
      const saved = async () => (await kernel.run(db => db.selectFrom('ai_chat_messages').select('events_json').where('id', '=', 'a1').executeTakeFirstOrThrow())).events_json;
      await save(progress({ content: '😀', events: [{ kind: 'text', text: '😀' }] }));
      const parse = vi.spyOn(JSON, 'parse');
      await save(progress({ content: '😀 é', events: [{ kind: 'text', text: '😀 é' }] }));
      expect(parse).not.toHaveBeenCalled();
      await save(progress({ content: '😀 é', events: [{ kind: 'text', text: '😀 é' }, toolUse('t1')] }));
      expect(await saved()).toBe(JSON.stringify([{ kind: 'text', text: '😀 é' }, toolUse('t1')]));
      parse.mockRestore();
      await ledger.durable!.completeTool({ runId: run.runId, toolUseId: 't1', content: 'ok' }, {});
      await save(progress({ content: '😀 é!', events: [{ kind: 'text', text: '😀 é' }, toolUse('t1'), { kind: 'text', text: '!' }] }));
      expect(state).toBeUndefined();
      expect(await saved()).toBe(JSON.stringify([{ kind: 'text', text: '😀 é' }, toolUse('t1'), { kind: 'text', text: '!' }, toolResult('t1')]));
    } finally { await kernel.close(); }
  });
});


describe('hasActiveRuns', () => {
  it.each(['queued', 'running'] as const)('blocks %s assistant rows across owners without reading payloads or writing', async status => {
    const ledger = await setup({ runStatus: status });
    f.sql("UPDATE ai_chats SET owner_id = 'another-owner'");
    const queries: string[] = [];
    const original = f.kernel.run.bind(f.kernel);
    vi.spyOn(f.kernel, 'run').mockImplementation(work => original(db => work(db.withPlugin({
      transformQuery(args) { queries.push(JSON.stringify(args.node)); return args.node; },
      async transformResult(args) { return args.result; },
    }))));
    const before = writes();
    expect(await ledger.hasActiveRuns({}, {})).toBe(true);
    expect(writes()).toBe(before);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('LimitNode');
    expect(queries[0]).toContain('"value":1');
    expect(queries[0]).not.toMatch(/content|events_json|owner_id|UpdateQueryNode/);
  });

  it.each(['succeeded', 'failed', 'canceled', null])('ignores %s rows and non-assistant messages', async status => {
    const ledger = await setup();
    f.sql('UPDATE ai_chat_messages SET run_status = ?', status);
    expect(await ledger.hasActiveRuns()).toBe(false);
    f.sql("UPDATE ai_chat_messages SET role = 'user', run_status = 'running'");
    expect(await ledger.hasActiveRuns()).toBe(false);
    f.sql('DELETE FROM ai_chat_messages');
    expect(await ledger.hasActiveRuns()).toBe(false);
  });
});


describe('bounded delta receipts and commit ordering', () => {
  it('keeps only a bounded suffix and SQL character lengths for a multi-MB tool tail', async () => {
    const ledger = await setup();
    const text = '😀'.repeat(600_000);
    const next = progress({ content: 'saved 😀', events: [{ kind: 'tool_result', toolUseId: 'huge', content: text, isError: false }] });
    let receipt: CheckpointState | undefined;
    await ledger.checkpoint(next, { onPersisted: state => { receipt = state; } });
    expect(receipt!.tail.length).toBeLessThanOrEqual(256);
    expect(receipt!.contentLength).toBe(7);
    expect(receipt!.tailLength).toBe([...JSON.stringify(next.events[0]) + ']'].length);
  });

  it('never publishes a receipt from a rolled-back transaction', async () => {
    const ledger = await setup();
    const transaction = f.kernel.transaction.bind(f.kernel);
    vi.spyOn(f.kernel, 'transaction').mockImplementation(work => transaction(async () => {
      await work();
      throw new Error('commit refused');
    }));
    const persisted = vi.fn();
    await expect(ledger.checkpoint(progress(), { onPersisted: persisted })).rejects.toThrow('commit refused');
    expect(persisted).not.toHaveBeenCalled();
    expect(row().content).toBe('saved');
  });

  it('idle existence reads use the covering partial index', async () => {
    await setup();
    const plan = f.rows<{ detail: string }>("EXPLAIN QUERY PLAN SELECT id FROM ai_chat_messages WHERE role = ? AND run_status IN ('queued', 'running') LIMIT 1", 'assistant');
    expect(plan.map(row => row.detail).join(' ')).toContain('COVERING INDEX idx_ai_chat_messages_active');
  });
});


it('a same-length rewrite before a long identical suffix cannot pass the bounded delta guard', async () => {
  const ledger = await setup();
  const tail: AgentEvent = { kind: 'tool_result', toolUseId: 'a', content: 'same suffix'.repeat(1000), isError: false };
  const base = progress({ events: [{ kind: 'text', text: 'saved more' }, tail] });
  let receipt: CheckpointState | undefined;
  await ledger.checkpoint(base, { onPersisted: value => { receipt = value; } });
  const suffix = receipt!.tail;
  f.sql('UPDATE ai_chat_messages SET events_json = replace(events_json, ?, ?)', '"toolUseId":"a"', '"toolUseId":"b"');
  expect(row().events_json!.endsWith(suffix)).toBe(true);
  const parse = vi.spyOn(JSON, 'parse');
  await ledger.checkpoint({ ...base, events: [...base.events, toolUse('next')] },
    { previous: receipt, expected: receipt!.length });
  expect(parse).toHaveBeenCalledTimes(1);
  expect(events()).toContainEqual({ ...tail, toolUseId: 'b' });
});
