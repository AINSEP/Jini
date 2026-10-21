import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import type { InterruptedChatTurn } from '../../../core/durable-runs/ledger-contracts.js';
import type { ChatOwnerScope, ChatStore } from '../../ports.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createChatRunLedger, runLockKey } from '../run-ledger.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const alice: ChatOwnerScope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' };
const guest: ChatOwnerScope = { scopeId: 'ws', ownerKind: 'guest', ownerId: 'guest-hash' };
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
const CLOCK = 777;
const run = { conversationId: 'c', messageId: 'a1', runId: 'daemon-1' } as const;
const toolUse: AgentEvent = { kind: 'tool_use', id: 't1', name: 'read', input: { path: 'a' } };
const toolResult: AgentEvent = { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false };

let f: RuntimeFixture;
afterEach(() => { vi.restoreAllMocks(); f?.close(); });

interface MessageRow { run_id: string | null; run_status: string | null; content: string; events_json: string | null; ended_at: number | null }
const row = (id = 'a1') => f.rows<MessageRow>('SELECT * FROM ai_chat_messages WHERE id = ?', id)[0]!;
const events = (id = 'a1') => JSON.parse(row(id).events_json ?? 'null') as AgentEvent[];
const chatUpdatedAt = (id = 'c') => f.rows<{ updated_at: number }>('SELECT updated_at FROM ai_chats WHERE id = ?', id)[0]!.updated_at;
const attempt = () => f.rows<{ recovery_count: number; recovery_deadline: number | null; last_progress_at: number }>(
  'SELECT recovery_count, recovery_deadline, last_progress_at FROM assistant_run_attempts WHERE message_id = ?', 'a1')[0]!;

function setup() {
  f = runtimeFixture();
  const ledger = createChatRunLedger({ kernel: f.kernel, isDaemonRunId }, { now: () => CLOCK });
  return { ledger, history: (scope: ChatOwnerScope = alice): ChatStore => createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 }) };
}

async function seed(history: ChatStore, message: Partial<ChatMessage> = {}, conversationId = 'c'): Promise<void> {
  await history.create({ id: conversationId });
  await history.appendMessage({ conversationId, message: { id: 'a1', role: 'assistant', content: 'partial', events: [{ kind: 'text', text: 'partial' }],
    runId: 'daemon-1', runStatus: 'running', createdAt: 5, ...message } });
}

/** A writer that ignores the run lock (possible on Postgres, where only lock-takers serialize)
 * lands right before the guarded operation's `nth` kernel statement. */
function bypassWriterBefore(nth: number, statement: string): void {
  const runBody = f.kernel.run.bind(f.kernel);
  let calls = 0;
  vi.spyOn(f.kernel, 'run').mockImplementation(async (body) => {
    calls += 1;
    if (calls === nth) f.sql(statement);
    return runBody(body);
  });
}

describe('runLockKey', () => {
  it('locks per conversation message, independent of the attempt id', () => {
    expect(runLockKey(run)).toBe('chat-run:c:a1');
    expect(runLockKey({ ...run, runId: 'daemon-2' })).toBe(runLockKey(run));
  });
});

describe('createChatRunLedger().unlessSettled', () => {
  it('runs the write for an unknown row and for a row of another attempt that already ended', async () => {
    const { ledger, history } = setup();
    expect(await ledger.unlessSettled({ run, write: async () => 'first' })).toEqual({ written: true, value: 'first' });
    await seed(history(), { runId: 'daemon-0', runStatus: 'succeeded' });
    expect(await ledger.unlessSettled({ run, write: async () => 'second' })).toEqual({ written: true, value: 'second' });
  });

  it('runs the write while the row is still running, and skips it once the run is terminal', async () => {
    const { ledger, history } = setup();
    await seed(history());
    const write = vi.fn(async () => 'kept');
    expect(await ledger.unlessSettled({ run, write })).toEqual({ written: true, value: 'kept' });
    await ledger.settle({ ...run, content: 'done', events: [], status: 'succeeded', endedAt: 9 });
    expect(await ledger.unlessSettled({ run, write })).toEqual({ written: false });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('exposes the durable run store over the same kernel', async () => {
    const { ledger, history } = setup();
    await seed(history());
    expect((await ledger.durable?.find({ runId: 'daemon-1' }, {}))?.message.content).toBe('partial');
  });
});

describe('createChatRunLedger().settle', () => {
  it('writes the longer final answer, keeps saved tool barriers the replay lacks, and bumps the chat', async () => {
    const { ledger, history } = setup();
    await seed(history(), { events: [{ kind: 'text', text: 'partial' }, toolUse, toolResult] });
    const settled = await ledger.settle({ ...run, content: 'partial and final', events: [{ kind: 'text', text: 'partial and final' }], status: 'succeeded', endedAt: 50 });
    expect(settled).toBe(true);
    expect(row()).toMatchObject({ content: 'partial and final', run_status: 'succeeded', ended_at: 50 });
    expect(events()).toEqual([{ kind: 'text', text: 'partial and final' }, toolUse, toolResult]);
    expect(chatUpdatedAt()).toBe(50);
  });

  it('is absorbing: a second settlement of the same attempt changes nothing', async () => {
    const { ledger, history } = setup();
    await seed(history());
    expect(await ledger.settle({ ...run, content: 'first', events: [], status: 'failed', endedAt: 10 })).toBe(true);
    expect(await ledger.settle({ ...run, content: 'second, longer answer', events: [], status: 'succeeded', endedAt: 20 })).toBe(false);
    expect(row()).toMatchObject({ content: 'partial', run_status: 'failed', ended_at: 10 });
  });

  it('refuses a settlement from another attempt id', async () => {
    const { ledger, history } = setup();
    await seed(history());
    expect(await ledger.settle({ ...run, runId: 'daemon-old', content: 'stale', events: [], status: 'canceled', endedAt: 10 })).toBe(false);
    expect(row().run_status).toBe('running');
  });

  it('keeps a longer saved checkpoint over a shorter settlement, merging only non-text replay events', async () => {
    const { ledger, history } = setup();
    await seed(history(), { content: 'long saved answer', events: [{ kind: 'text', text: 'long saved answer' }, toolUse] });
    const replay: AgentEvent[] = [{ kind: 'text', text: 'short' }, toolUse, toolResult];
    expect(await ledger.settle({ ...run, content: 'short', events: replay, status: 'failed', endedAt: 30 })).toBe(true);
    expect(row()).toMatchObject({ content: 'long saved answer', run_status: 'failed' });
    expect(events()).toEqual([{ kind: 'text', text: 'long saved answer' }, toolUse, toolResult]);
  });

  it('restores the saved text as the first event when the kept checkpoint stored no text event', async () => {
    const { ledger, history } = setup();
    await seed(history(), { content: 'long saved answer', events: [toolUse] });
    expect(await ledger.settle({ ...run, content: 'short', events: [{ kind: 'text', text: 'short' }], status: 'canceled', endedAt: 30 })).toBe(true);
    expect(events()).toEqual([{ kind: 'text', text: 'long saved answer' }, toolUse]);
  });

  it.each([
    ['unparseable', "'not json'"],
    ['non-array', `'{"kind":"text"}'`],
    ['missing', 'NULL'],
  ])('treats %s saved events as none', async (_label, value) => {
    const { ledger, history } = setup();
    await seed(history(), { content: 'long saved answer' });
    f.sql(`UPDATE ai_chat_messages SET events_json = ${value} WHERE id = 'a1'`);
    expect(await ledger.settle({ ...run, content: 'short', events: [toolUse], status: 'failed', endedAt: 30 })).toBe(true);
    expect(events()).toEqual([{ kind: 'text', text: 'long saved answer' }, toolUse]);
  });

  it('reports false and leaves the chat untouched when a lock-bypassing writer ends the row first', async () => {
    const { ledger, history } = setup();
    await seed(history());
    const before = chatUpdatedAt();
    bypassWriterBefore(2, "UPDATE ai_chat_messages SET run_status = 'succeeded' WHERE id = 'a1'");
    expect(await ledger.settle({ ...run, content: 'partial plus', events: [], status: 'failed', endedAt: 99 })).toBe(false);
    expect(row()).toMatchObject({ content: 'partial', run_status: 'succeeded' });
    expect(chatUpdatedAt()).toBe(before);
  });
});

describe('createChatRunLedger().checkpoint', () => {
  async function acceptedAndRecovered() {
    const ctx = setup();
    const h = ctx.history();
    await h.create({ id: 'c' });
    const accepted = await ctx.ledger.durable!.accept({ ...run, principalId: 'alice', workspaceId: 'ws', now: 100,
      request: { agentId: 'codex', contextRef: '{}' } }, {});
    expect(accepted?.message.runStatus).toBe('queued');
    expect(await ctx.ledger.durable!.advance({ run: accepted!, nextRunId: 'daemon-2', now: 200, events: [] }, {})).toBe(true);
    expect(attempt().recovery_count).toBe(1);
    return { ...ctx, next: { ...run, runId: 'daemon-2' }, content: row().content };
  }

  it('moves an accepted row to running and grants a fresh recovery budget on new output', async () => {
    const { ledger, next, content } = await acceptedAndRecovered();
    expect(row().run_status).toBe('queued');
    expect(await ledger.checkpoint({ ...next, content: `${content}more`, events: [] })).toBe(true);
    expect(row()).toMatchObject({ content: `${content}more`, run_status: 'running' });
    expect(attempt()).toEqual({ recovery_count: 0, recovery_deadline: null, last_progress_at: CLOCK });
  });

  it('counts a new tool call as progress even when the text did not grow', async () => {
    const { ledger, next, content } = await acceptedAndRecovered();
    expect(await ledger.checkpoint({ ...next, content, events: [toolUse] })).toBe(true);
    expect(events()).toEqual([toolUse]);
    expect(attempt().recovery_count).toBe(0);
  });

  it('saves a replayed prefix without resetting the recovery budget, and leaves running rows running', async () => {
    const { ledger, next, content } = await acceptedAndRecovered();
    f.sql("UPDATE ai_chat_messages SET run_status = 'running' WHERE id = 'a1'");
    expect(await ledger.checkpoint({ ...next, content, events: [{ kind: 'text', text: content }] })).toBe(true);
    expect(row().run_status).toBe('running');
    expect(attempt()).toMatchObject({ recovery_count: 1, last_progress_at: 100 });
  });

  it('ignores a shorter checkpoint, an unknown row and a terminal row', async () => {
    const { ledger, history } = setup();
    expect(await ledger.checkpoint({ ...run, content: 'x', events: [] })).toBe(false);
    await seed(history(), { content: 'partial answer' });
    expect(await ledger.checkpoint({ ...run, content: 'partial', events: [] })).toBe(false);
    expect(row().content).toBe('partial answer');
    await ledger.settle({ ...run, content: 'partial answer', events: [], status: 'succeeded', endedAt: 3 });
    expect(await ledger.checkpoint({ ...run, content: 'partial answer and more', events: [] })).toBe(false);
    expect(row().content).toBe('partial answer');
  });

  it('reports false and resets nothing when a lock-bypassing writer ends the row first', async () => {
    const { ledger, next, content } = await acceptedAndRecovered();
    bypassWriterBefore(2, "UPDATE ai_chat_messages SET run_status = 'canceled' WHERE id = 'a1'");
    expect(await ledger.checkpoint({ ...next, content: `${content}more`, events: [] })).toBe(false);
    expect(row()).toMatchObject({ content, run_status: 'canceled' });
    expect(attempt().recovery_count).toBe(1);
  });
});

describe('createChatRunLedger().reconcileInterrupted', () => {
  it('hands each unfinished row, with its persisted owner, to recovery and keeps the adopted ones', async () => {
    const { ledger, history } = setup();
    await seed(history(), { runStatus: 'queued', events: [toolUse] });
    const seen: InterruptedChatTurn[] = [];
    const count = await ledger.reconcileInterrupted({ now: 40 }, { recover: async (turn) => { seen.push(turn); return true; } });
    expect(count).toBe(1);
    expect(seen).toEqual([{ principalId: 'alice', conversationId: 'c', message: { id: 'a1', role: 'assistant', content: 'partial',
      events: [toolUse], runId: 'daemon-1', runStatus: 'queued' } }]);
    expect(row().run_status).toBe('queued');
  });

  it('cancels rows recovery declines, preserving saved work, with a null principal for guests', async () => {
    const { ledger, history } = setup();
    await seed(history(guest), {}, 'g');
    const seen: InterruptedChatTurn[] = [];
    expect(await ledger.reconcileInterrupted({ now: 40 }, { recover: async (turn) => { seen.push(turn); return false; } })).toBe(1);
    expect(seen[0]?.principalId).toBeNull();
    expect(row()).toMatchObject({ content: 'partial', run_status: 'canceled', ended_at: 40 });
    expect(events()).toEqual([{ kind: 'text', text: 'partial' }, { kind: 'status', label: 'Stopped. Saved work is above.' }]);
    expect(chatUpdatedAt('g')).toBe(40);
  });

  it('offers a legacy row without an attempt id to recovery, then cancels it at the injected clock', async () => {
    const { ledger, history } = setup();
    await seed(history(), { runId: undefined });
    expect(row().run_id).toBeNull();
    const seen: InterruptedChatTurn[] = [];
    expect(await ledger.reconcileInterrupted(undefined, { recover: async (turn) => { seen.push(turn); return false; } })).toBe(1);
    expect(seen[0]?.message).not.toHaveProperty('runId');
    expect(row()).toMatchObject({ run_status: 'canceled', ended_at: CLOCK });
  });

  it('cancels unfinished rows when the host has no durable recovery', async () => {
    const { ledger, history } = setup();
    await seed(history());
    expect(await ledger.reconcileInterrupted()).toBe(1);
    expect(row()).toMatchObject({ run_status: 'canceled', ended_at: CLOCK });
  });

  it('does not count a row that settled between discovery and the cancel fallback', async () => {
    const { ledger, history } = setup();
    await seed(history());
    const recover = async () => {
      await ledger.settle({ ...run, content: 'finished elsewhere', events: [], status: 'succeeded', endedAt: 8 });
      return false;
    };
    expect(await ledger.reconcileInterrupted({ now: 40 }, { recover })).toBe(0);
    expect(row()).toMatchObject({ content: 'finished elsewhere', run_status: 'succeeded', ended_at: 8 });
  });

  it('does not count a row a lock-bypassing writer ended inside the cancel transaction', async () => {
    const { ledger, history } = setup();
    await seed(history());
    // Statement 1 is discovery, 2 the locked re-read, 3 the cancel update.
    bypassWriterBefore(3, "UPDATE ai_chat_messages SET run_status = 'failed' WHERE id = 'a1'");
    expect(await ledger.reconcileInterrupted({ now: 40 })).toBe(0);
    expect(row()).toMatchObject({ run_status: 'failed', ended_at: null });
  });

  it('ignores user turns and settled answers', async () => {
    const { ledger, history } = setup();
    const h = history();
    await h.create({ id: 'c' });
    await h.appendMessage({ conversationId: 'c', message: { id: 'u1', role: 'user', content: 'hi', createdAt: 1 } });
    await h.appendMessage({ conversationId: 'c', message: { id: 'a1', role: 'assistant', content: 'done', runId: 'daemon-1', runStatus: 'succeeded', createdAt: 2 } });
    const recover = vi.fn(async () => true);
    expect(await ledger.reconcileInterrupted({}, { recover })).toBe(0);
    expect(recover).not.toHaveBeenCalled();
  });
});
