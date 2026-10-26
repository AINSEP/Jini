import { afterEach, describe, expect, it } from 'vitest';
import type { AcceptedRunRequest, DurableRun, DurableRunStore } from '../../../core/durable-runs/ports.js';
import * as continuation from '../../../core/durable-runs/continuation.js';
import { createChatHistoryStore } from '../../../store/runtime/chat-history-store.js';
import { createChatRunLedger } from '../../../store/runtime/run-ledger.js';
import { runtimeFixture, type RuntimeFixture } from '../../../store/runtime/__tests__/runtime-fixture.js';
import { createRunAcceptance, type RunAcceptancePorts } from '../accept.js';
import { createDurableRecovery, RECOVERY_LIMIT } from '../recover.js';
import * as entry from '../entry.js';

const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
const userMessage = { id: 'u1', role: 'user', content: 'hi', createdAt: 90 };

let f: RuntimeFixture;
afterEach(() => { f?.close(); });

/** Acceptance over the real SQLite durable store, with recording launch/attach ports. */
async function harness({ launch, onAccepted }: { launch?: RunAcceptancePorts['launch']; onAccepted?: NonNullable<RunAcceptancePorts['onAccepted']> } = {}) {
  f = runtimeFixture();
  await createChatHistoryStore({ kernel: f.kernel, scope: { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' }, isDaemonRunId }).create({ id: 'c' });
  const ledger = createChatRunLedger({ kernel: f.kernel, isDaemonRunId }, { now: () => 150 });
  const store = ledger.durable as DurableRunStore;
  const sanitized: string[] = [];
  const launched: Array<{ run: DurableRun; request: AcceptedRunRequest }> = [];
  const attached: DurableRun[] = [];
  let minted = 0;
  const ports: RunAcceptancePorts = {
    store,
    ...(onAccepted ? { onAccepted } : {}),
    // Hosts strip host-only envelope fields before anything is persisted.
    sanitizeContextRef: ({ contextRef }) => { sanitized.push(contextRef); const { hostOnly: _drop, ...rest } = JSON.parse(contextRef); return JSON.stringify(rest); },
    now: () => 100,
    mintRunId: () => `daemon-${++minted}`,
    launch: launch ?? (async (input) => { launched.push(input); }),
    attach: (run) => { attached.push(run); },
  };
  return { acceptance: createRunAcceptance(ports), store, ledger, sanitized, launched, attached };
}
const request = (contextRef = JSON.stringify({ userMessage, hostOnly: 'x' })): AcceptedRunRequest => ({ agentId: 'codex', contextRef });
const input = (over: Partial<{ principalId: string; messageId: string }> = {}) =>
  ({ principalId: 'alice', workspaceId: 'ws', conversationId: 'c', messageId: 'a1', request: request(), ...over });

describe('createRunAcceptance().accept', () => {
  it('observes only newly committed logical runs, excluding replay and unauthorized acceptance', async () => {
    const accepted: string[] = [];
    const h = await harness({ onAccepted: ({ run }) => { accepted.push(run.messageId); } });
    expect(await h.acceptance.accept(input({ principalId: 'mallory' }))).toBeNull();
    const first = await h.acceptance.accept(input());
    const replay = await h.acceptance.accept(input());
    expect(replay?.runId).toBe(first?.runId);
    expect(accepted).toEqual(['a1']);
    expect((await h.store.load({ messageId: 'a1' }, {}))?.message.runStatus).toBe('queued');
  });

  it('durably accepts the sanitized request, then launches and attaches the queued attempt', async () => {
    const h = await harness();
    const run = await h.acceptance.accept(input());
    expect(h.sanitized).toEqual([JSON.stringify({ userMessage, hostOnly: 'x' })]);
    expect(run).toMatchObject({ runId: 'daemon-1', attemptStartedAt: 100, recoveryCount: 0, message: { runStatus: 'queued' },
      request: { agentId: 'codex', contextRef: JSON.stringify({ userMessage }) } });
    expect(h.launched).toEqual([{ run, request: run!.request }]);
    expect(h.attached).toEqual([run]);
    expect((await h.store.load({ messageId: 'a1' }, {}))?.transcript.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('returns null without launching or attaching when the caller does not own the conversation', async () => {
    const h = await harness();
    expect(await h.acceptance.accept(input({ principalId: 'mallory' }))).toBeNull();
    expect(h.launched).toEqual([]);
    expect(h.attached).toEqual([]);
    expect(await h.store.load({ messageId: 'a1' }, {})).toBeNull();
  });

  it('answers a duplicate POST with the stored attempt, re-dispatching it under the same attempt id', async () => {
    const h = await harness();
    await h.acceptance.accept(input());
    const again = await h.acceptance.accept(input());
    expect(again?.runId).toBe('daemon-1');
    expect(h.launched.map((l) => l.run.runId)).toEqual(['daemon-1', 'daemon-1']);
    expect(h.attached).toHaveLength(2);
  });

  it('still returns and attaches the accepted attempt when its launch fails', async () => {
    const h = await harness({ launch: async () => { throw new Error('daemon unreachable'); } });
    const run = await h.acceptance.accept(input());
    expect(run?.message.runStatus).toBe('queued');
    expect(h.attached).toEqual([run]);
  });

  it.each([
    ['already producing output', async (h: Awaited<ReturnType<typeof harness>>, run: DurableRun) => {
      expect(await h.ledger.checkpoint({ conversationId: 'c', messageId: 'a1', runId: run.runId, content: 'streaming', events: [] })).toBe(true);
    }],
    ['handed to recovery', async (h: Awaited<ReturnType<typeof harness>>, run: DurableRun) => {
      expect(await h.store.advance({ run, nextRunId: 'daemon-9', now: 120, events: [] }, {})).toBe(true);
    }],
    ['stopped by the user', async (h: Awaited<ReturnType<typeof harness>>, run: DurableRun) => {
      await h.store.cancel({ runId: run.runId, reason: 'user-stop' }, {});
    }],
  ])('attaches without re-launching a duplicate of an attempt %s', async (_label, mutate) => {
    const h = await harness();
    const first = await h.acceptance.accept(input());
    await mutate(h, first!);
    h.launched.length = 0;
    const again = await h.acceptance.accept(input());
    expect(again?.messageId).toBe('a1');
    expect(h.launched).toEqual([]);
    expect(h.attached.at(-1)).toEqual(again);
  });
});

describe('durable-runs entry', () => {
  it('publishes acceptance, recovery and the continuation helpers as the implementation modules define them', () => {
    expect(entry.createRunAcceptance).toBe(createRunAcceptance);
    expect(entry.createDurableRecovery).toBe(createDurableRecovery);
    expect(entry.RECOVERY_LIMIT).toBe(RECOVERY_LIMIT);
    for (const [name, value] of Object.entries(continuation)) expect(entry).toHaveProperty(name, value);
    expect(entry.canonicalToolInput({ value: { b: 1, a: [2, { d: null, c: true }] } })).toBe('{"a":[2,{"c":true,"d":null}],"b":1}');
  });

  it('accepts a run end to end through the entry export', async () => {
    const h = await harness();
    const acceptance = entry.createRunAcceptance(harnessPorts(h));
    expect((await acceptance.accept(input()))?.runId).toBe('daemon-entry');
    expect(h.launched.map((l) => l.run.runId)).toEqual(['daemon-entry']);
  });
});

function harnessPorts(h: Awaited<ReturnType<typeof harness>>): RunAcceptancePorts {
  return { store: h.store, sanitizeContextRef: ({ contextRef }) => contextRef, now: () => 100, mintRunId: () => 'daemon-entry',
    launch: async (launch) => { h.launched.push(launch); }, attach: () => {} };
}
