import { assertToolIsWirable, ToolInputError, ToolPermissionDeniedError } from '@jini-ai/core';
import { expect, test, vi } from 'vitest';
import { buildCommerceResolutionRegistrations } from '../resolve-unknown.js';
import { SCRIPTED, USD, timedOut, world } from '../../ops/__tests__/harness.js';

const context = { executionId: 'exec', principal: { id: 'owner' }, run: { id: 'run' }, signal: new AbortController().signal };
const input = { orderId: 'order', outcome: 'failed', reason: 'Verified provider dashboard: no completed payment' };
function fixture() {
  const resolveUnknown = vi.fn(async () => ({ ok: true as const, payment: {} as never, refund: null }));
  const targetFor = vi.fn(async () => ({ paymentId: 'payment', scope: SCRIPTED, amount: USD(100) }));
  const authorize = vi.fn(async () => ({ allowed: true, reason: 'matched' }));
  const askHuman = vi.fn(async () => ({ confirmed: true as const }));
  const required = { askHuman, workspaceId: SCRIPTED.workspaceId, authorize, operator: { resolveUnknown }, targetFor };
  const call = (value: unknown) => buildCommerceResolutionRegistrations(required)[0]!.handler({ ...context, input: value });
  return { required, call, resolveUnknown, targetFor, authorize, askHuman };
}

test('owner resolution uses the original order payment scope and authenticated actor after permission', async () => {
  const f = fixture();
  await f.call(input);
  expect(f.targetFor).toHaveBeenCalledTimes(1);
  expect(f.targetFor).toHaveBeenCalledWith({ orderId: 'order' });
  expect(f.resolveUnknown).toHaveBeenCalledTimes(1);
  expect(f.resolveUnknown).toHaveBeenCalledWith({ scope: SCRIPTED, paymentId: 'payment', outcome: 'failed', actor: 'owner', reason: input.reason });
  expect(f.authorize).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', principalId: 'owner', permission: 'commerce.payments.manage' }));
});

test('denied resolution does not discover or update an order payment', async () => {
  const f = fixture(); f.authorize.mockResolvedValue({ allowed: false, reason: 'denied' });
  await expect(f.call(input)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
  expect(f.targetFor).not.toHaveBeenCalled(); expect(f.resolveUnknown).not.toHaveBeenCalled();
});

test('foreign scope and unbound orders cannot be resolved', async () => {
  const f = fixture();
  f.targetFor.mockResolvedValue({ paymentId: 'payment', scope: { ...SCRIPTED, workspaceId: 'foreign' }, amount: USD(100) });
  expect(await f.call(input)).toMatchObject({ ok: false });
  expect(f.resolveUnknown).not.toHaveBeenCalled();
  f.targetFor.mockResolvedValue(null as never);
  expect(await f.call(input)).toMatchObject({ ok: false });
});

test.each([{ ...input, scope: SCRIPTED }, { ...input, actor: 'invented' }, { ...input, outcome: 'paid' }, { ...input, reason: ' ' }])('rejects untrusted scope, actor or unsupported resolution %j', async value => {
  const f = fixture(); await expect(f.call(value)).rejects.toBeInstanceOf(ToolInputError);
  expect(f.resolveUnknown).not.toHaveBeenCalled();
});

test('an expired ambiguous payment is resolved through the single writer and append-only audit', async () => {
  const w = await world();
  Object.assign(w.scripted.provider, { intentReplayWindowMs: 23 * 60 * 60_000 });
  w.scripted.queue('createIntent', timedOut());
  const result = await w.service.createIntent({ scope: SCRIPTED, amount: USD(100), idempotencyKey: 'key', reference: 'order' });
  if (result.ok || !result.payment) throw new Error('expected unknown');
  w.tick(24 * 60 * 60_000);
  const [registration] = buildCommerceResolutionRegistrations({ workspaceId: 'ws', authorize: async () => ({ allowed: true, reason: 'matched' }),
    askHuman: async () => ({ confirmed: true }), operator: w.operator, targetFor: async () => ({ scope: SCRIPTED, paymentId: result.payment!.id, amount: USD(100) }) });
  expect(await registration!.handler({ ...context, input })).toMatchObject({ ok: true, payment: { status: 'failed' } });
  const after = await w.read(result.payment.id);
  expect(after.actions).toEqual([expect.objectContaining({ actor: 'owner', reason: input.reason, outcome: 'failed' })]);
  expect(after.evidence.at(-1)).toMatchObject({ source: 'operator', observedStatus: 'failed' });
  expect(w.scripted.calls).toHaveLength(1);
});


test('a declined resolution card leaves the payment, evidence and audit unchanged', async () => {
  const w = await world();
  w.scripted.queue('createIntent', timedOut());
  const result = await w.service.createIntent({ scope: SCRIPTED, amount: USD(100), idempotencyKey: 'declined', reference: 'order' });
  if (result.ok || !result.payment) throw new Error('expected unknown');
  const before = await w.read(result.payment.id);
  const askHuman = vi.fn(async () => ({ confirmed: false as const, reason: 'declined' as const }));
  const [registration] = buildCommerceResolutionRegistrations({ workspaceId: 'ws', authorize: async () => ({ allowed: true, reason: 'matched' }),
    askHuman, operator: w.operator, targetFor: async () => ({ scope: SCRIPTED, paymentId: result.payment!.id, amount: USD(100) }) });
  expect(await registration!.handler({ ...context, input: { ...input, outcome: 'succeeded' } })).toMatchObject({ ok: false, reason: 'declined' });
  expect(askHuman).toHaveBeenCalledTimes(1);
  expect(askHuman.mock.calls[0]?.[0]).toMatchObject({ description: { orderId: 'order', paymentId: result.payment.id, amount: USD(100), mode: 'test', outcome: 'succeeded' } });
  expect(await w.read(result.payment.id)).toEqual(before);
  expect(w.scripted.calls).toHaveLength(1);
});

test('resolution declares a human-only actor and rechecks permission after approval', async () => {
  const f = fixture();
  const registration = buildCommerceResolutionRegistrations(f.required)[0]!;
  expect(() => assertToolIsWirable({ toolId: 'commerce_resolve_unknown',
    catalogEntry: { name: 'commerce_resolve_unknown', description: 'Resolve', sideEffects: 'mutates-durable-state', authorization: { permission: 'commerce.payments.manage' }, actorClassRule: 'confirmer-must-equal-own-delegatedBy' },
    derivedRisk: new Map([['commerce_resolve_unknown', 'mutates-durable-state']]) }, { handler: registration.handler })).not.toThrow();
  f.askHuman.mockImplementation(async () => {
    f.authorize.mockResolvedValue({ allowed: false, reason: 'revoked' });
    return { confirmed: true };
  });
  await expect(f.call(input)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
  expect(f.resolveUnknown).not.toHaveBeenCalled();
});
