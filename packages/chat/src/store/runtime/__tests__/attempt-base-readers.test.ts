/**
 * Reader proof for the `attempt_base_json` trim (ST-8c), plus the trim policy's own guards.
 *
 * Every non-test reader of a run's attempt base gets one check here: it is driven with a terminal
 * attempt whose recovery deadline elapsed long ago, once with the saved base and once with `'[]'`,
 * and its observable output must be identical. `ATTEMPT_BASE_READERS` names exactly the readers this
 * file proves; the policy refuses to clean unless the host passes that same list back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '@jini-ai/core/contracts/site/chat-core';
import type { DurableRun, RecoveryPorts, RecoveryTrigger } from '../../../core/durable-runs/ports.js';
import { createDurableRecovery } from '../../../server/durable-runs/recover.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createDurableRunStore } from '../durable-run-store.js';
import { ATTEMPT_BASE_READERS, createAttemptBaseTrimPolicy } from '../attempt-base-retention.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const OLD_DEADLINE = NOW - 30 * DAY;
const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
const BASE: AgentEvent[] = [{ kind: 'text', text: 'earlier segment' }, { kind: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } },
  { kind: 'status', label: 'Recovering', code: 'run_recovering' }];
const EVENTS: AgentEvent[] = [...BASE, { kind: 'text', text: 'final answer' }];
const proven = { verifiedReaders: [...ATTEMPT_BASE_READERS] };

let f: RuntimeFixture | undefined;
afterEach(() => { f?.close(); f = undefined; });

interface Seed { readonly id: string; readonly status: string; readonly deadline: number | null; readonly base?: readonly AgentEvent[] }

/** One conversation `c` holding one daemon answer per seed, each with its own attempt row. */
async function seeded(seeds: readonly Seed[]) {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 });
  await history.create({ id: 'c' });
  for (const [index, seed] of seeds.entries()) {
    await history.appendMessage({ conversationId: 'c', message: { id: seed.id, role: 'assistant', content: 'final answer', createdAt: index,
      runId: `daemon-${seed.id}`, runStatus: seed.status as 'succeeded', events: EVENTS } });
    f.sql(`INSERT INTO assistant_run_attempts VALUES (?, 'daemon', ?, 1, ?, 0, 5, 6, NULL, NULL, 0, NULL, NULL, ?)`, seed.id,
      JSON.stringify({ agentId: 'codex', contextRef: '{}' }), seed.deadline, JSON.stringify(seed.base ?? BASE));
  }
  return { fixture: f, history, store: createDurableRunStore({ kernel: f.kernel, isDaemonRunId }) };
}

/** Clears the base directly: the reader checks compare against the shape the policy produces. */
function trimDirectly(fixture: RuntimeFixture, id: string): void {
  fixture.sql(`UPDATE assistant_run_attempts SET attempt_base_json = '[]' WHERE message_id = ?`, id);
}

function rows(fixture: RuntimeFixture, table: 'assistant_run_attempts' | 'ai_chat_messages') {
  return fixture.rows<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY ${table === 'ai_chat_messages' ? 'id' : 'message_id'}`);
}

function withoutBase(row: Record<string, unknown>) {
  const { attempt_base_json: _base, ...rest } = row;
  return rest;
}

/** Runs `observe` on an untrimmed and a trimmed copy of the same terminal, past-deadline attempt. */
async function bothWays<T>(observe: (world: Awaited<ReturnType<typeof seeded>>) => Promise<T>, status = 'succeeded') {
  const before = await observe(await seeded([{ id: 'a1', status, deadline: OLD_DEADLINE }]));
  f?.close();
  const world = await seeded([{ id: 'a1', status, deadline: OLD_DEADLINE }]);
  trimDirectly(world.fixture, 'a1');
  return { before, after: await observe(world) };
}

function recoveryHarness(store: Awaited<ReturnType<typeof seeded>>['store']) {
  const calls: string[] = [];
  const ports: RecoveryPorts = {
    store, now: () => NOW, mintRunId: () => 'daemon-next',
    probe: async () => { calls.push('probe'); return 'dead'; },
    attach: (run: DurableRun) => { calls.push(`attach:${JSON.stringify(run.attemptBase)}`); },
    launch: async () => { calls.push('launch'); }, cancelAttempt: async () => { calls.push('cancel'); },
    verifyChildDead: async () => false, supportsNativeResume: () => true,
    settle: async () => { calls.push('settle'); return true; },
  };
  return { recovery: createDurableRecovery(ports, { report: { info: () => { calls.push('report'); } } }), calls };
}

describe('attempt base reader proof (terminal, past deadline)', () => {
  it('ports.ts DurableRunHead / kernel.ts row type: load serves every other field unchanged', async () => {
    const { before, after } = await bothWays(async ({ store }) => {
      const run = await store.load({ messageId: 'a1' }, {});
      return { run: { ...run, attemptBase: undefined }, base: run?.attemptBase };
    });
    expect(after.run).toEqual(before.run);
    expect(before.base).toEqual(BASE);
    expect(after.base).toEqual([]);
  });

  it('durable-run-store.ts guardTool: hasUnknownToolCall on run.attemptBase never decides a terminal run', async () => {
    const { before, after } = await bothWays(async ({ store, fixture }) => ({
      known: await store.guardTool({ runId: 'daemon-a1', toolId: 'search', input: { q: 'x' }, toolUseId: 't1' }, {}),
      fresh: await store.guardTool({ runId: 'daemon-a1', toolId: 'search', input: { q: 'y' }, toolUseId: 't2' }, {}),
      messages: rows(fixture, 'ai_chat_messages'),
    }));
    expect(before).toEqual({ known: 'stale', fresh: 'stale', messages: before.messages });
    expect(after).toEqual(before);
  });

  it('durable-run-store.ts advance (projection writer): a terminal attempt cannot be advanced either way', async () => {
    const { before, after } = await bothWays(async ({ store, fixture }) => {
      const run = (await store.load({ messageId: 'a1' }, {}))!;
      return { advanced: await store.advance({ run, nextRunId: 'daemon-next', now: NOW, events: EVENTS }, {}),
        messages: rows(fixture, 'ai_chat_messages'), attempts: rows(fixture, 'assistant_run_attempts').map(withoutBase) };
    });
    expect(before.advanced).toBe(false);
    expect(after).toEqual(before);
  });

  it('durable-run-store.ts metadataForRun (cancel / captureSession upserts) never re-expands a trimmed base', async () => {
    const { before, after } = await bothWays(async ({ store, fixture }) => {
      await store.cancel({ runId: 'daemon-a1', reason: 'user' }, {});
      const captured = await store.captureSession({ runId: 'daemon-a1', sessionId: 's1' }, {});
      const attempts = rows(fixture, 'assistant_run_attempts');
      return { captured, base: attempts[0]!.attempt_base_json, attempts: attempts.map(withoutBase), messages: rows(fixture, 'ai_chat_messages') };
    });
    expect(before.captured).toBe(false);
    expect(after.base).toBe('[]');
    expect({ ...after, base: null }).toEqual({ ...before, base: null });
  });

  it('durable-run-store.ts accept: a repeated accept of a finished message returns the same run', async () => {
    const { before, after } = await bothWays(async ({ store }) => {
      const run = await store.accept({ conversationId: 'c', messageId: 'a1', runId: 'daemon-a1', principalId: 'alice', workspaceId: 'ws',
        now: NOW, request: { agentId: 'codex', contextRef: '{}' } }, {});
      return { ...run, attemptBase: undefined };
    });
    expect(after).toEqual(before);
  });

  it.each(['succeeded', 'failed', 'canceled'])('recover.ts attemptDiagnostics / attach: %s recovery is identical for every trigger', async (status) => {
    const triggers: RecoveryTrigger[] = ['boot', 'browser', 'stream', 'timeout', 'attempt-failed'];
    const { before, after } = await bothWays(async ({ store }) => {
      const h = recoveryHarness(store);
      const results = [];
      for (const trigger of triggers) results.push(await h.recovery.recover({ messageId: 'a1', trigger }, {}));
      return { results, calls: h.calls };
    }, status);
    expect(before).toEqual({ results: triggers.map(() => 'terminal'), calls: [] });
    expect(after).toEqual(before);
  });

  it('replay after trim matches', async () => {
    // Delayed attach, stream seed and replay all start from the attempt base; a finished run is
    // never attached, so a reconnect replays the saved events, not the base.
    const { before, after } = await bothWays(async ({ store, history }) => {
      const h = recoveryHarness(store);
      const replay = await h.recovery.recover({ messageId: 'a1', trigger: 'stream', expectedRunId: 'daemon-a1' }, {});
      const message = await history.message?.({ conversationId: 'c', messageId: 'a1' });
      return { replay, calls: h.calls, events: message?.events };
    });
    expect(before.events).toEqual(EVENTS);
    expect(after).toEqual(before);
  });

  it('store.ts messages / message / messagesJson: messages response bytes identical before and after trim', async () => {
    const world = await seeded([{ id: 'a1', status: 'succeeded', deadline: OLD_DEADLINE }]);
    const serve = async () => JSON.stringify({
      page: await world.history.messages({ conversationId: 'c' }),
      one: await world.history.message?.({ conversationId: 'c', messageId: 'a1' }),
      json: await world.history.messagesJson?.({ conversationId: 'c' }, {}),
    });
    const before = await serve();
    const removed = await createAttemptBaseTrimPolicy({ kernel: world.fixture.kernel, now: () => NOW, readerProof: proven }).sweep({ now: NOW });
    expect(removed.removed).toBe(1);
    expect(await serve()).toBe(before);
  });

  it('messagesVersion changes on the SQLite connection-counter branch, so no stale cache can survive a trim', async () => {
    const world = await seeded([{ id: 'a1', status: 'succeeded', deadline: OLD_DEADLINE }]);
    const before = await world.history.messagesVersion?.({ conversationId: 'c' }, {});
    await createAttemptBaseTrimPolicy({ kernel: world.fixture.kernel, now: () => NOW, readerProof: proven }).sweep({ now: NOW });
    expect(before).toEqual(expect.any(String));
    expect(await world.history.messagesVersion?.({ conversationId: 'c' }, {})).not.toBe(before);
  });
});

describe('createAttemptBaseTrimPolicy', () => {
  const mixed: Seed[] = [
    { id: 'old', status: 'succeeded', deadline: OLD_DEADLINE },
    { id: 'recent', status: 'failed', deadline: NOW - 6 * DAY },
    { id: 'unbounded', status: 'canceled', deadline: null },
    { id: 'running', status: 'running', deadline: OLD_DEADLINE },
    { id: 'queued', status: 'queued', deadline: OLD_DEADLINE },
  ];
  const bases = (fixture: RuntimeFixture) => Object.fromEntries(rows(fixture, 'assistant_run_attempts')
    .map((row) => [row.message_id, row.attempt_base_json]));

  it('omitted reader proof stays report-only', async () => {
    for (const verifiedReaders of [[], ATTEMPT_BASE_READERS.slice(1), [...ATTEMPT_BASE_READERS, 'host/unproven-reader']]) {
      const { fixture } = await seeded(mixed);
      const policy = createAttemptBaseTrimPolicy({ kernel: fixture.kernel, now: () => NOW, readerProof: { verifiedReaders } });
      const untouched = bases(fixture);
      expect(policy.mode).toBe('report-only');
      expect(await policy.measure()).toEqual({ bytes: JSON.stringify(BASE).length, items: 1 });
      expect(await policy.sweep({ now: NOW })).toEqual({ freedBytes: 0, removed: 0 });
      expect(bases(fixture)).toEqual(untouched);
      fixture.close(); f = undefined;
    }
  });

  it('recoverable attempt untouched', async () => {
    const { fixture } = await seeded(mixed);
    const policy = createAttemptBaseTrimPolicy({ kernel: fixture.kernel, now: () => NOW, readerProof: proven });
    expect(policy).toMatchObject({ id: 'attempt-base', kind: 'derived', mode: 'trim' });
    expect(await policy.sweep({ now: NOW })).toEqual({ freedBytes: JSON.stringify(BASE).length - 2, removed: 1 });
    const after = bases(fixture);
    expect(after.old).toBe('[]');
    expect(after.recent).toBe(JSON.stringify(BASE));
    expect(after.unbounded).toBe(JSON.stringify(BASE));
  });

  it('running attempt untouched', async () => {
    const { fixture } = await seeded(mixed);
    await createAttemptBaseTrimPolicy({ kernel: fixture.kernel, now: () => NOW, readerProof: proven }).sweep({ now: NOW });
    expect(bases(fixture)).toMatchObject({ running: JSON.stringify(BASE), queued: JSON.stringify(BASE) });
  });

  it('clears only attempt_base_json and never writes events_json', async () => {
    const { fixture } = await seeded(mixed);
    const messages = rows(fixture, 'ai_chat_messages');
    const attempts = rows(fixture, 'assistant_run_attempts').map(withoutBase);
    await createAttemptBaseTrimPolicy({ kernel: fixture.kernel, now: () => NOW, readerProof: proven }).sweep({ now: NOW });
    expect(rows(fixture, 'ai_chat_messages')).toEqual(messages);
    expect(rows(fixture, 'assistant_run_attempts').map(withoutBase)).toEqual(attempts);
  });

  it('bounds one pass by limit and honours a custom minimum age', async () => {
    const { fixture } = await seeded([1, 2, 3].map((n) => ({ id: `t${n}`, status: 'succeeded', deadline: NOW - 2 * DAY })));
    const policy = createAttemptBaseTrimPolicy({ kernel: fixture.kernel, now: () => NOW, readerProof: proven }, { minPastDeadlineMs: DAY, limit: 2 });
    expect((await policy.sweep({ now: NOW })).removed).toBe(2);
    expect((await policy.sweep({ now: NOW })).removed).toBe(1);
    expect((await policy.sweep({ now: NOW })).removed).toBe(0);
  });

  it('an aborted sweep call writes nothing and says so', async () => {
    const { fixture } = await seeded(mixed);
    const policy = createAttemptBaseTrimPolicy({ kernel: fixture.kernel, now: () => NOW, readerProof: proven });
    const controller = new AbortController();
    controller.abort();
    await expect(policy.sweep({ now: NOW, signal: controller.signal })).rejects.toThrow(/stopped before it changed anything/);
    expect(bases(fixture).old).toBe(JSON.stringify(BASE));
  });

  it('rejects a limit that is not a positive whole number', () => {
    f = runtimeFixture();
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(() => createAttemptBaseTrimPolicy({ kernel: f!.kernel, now: () => NOW, readerProof: proven }, { limit })).toThrow(/limit/);
    }
  });
});
