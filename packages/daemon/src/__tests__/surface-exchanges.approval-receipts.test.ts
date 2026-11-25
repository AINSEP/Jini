import { expect, test, vi } from 'vitest';
import type { ApprovalReceiptObserver, SurfaceEmission, SurfaceEmitter } from '@jini-ai/core';
import { createSurfaceExchangeStore } from '../surface-exchanges.js';

/**
 * @file P3-T3.J: the authoritative exchange reports `open`, then at most one `answered` or `ended`,
 * to an observe-only callback. The observer can never redeem, repeat or change an answer.
 */
const card: SurfaceEmission = { channel: 'mcp-ui', payload: { resource: { resource: { uri: 'ui://card', text: '<form></form>' } } } };

function fixture({ leased = true, onEmit }: { leased?: boolean; onEmit?: () => void } = {}) {
  let nextId = 0;
  const store = createSurfaceExchangeStore({ scheduler: { schedule: vi.fn(() => () => {}) }, clock: { nowMs: () => 0 },
    idGenerator: { newId: () => `card-${++nextId}` }, defaultChannel: 'mcp-ui' });
  const abort = new AbortController();
  const base = async () => { onEmit?.(); };
  const emit: SurfaceEmitter = leased ? Object.assign(base, { exchangeLifetime: {
    signal: abort.signal, runId: 'run-1', toolId: 'routine_delete', principalId: 'owner', retry: async () => {},
  } }) : base;
  const receipts: Parameters<ApprovalReceiptObserver>[0][] = [];
  const observer = vi.fn<ApprovalReceiptObserver>((input) => { receipts.push(input); });
  const open = (onApprovalReceipt: ApprovalReceiptObserver = observer) =>
    store.open({ binding: { principalId: 'owner', toolId: 'routine_delete' }, emit }, { onApprovalReceipt });
  return { store, abort, receipts, observer, open };
}

test('receipts arrive in order: open after the first emission, then one answered', async () => {
  const f = fixture();
  const exchange = f.open();
  expect(f.receipts).toEqual([]);
  await exchange.send({ emission: card });
  expect(f.receipts).toEqual([{ receipt: { exchangeId: 'card-1', kind: 'open' }, runId: 'run-1', principalId: 'owner' }]);
  const answer = exchange.receive({});
  expect(f.store.deliver({ exchangeId: 'card-1', principalId: 'owner', params: { decision: 'confirm' } })).toEqual({ ok: true });
  expect(f.receipts.map((r) => r.receipt)).toEqual([
    { exchangeId: 'card-1', kind: 'open' }, { exchangeId: 'card-1', kind: 'answered', confirmed: true }]);
  expect(await answer).toEqual({ status: 'received', params: { decision: 'confirm' } });
  exchange.close({}); // a normal close after the answer must not turn "owner said yes" into "ended"
  expect(f.receipts).toHaveLength(2);
});

test('the answered receipt is reported before the waiting handler resumes', async () => {
  const f = fixture();
  const exchange = f.open();
  await exchange.send({ emission: card });
  const seenAtResume: number[] = [];
  const answer = exchange.receive({}).then((m) => { seenAtResume.push(f.receipts.length); return m; });
  f.store.deliver({ exchangeId: 'card-1', principalId: 'owner', params: { decision: 'cancel' } });
  await answer;
  expect(seenAtResume).toEqual([2]);
  expect(f.receipts[1]!.receipt).toEqual({ exchangeId: 'card-1', kind: 'answered', confirmed: false });
});

test('a fast answer during the first emission still reports open before answered', async () => {
  let deliver = () => {};
  const f = fixture({ onEmit: () => deliver() });
  const exchange = f.open();
  deliver = () => { f.store.deliver({ exchangeId: exchange.id, principalId: 'owner', params: { decision: 'confirm' } }); };
  await exchange.send({ emission: card });
  expect(f.receipts.map((r) => r.receipt.kind)).toEqual(['open', 'answered']);
  expect(await exchange.receive({})).toEqual({ status: 'received', params: { decision: 'confirm' } });
});

test('a wrong principal, a wrong tool and a duplicate delivery report nothing', async () => {
  const f = fixture();
  const exchange = f.open();
  await exchange.send({ emission: card });
  expect(f.store.deliver({ exchangeId: 'card-1', principalId: 'intruder', params: { decision: 'confirm' } }).ok).toBe(false);
  expect(f.store.deliver({ exchangeId: 'card-1', principalId: 'owner', params: { decision: 'confirm' } }, { toolId: 'other' }).ok).toBe(false);
  expect(f.receipts.map((r) => r.receipt.kind)).toEqual(['open']);
  f.store.deliver({ exchangeId: 'card-1', principalId: 'owner', params: { decision: 'cancel' } });
  f.store.deliver({ exchangeId: 'card-1', principalId: 'owner', params: { decision: 'confirm' } }); // queued duplicate
  expect(f.receipts.map((r) => r.receipt)).toEqual([
    { exchangeId: 'card-1', kind: 'open' }, { exchangeId: 'card-1', kind: 'answered', confirmed: false }]);
});

test('a run abort with no answer reports ended abandoned; nothing is reported before the card was emitted', async () => {
  const f = fixture();
  const silent = f.open();
  silent.close({}); // ended before any emission: there is no waiting card to expire
  expect(f.receipts).toEqual([]);
  const exchange = f.open();
  await exchange.send({ emission: card });
  f.abort.abort();
  expect(f.receipts.map((r) => r.receipt)).toEqual([
    { exchangeId: 'card-2', kind: 'open' }, { exchangeId: 'card-2', kind: 'ended', reason: 'abandoned' }]);
  expect(await exchange.receive({})).toEqual({ status: 'abandoned' });
});

test('an unleased exchange never reports, even when an observer is injected', async () => {
  const f = fixture({ leased: false });
  const exchange = f.open();
  await exchange.send({ emission: card });
  f.store.deliver({ exchangeId: 'card-1', principalId: 'owner', params: { decision: 'confirm' } });
  exchange.close({});
  expect(f.observer).not.toHaveBeenCalled();
});

test('observer that throws changes neither the answer nor the effect count', async () => {
  for (const observer of [
    () => { throw new Error('observer down'); },
    () => Promise.reject(new Error('async observer down')) as unknown as void,
  ] satisfies ApprovalReceiptObserver[]) {
    const f = fixture();
    let effects = 0;
    const exchange = f.open(observer);
    await exchange.send({ emission: card });
    const handler = exchange.receive({}).then((m) => { if (m.status === 'received' && m.params['decision'] === 'confirm') effects += 1; return m; });
    expect(f.store.deliver({ exchangeId: exchange.id, principalId: 'owner', params: { decision: 'confirm' } })).toEqual({ ok: true });
    expect(await handler).toEqual({ status: 'received', params: { decision: 'confirm' } });
    expect(effects).toBe(1);
    expect(f.store.size()).toBe(1);
  }
});
