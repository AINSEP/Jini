import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import type { ChatRunLedger, InterruptedChatTurn, RunProgress } from '../../../core/durable-runs/ledger-contracts.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createChatRunLedger } from '../run-ledger.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

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
    if (!missed && work.toString().includes('updateTable("ai_chat_messages")')) { missed = true; return { numUpdatedRows: 0n } as never; }
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
