import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, vi } from 'vitest';
import type { DigestCryptoPort } from '@jini-ai/core/records';
import { createSurfaceExchangeStore } from '../surface-exchanges.js';
import { createBoundConfirmationGate, createBoundConfirmations, type BoundConfirmationGatePorts, type BoundConfirmationRequest, type BoundConfirmationsDeps } from '../bound-confirmations.js';
import type { ToolConfirmationRequest } from "../tool-executor-types.js";

type Owner = { id: string };
type SameOwner<TOwner> = BoundConfirmationsDeps<TOwner>['sameOwner'];

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Real exchange store; only time, ids and scheduling are replaced. */
function ownedFixture<TOwner>(sameOwner: SameOwner<TOwner>) {
  let now = 0, sequence = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  const clock = { nowMs: () => now, nowIso: () => new Date(now).toISOString() };
  const exchanges = createSurfaceExchangeStore({ clock, idGenerator: { newId: () => String(++sequence).padStart(22, 'a') },
    defaultChannel: 'bound-test', scheduler: { schedule: ({ delayMs, callback }) => {
      const id = ++sequence;
      jobs.set(id, { at: now + delayMs, callback });
      return () => { jobs.delete(id); };
    } } }, { idleTtlMs: 60_000, maxLifetimeMs: 60_000 });
  const confirmations = createBoundConfirmations<TOwner>({ exchanges, nowMs: clock.nowMs, sameOwner,
    principalId: 'anonymous', channel: 'bound-test', limits: { maxHeld: 3, perQuotaKey: 2 } });
  const payloads: Record<string, unknown>[] = [];
  const request = (overrides: Partial<BoundConfirmationRequest<TOwner>> = {}): BoundConfirmationRequest<TOwner> => ({
    binding: { runId: 'run', executionId: 'exec', quotaKey: 'key' },
    emission: ({ challengeId }) => ({ channel: 'prompt', payload: { challengeId } }),
    emit: ({ payload }) => { payloads.push(payload as Record<string, unknown>); },
    validate: async () => true, ...overrides });
  const challenge = async (index = 0): Promise<string> => {
    while (payloads.length <= index) await tick();
    return payloads[index]!.challengeId as string;
  };
  return { exchanges, confirmations, request, challenge, jobs, payloads, advance(ms: number) {
    now += ms;
    for (const [id, job] of [...jobs]) if (job.at <= now && jobs.delete(id)) job.callback();
  } };
}

const fixture = () => ownedFixture<Owner>(({ expected, actual }) => expected.id === actual?.id);

/** Resolves to the promise's value, or to `'parked'` when it has not settled after a few macrotasks. */
async function settledSoon<T>(promise: Promise<T>): Promise<T | 'parked'> {
  let outcome: T | 'parked' = 'parked';
  void promise.then((value) => { outcome = value; });
  for (let turn = 0; turn < 5; turn += 1) await tick();
  return outcome;
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

const byId: SameOwner<Owner> = ({ expected, actual }) => expected.id === actual?.id;
const byValue: SameOwner<string | number | boolean> = ({ expected, actual }) => Object.is(expected, actual);

/** Every owner representation the contract admits, including each falsy scalar. */
const ownerCases: readonly { name: string; owner: unknown; other: unknown; sameOwner: SameOwner<never> }[] = [
  { name: 'an object', owner: { id: 'a' }, other: { id: 'b' }, sameOwner: byId },
  { name: 'a string', owner: 'a', other: '', sameOwner: byValue },
  { name: 'the empty string', owner: '', other: 'b', sameOwner: byValue },
  { name: 'a number', owner: 7, other: 0, sameOwner: byValue },
  { name: 'zero', owner: 0, other: 7, sameOwner: byValue },
  { name: 'true', owner: true, other: false, sameOwner: byValue },
  { name: 'false', owner: false, other: true, sameOwner: byValue },
];

test.each(ownerCases)('owner check ($name): another owner and an omitted owner are refused without consuming the prompt', async ({ owner, other, sameOwner }) => {
  const f = ownedFixture<unknown>(sameOwner as SameOwner<unknown>);
  const waiting = f.confirmations.request(f.request({ binding: { runId: 'run', executionId: 'exec', quotaKey: 'key', owner } }));
  const challengeId = await f.challenge();
  assert.equal(await f.confirmations.confirm({ challengeId, allow: true, owner: other }), false, 'a different owner must be refused');
  assert.equal(await f.confirmations.confirm({ challengeId, allow: true }), false, 'an omitted owner must be refused when one was bound');
  assert.equal(await settledSoon(waiting), 'parked', 'a refusal must not answer the prompt');
  assert.equal(await f.confirmations.confirm({ challengeId, allow: true, owner }), true, 'the bound owner still answers after the refusals');
  assert.equal(await waiting, true);
});

test('owner check: a null owner is bound to nobody, so the prompt is refused before anything is emitted', async () => {
  const f = ownedFixture<string | null>(({ expected, actual }) => expected === actual);
  assert.equal(await settledSoon(f.confirmations.request(f.request({ binding: { runId: 'run', executionId: 'exec', quotaKey: 'key', owner: null } }))), false);
  assert.equal(f.payloads.length, 0);
  assert.equal(f.exchanges.size(), 0);
});

test('a validation that throws still answers the waiting execution with a denial', async () => {
  const f = fixture();
  const waiting = f.confirmations.request(f.request({ validate: async () => { throw new Error('policy store unavailable'); } }));
  await assert.rejects(f.confirmations.confirm({ challengeId: await f.challenge(), allow: true }), /policy store unavailable/);
  assert.equal(await settledSoon(waiting), false, 'the execution must not stay parked until expiry');
  assert.equal(f.exchanges.size(), 0);
});

test('an answered prompt releases its run and its quota-key slot for later prompts', async () => {
  const f = fixture();
  const binding = (run: string) => ({ binding: { runId: run, executionId: `exec-${run}`, quotaKey: 'key' } });
  const held = [f.confirmations.request(f.request(binding('run-1'))), f.confirmations.request(f.request(binding('run-2')))];
  for (const index of [0, 1]) await f.confirmations.confirm({ challengeId: await f.challenge(index), allow: true });
  assert.deepEqual(await Promise.all(held), [true, true]);
  const again = [f.confirmations.request(f.request(binding('run-1'))), f.confirmations.request(f.request(binding('run-3')))];
  assert.equal(await settledSoon(again[0]!), 'parked', 'the same run may prompt again once its first prompt is answered');
  assert.equal(await settledSoon(again[1]!), 'parked', 'the key has both slots back');
  assert.equal(f.payloads.length, 4);
  assert.equal(await f.confirmations.request(f.request(binding('run-4'))), false, 'the per-key cap still holds');
  for (const index of [2, 3]) await f.confirmations.confirm({ challengeId: await f.challenge(index), allow: false });
  assert.deepEqual(await Promise.all(again), [false, false]);
});

/** Hashes through node:crypto so a test can prove the gate never reads the global WebCrypto. */
function fakeDigestCrypto(onDigest: () => void = () => {}): DigestCryptoPort & { calls: () => number } {
  let calls = 0;
  return { calls: () => calls, subtle: { digest: async (_algorithm, data) => {
    calls += 1;
    onDigest();
    const bytes = createHash('sha256').update(new Uint8Array(data as ArrayBuffer)).digest();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } } };
}

/** A gate over fakes of every port. `approve()` waits for the prompt and answers it through `validate`. */
function gateFixture(overrides: Partial<BoundConfirmationGatePorts<{ revision: number }>> = {}, crypto: DigestCryptoPort = fakeDigestCrypto()) {
  const resumed: string[] = [];
  const errors: unknown[] = [];
  const prompts: { validate: () => Promise<boolean>; answer: (allow: boolean) => void }[] = [];
  const gate = createBoundConfirmationGate<{ revision: number }>({ resume: ({ decision }) => { resumed.push(decision); }, crypto,
    ports: { readSnapshot: async () => ({ revision: 1 }), decide: () => 'ask',
      isCurrent: ({ captured, live }) => captured.revision === live.revision,
      requestApproval: ({ validate }) => new Promise<boolean>((resolve) => { prompts.push({ validate, answer: resolve }); }),
      reportError: ({ error }) => { errors.push(error); }, ...overrides } });
  const request = (executionId: string, input: unknown = { q: 'x' }) => ({ executionId, input, tool: { id: 't' } }) as unknown as ToolConfirmationRequest;
  const prompt = async (index = 0) => { while (prompts.length <= index) await tick(); return prompts[index]!; };
  return { gate, resumed, errors, prompts, request, prompt, async approve(executionId: string) {
    gate.delegate.onConfirm!(request(executionId));
    const held = await prompt(prompts.length);
    held.answer(await held.validate());
    const before = resumed.length;
    while (resumed.length === before) await tick();
  } };
}

test('gate: an approval is honoured for the exact approved input, and only once', async () => {
  const f = gateFixture();
  await f.approve('a');
  assert.deepEqual(f.resumed, ['confirm']);
  assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), true);
  assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), false, 'an approval is single use');
  assert.deepEqual(f.errors, []);
});

test('gate: a deny decision never prompts and resumes the execution denied', async () => {
  const f = gateFixture({ decide: () => 'deny' });
  f.gate.delegate.onConfirm!(f.request('a'));
  while (f.resumed.length === 0) await tick();
  assert.deepEqual(f.resumed, ['deny']);
  assert.equal(f.prompts.length, 0, 'the human must not be asked');
  assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), false);
});

test('gate: an aborted run is never resumed', async () => {
  const abort = new AbortController();
  const f = gateFixture({ signal: abort.signal });
  f.gate.delegate.onConfirm!(f.request('a'));
  const held = await f.prompt();
  abort.abort();
  held.answer(true);
  for (let turn = 0; turn < 5; turn += 1) await tick();
  assert.deepEqual(f.resumed, []);
});

test('gate: validation after the click refuses once the run has aborted', async () => {
  const abort = new AbortController();
  const f = gateFixture({ signal: abort.signal });
  f.gate.delegate.onConfirm!(f.request('a'));
  const held = await f.prompt();
  assert.equal(await held.validate(), true);
  abort.abort();
  assert.equal(await held.validate(), false);
});

test('gate: an approval is not honoured when the run aborts while it is being re-validated', async () => {
  const abort = new AbortController();
  let abortOnDigest = false;
  const f = gateFixture({ signal: abort.signal }, fakeDigestCrypto(() => { if (abortOnDigest) abort.abort(); }));
  await f.approve('a');
  abortOnDigest = true;
  assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), false);
});

test('gate: every digest goes through the injected crypto port, never the global', async () => {
  const globalDigest = vi.spyOn(globalThis.crypto.subtle, 'digest');
  try {
    const crypto = fakeDigestCrypto();
    const f = gateFixture({}, crypto);
    await f.approve('a');
    assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), true);
    assert.equal(crypto.calls(), 3, 'one digest at the prompt, one after the click, one before the handler');
    assert.equal(globalDigest.mock.calls.length, 0);
  } finally { globalDigest.mockRestore(); }
});

test('gate: a snapshot read fault after approval consumes the grant and reports the original failure', async () => {
  const failure = new Error('snapshot storage unavailable');
  let failReads = false;
  const f = gateFixture({ readSnapshot: async () => {
    if (failReads) throw failure;
    return { revision: 1 };
  } });
  await f.approve('a');
  assert.deepEqual(f.resumed, ['confirm']);
  failReads = true;
  assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), false);
  assert.deepEqual(f.errors, [failure]);
  failReads = false;
  assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), false);
});

test('gate: forgetting one approval does not consume another execution’s approval', async () => {
  const f = gateFixture();
  await f.approve('a');
  await f.approve('b');
  assert.deepEqual(f.resumed, ['confirm', 'confirm']);
  f.gate.forget({ executionId: 'a' });
  assert.equal(await f.gate.isApproved({ executionId: 'a', input: { q: 'x' } }), false);
  assert.equal(await f.gate.isApproved({ executionId: 'b', input: { q: 'x' } }), true);
});
