import { describe, expect, test } from 'vitest';
import { NOW, SCRIPTED, USD, world } from './harness.js';
import { newPayment } from '../../accounting/__tests__/harness.js';

const MINUTE = 60_000;
for (const ledgerKind of ['memory', 'sqlite'] as const) describe(`missed payment webhooks ${ledgerKind}`, () => {
  async function waiting(status: 'requires_action' | 'pending', key = status) {
    const w = await world({ ledgerKind });
    w.scripted.queue('createIntent', { kind: 'ok', value: { evidence: {
      providerRef: `session-${key}`, status, refunds: [], disputes: [],
    }, next: { kind: 'redirect', url: 'https://provider.example/checkout' } } });
    const result = await w.service.createIntent({ scope: SCRIPTED, amount: USD(10_000), idempotencyKey: key, reference: `order-${key}` });
    if (!result.ok) throw new Error('expected waiting payment');
    return { w, id: result.payment.id };
  }

  test.each(['requires_action', 'pending'] as const)('retrieves stale %s and writes paid evidence after a lost webhook', async status => {
    const { w, id } = await waiting(status);
    w.scripted.queue('retrieve', { kind: 'ok', value: { providerRef: `session-${status}`, status: 'succeeded', refunds: [], disputes: [] } });
    w.tick(14 * MINUTE);
    expect((await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 })).payments.scanned).toBe(0);
    expect(w.scripted.calls.filter(call => call.op === 'retrieve')).toHaveLength(0);
    w.tick(2 * MINUTE);
    expect((await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 })).payments).toEqual({ scanned: 1, settled: 1, failed: 0, left: 0, errors: 0 });
    const after = await w.read(id);
    expect(after.payment).toMatchObject({ intentStatus: 'succeeded', status: 'succeeded', capturedMinor: 10_000 });
    expect(after.evidence.at(-1)).toMatchObject({ source: 'retrieve', observedStatus: 'succeeded' });
    expect(after.outbox).toContain('payment.succeeded');
    expect(w.scripted.calls.filter(call => call.op === 'createIntent')).toHaveLength(1);
  });

  test('bounded cursor advances past an unavailable session without retrieving another scope', async () => {
    const w = await world({ ledgerKind });
    for (const [id, mode] of [['a-stuck', 'test'], ['b-paid', 'test'], ['foreign', 'live']] as const) {
      await w.ledger.transaction({ fn: tx => tx.insertPayment({ payment: newPayment({
        id, mode, providerId: 'scripted', providerRef: `session-${id}`, idempotencyKey: id,
        intentStatus: 'requires_action', status: 'requires_action', createdAt: 1, updatedAt: 1,
      }) }) });
    }
    w.scripted.queue('retrieve', { kind: 'unknown', error: { code: 'TRANSPORT_ERROR', message: 'provider unavailable', retryable: true } },
      { kind: 'ok', value: { providerRef: 'session-b-paid', status: 'succeeded', refunds: [], disputes: [] } });
    const first = await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 1 }, { scope: { workspaceId: 'ws', mode: 'test' } });
    expect(first.payments).toMatchObject({ scanned: 1, left: 1 });
    const second = await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 1 }, { scope: { workspaceId: 'ws', mode: 'test' } });
    expect(second.payments).toMatchObject({ scanned: 1, settled: 1 });
    expect(w.scripted.calls.map(call => call.req)).toEqual(['session-a-stuck', 'session-b-paid']);
    expect((await w.read('b-paid')).payment?.intentStatus).toBe('succeeded');
    expect(await w.ledger.transaction({ fn: tx => tx.getPayment({ workspaceId: 'ws', mode: 'live', id: 'foreign' }) }))
      .toMatchObject({ intentStatus: 'requires_action' });
  });

  test('an unchanged retrieved session writes no evidence, version or timestamp', async () => {
    const { w, id } = await waiting('requires_action');
    const before = await w.read(id);
    w.scripted.queue('retrieve', { kind: 'ok', value: {
      providerRef: 'session-requires_action', status: 'requires_action', refunds: [], disputes: [],
    } });
    w.tick(16 * MINUTE);
    expect((await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 })).payments.settled).toBe(1);
    expect(w.scripted.calls.filter(call => call.op === 'retrieve')).toHaveLength(1);
    expect(await w.read(id)).toEqual(before);
  });

  test('the first same-status observation is retained', async () => {
    const w = await world({ ledgerKind });
    await w.ledger.transaction({ fn: tx => tx.insertPayment({ payment: newPayment({
      providerId: 'scripted', providerRef: 'session-first', intentStatus: 'pending', status: 'pending',
      createdAt: NOW - 16 * MINUTE, updatedAt: NOW - 16 * MINUTE,
    }) }) });
    w.scripted.queue('retrieve', { kind: 'ok', value: {
      providerRef: 'session-first', status: 'pending', refunds: [], disputes: [],
    } });
    await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 });
    const after = await w.read('pay_1');
    expect(after.evidence).toEqual([expect.objectContaining({ source: 'retrieve', observedStatus: 'pending' })]);
    expect(after.payment?.version).toBe(2);
  });

  test('new action and settlement facts still write when the intent status is unchanged', async () => {
    const { w, id } = await waiting('requires_action');
    const before = await w.read(id);
    w.scripted.queue('retrieve', { kind: 'ok', value: {
      providerRef: 'session-requires_action', status: 'requires_action', refunds: [], disputes: [],
      next: { kind: 'redirect', url: 'https://provider.example/resume' }, settlement: { fee: USD(25) },
    } });
    w.tick(16 * MINUTE);
    await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 });
    const after = await w.read(id);
    expect(after.payment).toMatchObject({
      intentStatus: 'requires_action', version: before.payment!.version + 1, feeMinor: 25, feeCurrency: 'USD',
      nextActionJson: JSON.stringify({ kind: 'redirect', url: 'https://provider.example/resume' }),
    });
    expect(after.evidence).toHaveLength(before.evidence.length + 1);
  });

  test('an abandoned checkout is retrieved once at 15 minutes, one hour and expiry', async () => {
    const { w, id } = await waiting('requires_action');
    const snapshot = { kind: 'ok' as const, value: {
      providerRef: 'session-requires_action', status: 'requires_action' as const, refunds: [], disputes: [],
    } };
    w.scripted.queue('retrieve', snapshot, snapshot, {
      kind: 'ok', value: { ...snapshot.value, status: 'canceled' },
    });
    w.tick(16 * MINUTE);
    await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 });
    for (let minute = 17; minute <= 60; minute += 1) {
      w.tick(MINUTE);
      await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 });
    }
    expect(w.scripted.calls.filter(call => call.op === 'retrieve')).toHaveLength(2);
    w.tick(24 * 60 * MINUTE + 1);
    await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 10 });
    expect(w.scripted.calls.filter(call => call.op === 'retrieve')).toHaveLength(3);
    expect((await w.read(id)).payment?.intentStatus).toBe('canceled');
  });

  test('older abandoned checkouts cannot consume the unknown payment scan', async () => {
    const w = await world({ ledgerKind });
    for (const id of ['a-waiting', 'b-waiting']) await w.ledger.transaction({ fn: tx => tx.insertPayment({ payment: newPayment({
      id, providerId: 'scripted', providerRef: `session-${id}`, idempotencyKey: id,
      intentStatus: 'requires_action', status: 'requires_action', createdAt: 1, updatedAt: 1,
    }) }) });
    await w.ledger.transaction({ fn: tx => tx.insertPayment({ payment: newPayment({
      id: 'z-unknown', providerId: 'scripted', providerRef: 'session-z-unknown',
      updatedAt: NOW - 2 * MINUTE,
    }) }) });
    w.scripted.queue('retrieve',
      { kind: 'ok', value: { providerRef: 'session-z-unknown', status: 'succeeded', refunds: [], disputes: [] } },
      { kind: 'ok', value: { providerRef: 'session-a-waiting', status: 'requires_action', refunds: [], disputes: [] } },
    );
    await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 1 });
    expect((await w.read('z-unknown')).payment?.intentStatus).toBe('succeeded');
    expect(w.scripted.calls[0]?.req).toBe('session-z-unknown');
  });

  test('an expired checkout is canceled by retrieval without creating a replacement payment', async () => {
    const { w, id } = await waiting('requires_action');
    w.scripted.queue('retrieve', { kind: 'ok', value: { providerRef: 'session-requires_action', status: 'canceled', refunds: [], disputes: [] } });
    w.tick(16 * MINUTE);
    await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 1 });
    expect((await w.read(id)).payment).toMatchObject({ intentStatus: 'canceled', status: 'canceled', capturedMinor: 0 });
    expect(w.scripted.calls.map(call => call.op)).toEqual(['createIntent', 'retrieve']);
  });
});
