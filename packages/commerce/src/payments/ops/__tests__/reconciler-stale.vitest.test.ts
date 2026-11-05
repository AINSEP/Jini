import { describe, expect, test } from 'vitest';
import { SCRIPTED, USD, world } from './harness.js';
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

  test('an expired checkout is canceled by retrieval without creating a replacement payment', async () => {
    const { w, id } = await waiting('requires_action');
    w.scripted.queue('retrieve', { kind: 'ok', value: { providerRef: 'session-requires_action', status: 'canceled', refunds: [], disputes: [] } });
    w.tick(16 * MINUTE);
    await w.operator.reconcileUnknown({ olderThanMs: MINUTE, limit: 1 });
    expect((await w.read(id)).payment).toMatchObject({ intentStatus: 'canceled', status: 'canceled', capturedMinor: 0 });
    expect(w.scripted.calls.map(call => call.op)).toEqual(['createIntent', 'retrieve']);
  });
});
