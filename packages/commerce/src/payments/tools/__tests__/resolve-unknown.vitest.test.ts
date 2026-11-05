import { ToolInputError, ToolPermissionDeniedError } from '@jini-ai/core';
import { expect, test, vi } from 'vitest';
import { buildCommerceResolutionRegistrations } from '../resolve-unknown.js';
import { SCRIPTED, USD, timedOut, world } from '../../ops/__tests__/harness.js';

const context = { executionId: 'exec', principal: { id: 'owner' }, run: { id: 'run' }, signal: new AbortController().signal };
const input = { orderId: 'order', outcome: 'failed', reason: 'Verified provider dashboard: no completed payment' };
function fixture() {
  const resolveUnknown = vi.fn(async () => ({ ok: true as const, payment: {} as never, refund: null }));
  const targetFor = vi.fn(async () => ({ paymentId: 'payment', scope: SCRIPTED }));
  const authorize = vi.fn(async () => ({ allowed: true, reason: 'matched' }));
  const required = { workspaceId: SCRIPTED.workspaceId, authorize, operator: { resolveUnknown }, targetFor };
  const call = (value: unknown) => buildCommerceResolutionRegistrations(required)[0]!.handler({ ...context, input: value });
  return { required, call, resolveUnknown, targetFor, authorize };
}

test('owner resolution uses the original order payment scope and authenticated actor after permission', async () => {
  const f = fixture();
  await f.call(input);
  expect(f.targetFor).toHaveBeenCalledTimes(1);
  expect(f.targetFor).toHaveBeenCalledWith({ orderId: 'order' });
  expect(f.resolveUnknown).toHaveBeenCalledTimes(1);
  expect(f.resolveUnknown).toHaveBeenCalledWith({ scope: SCRIPTED, paymentId: 'payment', outcome: 'failed', actor: 'owner', reason: input.reason });
  expect(f.authorize).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', principalId: 'owner', permission: 'admin.integrations.manage' }));
});

test('denied resolution does not discover or update an order payment', async () => {
  const f = fixture(); f.authorize.mockResolvedValue({ allowed: false, reason: 'denied' });
  await expect(f.call(input)).rejects.toBeInstanceOf(ToolPermissionDeniedError);
  expect(f.targetFor).not.toHaveBeenCalled(); expect(f.resolveUnknown).not.toHaveBeenCalled();
});

test('foreign scope and unbound orders cannot be resolved', async () => {
  const f = fixture();
  f.targetFor.mockResolvedValue({ paymentId: 'payment', scope: { ...SCRIPTED, workspaceId: 'foreign' } });
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
    operator: w.operator, targetFor: async () => ({ scope: SCRIPTED, paymentId: result.payment!.id }) });
  expect(await registration!.handler({ ...context, input })).toMatchObject({ ok: true, payment: { status: 'failed' } });
  const after = await w.read(result.payment.id);
  expect(after.actions).toEqual([expect.objectContaining({ actor: 'owner', reason: input.reason, outcome: 'failed' })]);
  expect(after.evidence.at(-1)).toMatchObject({ source: 'operator', observedStatus: 'failed' });
  expect(w.scripted.calls).toHaveLength(1);
});
