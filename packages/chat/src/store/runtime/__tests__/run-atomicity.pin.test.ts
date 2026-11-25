import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import type { ChatRunLedger } from '../../../core/durable-runs/ledger-contracts.js';
import type { DurableRunStore } from '../../../core/durable-runs/ports.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createChatRunLedger } from '../run-ledger.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

/**
 * @file Pins the ledger's replay rules and the atomicity of every multi-write transaction in the
 * durable run store and the run ledger. Faults are injected with real SQLite triggers, so a write
 * that leaves its transaction survives the failure and the pin goes red.
 */

const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
const run = { conversationId: 'c', messageId: 'a1', runId: 'daemon-1' } as const;
let f: RuntimeFixture;
afterEach(() => { f?.close(); });

interface Harness { ledger: ChatRunLedger; durable: DurableRunStore }
async function setup(): Promise<Harness> {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 });
  await history.create({ id: 'c' });
  const ledger = createChatRunLedger({ kernel: f.kernel, isDaemonRunId }, { now: () => 700 });
  return { ledger, durable: ledger.durable! };
}
const userMessage: ChatMessage = { id: 'u1', role: 'user', content: 'hi', createdAt: 90 };
type AcceptInput = Parameters<DurableRunStore['accept']>[0];
const acceptInput = (): AcceptInput => ({ ...run, principalId: 'alice', workspaceId: 'ws', now: 100,
  request: { agentId: 'codex', contextRef: JSON.stringify({ userMessage }) } });
async function accepted(h: Harness) {
  const result = await h.durable.accept(acceptInput(), {});
  if (!result) throw new Error('fixture acceptance failed');
  return result;
}
const count = (table: string) => f.rows<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)[0]!.n;
interface Row { content: string; events_json: string | null; run_status: string | null; ended_at: number | null; run_id: string | null }
const row = (): Row => f.rows<Row>('SELECT * FROM ai_chat_messages WHERE id = ?', 'a1')[0]!;
const failOn = (table: string, event: 'INSERT' | 'UPDATE') =>
  f.sql(`CREATE TRIGGER boom_${table}_${event} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected'); END`);
const settlement = { ...run, status: 'succeeded', endedAt: 500, content: 'done', events: [{ kind: 'text', text: 'done' }] } as const;

describe('accepted-request races', () => {
  it('accepts the same request twice at once as one run with an identical result', async () => {
    const h = await setup();
    const [first, second] = await Promise.all([h.durable.accept(acceptInput(), {}), h.durable.accept(acceptInput(), {})]);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(count('ai_chat_messages')).toBe(2);
    expect(count('assistant_run_attempts')).toBe(1);
    expect(row()).toMatchObject({ run_id: 'daemon-1', run_status: 'queued' });
  });

  it('answers a replayed acceptance from the stored run after the run advanced', async () => {
    const h = await setup();
    const first = await accepted(h);
    expect(await h.durable.advance({ run: first, nextRunId: 'daemon-2', now: 1_000, events: [] }, {})).toBe(true);
    const replay = await h.durable.accept(acceptInput(), {});
    expect(replay).toMatchObject({ messageId: 'a1', runId: 'daemon-2', recoveryCount: 1 });
    expect(count('assistant_run_attempts')).toBe(1);
  });

  it('rolls the question and answer back when the attempt row cannot be written', async () => {
    const h = await setup();
    failOn('assistant_run_attempts', 'INSERT');
    await expect(h.durable.accept(acceptInput(), {})).rejects.toThrow('injected');
    expect(count('ai_chat_messages')).toBe(0);
    expect(count('assistant_run_attempts')).toBe(0);
  });
});

describe('durable store transactions are atomic', () => {
  it('advance moves the attempt id and its metadata together or not at all', async () => {
    const h = await setup();
    const first = await accepted(h);
    failOn('assistant_run_attempts', 'INSERT');
    await expect(h.durable.advance({ run: first, nextRunId: 'daemon-2', now: 1_000, events: [] }, {})).rejects.toThrow('injected');
    expect(row()).toMatchObject({ run_id: 'daemon-1', run_status: 'queued' });
    expect(f.rows<{ recovery_count: number }>('SELECT recovery_count FROM assistant_run_attempts')[0]!.recovery_count).toBe(0);
  });

  it('captureSession records the attempt session and the conversation locator together or not at all', async () => {
    const h = await setup();
    await accepted(h);
    failOn('assistant_agent_sessions', 'INSERT');
    await expect(h.durable.captureSession({ runId: 'daemon-1', sessionId: 's1' }, {})).rejects.toThrow('injected');
    expect(f.rows<{ session_id: string | null }>('SELECT session_id FROM assistant_run_attempts')[0]!.session_id).toBeNull();
  });

  it('guardTool records the tool use and the progress reset together or not at all', async () => {
    const h = await setup();
    await accepted(h);
    failOn('assistant_run_attempts', 'UPDATE');
    const guard = { runId: 'daemon-1', toolId: 'Read', toolUseId: 't1', input: {} };
    await expect(h.durable.guardTool(guard as never, {})).rejects.toThrow('injected');
    expect(row().events_json).toBe('[]');
  });
});

describe('ledger replay', () => {
  it('lets only the first terminal write win and ignores a replayed settle or checkpoint', async () => {
    const h = await setup();
    await accepted(h);
    expect(await h.ledger.settle(settlement)).toBe(true);
    expect(await h.ledger.settle({ ...settlement, content: 'again', endedAt: 900 })).toBe(false);
    expect(await h.ledger.checkpoint({ ...run, content: 'done and more', events: [{ kind: 'text', text: 'done and more' }] }, {})).toBe(false);
    expect(row()).toMatchObject({ content: 'done', run_status: 'succeeded', ended_at: 500 });
  });

  it('runs an idempotent write once and reports a replay as unwritten', async () => {
    const h = await setup();
    await accepted(h);
    let writes = 0;
    const write = async () => { writes += 1; return 'v'; };
    expect(await h.ledger.unlessSettled({ run, write }, {})).toEqual({ written: true, value: 'v' });
    await h.ledger.settle(settlement);
    expect(await h.ledger.unlessSettled({ run, write }, {})).toEqual({ written: false });
    expect(writes).toBe(1);
  });

  it('replays a checkpoint of the same projection without losing the run', async () => {
    const h = await setup();
    await accepted(h);
    const progress = { ...run, content: 'partial', events: [{ kind: 'text', text: 'partial' }] } as const;
    expect(await h.ledger.checkpoint(progress, {})).toBe(true);
    expect(await h.ledger.checkpoint(progress, {})).toBe(true);
    expect(row()).toMatchObject({ content: 'partial', run_status: 'running' });
  });
});

describe('terminal finish atomicity', () => {
  it('settle writes the terminal row and touches the chat together or not at all', async () => {
    const h = await setup();
    await accepted(h);
    failOn('ai_chats', 'UPDATE');
    await expect(h.ledger.settle(settlement)).rejects.toThrow('injected');
    expect(row()).toMatchObject({ run_status: 'queued', ended_at: null, content: '' });
  });

  it('reconcileInterrupted cancels a stuck row and touches the chat together or not at all', async () => {
    const h = await setup();
    await accepted(h);
    failOn('ai_chats', 'UPDATE');
    await expect(h.ledger.reconcileInterrupted({}, {})).rejects.toThrow('injected');
    expect(row()).toMatchObject({ run_status: 'queued', ended_at: null });
  });
});
