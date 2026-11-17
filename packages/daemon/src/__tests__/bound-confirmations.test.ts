import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createSurfaceExchangeStore } from '../surface-exchanges.js';
import { createBoundConfirmationGate, createBoundConfirmations, type BoundConfirmationRequest } from '../bound-confirmations.js';
import type { ToolConfirmationRequest } from '../tool-executor.js';

type Owner = { id: string };

/** Real exchange store; only time, ids and scheduling are replaced. */
function fixture() {
  let now = 0, sequence = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  const clock = { nowMs: () => now, nowIso: () => new Date(now).toISOString() };
  const exchanges = createSurfaceExchangeStore({ clock, idGenerator: { newId: () => String(++sequence).padStart(22, 'a') },
    defaultChannel: 'bound-test', scheduler: { schedule: ({ delayMs, callback }) => {
      const id = ++sequence;
      jobs.set(id, { at: now + delayMs, callback });
      return () => { jobs.delete(id); };
    } } }, { idleTtlMs: 60_000, maxLifetimeMs: 60_000 });
  const confirmations = createBoundConfirmations<Owner>({ exchanges, nowMs: clock.nowMs,
    sameOwner: ({ expected, actual }) => expected.id === actual?.id,
    principalId: 'anonymous', channel: 'bound-test', limits: { maxHeld: 3, perQuotaKey: 2 } });
  const payloads: Record<string, unknown>[] = [];
  const request = (overrides: Partial<BoundConfirmationRequest<Owner>> = {}): BoundConfirmationRequest<Owner> => ({
    binding: { runId: 'run', executionId: 'exec', quotaKey: 'key' },
    emission: ({ challengeId }) => ({ channel: 'prompt', payload: { challengeId } }),
    emit: ({ payload }) => { payloads.push(payload as Record<string, unknown>); },
    validate: async () => true, ...overrides });
  const challenge = async (index = 0): Promise<string> => {
    while (payloads.length <= index) await new Promise((resolve) => setImmediate(resolve));
    return payloads[index]!.challengeId as string;
  };
  return { exchanges, confirmations, request, challenge, jobs, advance(ms: number) {
    now += ms;
    for (const [id, job] of [...jobs]) if (job.at <= now && jobs.delete(id)) job.callback();
  } };
}

test('a single live challenge delivers once; forged and replayed answers are refused', async () => {
  const f = fixture();
  const waiting = f.confirmations.request(f.request());
  const challengeId = await f.challenge();
  assert.equal(await f.confirmations.confirm({ challengeId: 'forged', allow: true }), false);
  assert.equal(await f.confirmations.confirm({ challengeId, allow: true }), true);
  assert.equal(await f.confirmations.confirm({ challengeId, allow: true }), false);
  assert.equal(await waiting, true);
  assert.equal(f.exchanges.size(), 0);
});

test('a different owner cannot answer; validation failure or expiry denies', async () => {
  const owned = fixture();
  const waiting = owned.confirmations.request(owned.request({ binding: { runId: 'run', executionId: 'exec', quotaKey: 'key', owner: { id: 'a' } } }));
  const challengeId = await owned.challenge();
  assert.equal(await owned.confirmations.confirm({ challengeId, allow: true, owner: { id: 'b' } }), false);
  assert.equal(await owned.confirmations.confirm({ challengeId, allow: true, owner: { id: 'a' } }), true);
  assert.equal(await waiting, true);
  for (const reason of ['changed', 'expires'] as const) {
    const f = fixture();
    const held = f.confirmations.request(f.request({ validate: async () => {
      if (reason === 'expires') f.advance(60_000);
      return reason !== 'changed';
    } }));
    assert.equal(await f.confirmations.confirm({ challengeId: await f.challenge(), allow: true }), false);
    assert.equal(await held, false);
  }
});

test('caps: one prompt per run, perQuotaKey per key and maxHeld overall', async () => {
  const f = fixture();
  const first = f.confirmations.request(f.request());
  assert.equal(await f.confirmations.request(f.request()), false);
  const second = f.confirmations.request(f.request({ binding: { runId: 'run-2', executionId: 'e2', quotaKey: 'key' } }));
  assert.equal(await f.confirmations.request(f.request({ binding: { runId: 'run-3', executionId: 'e3', quotaKey: 'key' } })), false);
  const third = f.confirmations.request(f.request({ binding: { runId: 'run-4', executionId: 'e4', quotaKey: 'other' } }));
  assert.equal(await f.confirmations.request(f.request({ binding: { runId: 'run-5', executionId: 'e5', quotaKey: 'third' } })), false);
  for (let index = 0; index < 3; index += 1) await f.confirmations.confirm({ challengeId: await f.challenge(index), allow: false });
  assert.deepEqual(await Promise.all([first, second, third]), [false, false, false]);
});

test('gate: approval binds the captured snapshot revision and the exact input, once', async () => {
  let revision = 1;
  const resumed: string[] = [];
  let approve: (() => void) | undefined;
  const gate = createBoundConfirmationGate<{ revision: number }>({
    resume: ({ decision }) => { resumed.push(decision); },
    crypto: globalThis.crypto,
    ports: {
      readSnapshot: async () => ({ revision }),
      decide: () => 'ask',
      isCurrent: ({ captured, live }) => captured.revision === live.revision,
      requestApproval: async ({ validate }) => { await new Promise<void>((resolve) => { approve = resolve; }); return validate(); },
      reportError: ({ error }) => { throw error; },
    },
  });
  const request = (executionId: string) => ({ executionId, input: { q: 'x' }, tool: { id: 't' } }) as unknown as ToolConfirmationRequest;
  gate.delegate.onConfirm!(request('a'));
  while (!approve) await new Promise((resolve) => setImmediate(resolve));
  (approve as () => void)();
  while (resumed.length === 0) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(resumed, ['confirm']);
  assert.equal(await gate.isApproved({ executionId: 'a', input: { q: 'changed' } }), false);
  gate.delegate.onConfirm!(request('b'));
  approve = undefined;
  while (!approve) await new Promise((resolve) => setImmediate(resolve));
  (approve as () => void)();
  while (resumed.length === 1) await new Promise((resolve) => setImmediate(resolve));
  revision = 2;
  assert.equal(await gate.isApproved({ executionId: 'b', input: { q: 'x' } }), false);
  assert.equal(await gate.isApproved({ executionId: 'never', input: {} }), false);
});
