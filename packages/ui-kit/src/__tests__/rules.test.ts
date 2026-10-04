import { describe, it, expect, vi } from 'vitest';
import { needs, planConfirm, createConfirmController, createToastService, kitSpec, KIT_CONTRACT } from '../index.js';
describe('framework-free contract and confirmation rules', () => {
  it('declares implemented requirements and rejects planned or incompatible ones', () => {
    expect(needs({ id: 'composer', components: ['Button', 'TextArea'] }).components).toEqual(['Button', 'TextArea']);
    expect(() => needs({ id: 'future', components: ['Table'] })).toThrow('planned');
    expect(() => needs({ id: 'future', components: ['Button'] }, { contract: '^2' })).toThrow('incompatible');
    expect(() => needs({ id: 'future', components: ['Button'] }, { contract: '^1.1' })).toThrow('incompatible');
    expect(KIT_CONTRACT.version).toBe('1.0.0'); expect(kitSpec.Table.status).toBe('planned');
    expect(typeof window).toBe('undefined');
  });
  it('plans cancel-first focus and consequence labels without depending on an agent runtime', () => {
    const plan = planConfirm({ open: true, title: 'Delete record?', confirmLabel: 'Delete', tone: 'danger', agentHandle: 'erase', agentMayConfirm: false });
    expect(plan.initialFocus).toBe('cancel'); expect(plan.confirm).toBeUndefined();
    expect(plan.cancel?.handle).toBe('erase-cancel'); expect(plan.confirmLabel).toBe('Delete — Delete record?; cannot be undone');
    expect(planConfirm({ open: true, title: 'Change access?', confirmLabel: 'Apply', tone: 'warning' }).consequence).toBe('changes access, but is reversible');
  });
  it('reads current pending/open state, including when a view keeps stale handlers', async () => {
    let policy = { open: true, title: 'Delete?', confirmLabel: 'Delete', pending: true, agentMayConfirm: false };
    const onCancel = vi.fn(), onConfirm = vi.fn();
    const c = createConfirmController({ read: () => policy, onCancel, onConfirm });
    for (const reason of ['escape', 'backdrop', 'cancel-button', 'close'] as const) expect(c.requestDismiss({ reason })).toBe(false);
    expect(await c.confirm({})).toBe(false);
    policy = { ...policy, pending: false };
    expect(await c.confirm({ actor: 'agent' })).toBe(false);
    expect(await c.confirm({ actor: 'human' })).toBe(true); expect(onConfirm).toHaveBeenCalledTimes(1);
    policy = { ...policy, open: false };
    expect(await c.confirm({})).toBe(false); expect(c.requestDismiss({ reason: 'close' })).toBe(false); expect(onCancel).not.toHaveBeenCalled();
  });
  it('synchronously gates duplicate execution and every dismissal until settlement, then permits retry', async () => {
    let reject: (error: Error) => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((_resolve, r) => { reject = r; })), onCancel = vi.fn();
    const c = createConfirmController({ read: () => ({ open: true, title: 'Delete?', confirmLabel: 'Delete' }), onConfirm, onCancel });
    const first = c.confirm({});
    expect(c.isExecuting({})).toBe(true); expect(await c.confirm({})).toBe(false);
    for (const reason of ['escape', 'backdrop', 'cancel-button', 'close'] as const) expect(c.requestDismiss({ reason })).toBe(false);
    reject(new Error('failed')); await expect(first).rejects.toThrow('failed');
    expect(c.isExecuting({})).toBe(false); expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(c.requestDismiss({ reason: 'close' })).toBe(true); expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
describe('toast service ports', () => {
  it('publishes stable snapshots, replaces ids, schedules dismissal and disposes timers', () => {
    const scheduled = new Map<number, () => void>(); let next = 0;
    const cancel = vi.fn(({ ticket }: { ticket: unknown }) => { scheduled.delete(ticket as number); });
    const service = createToastService({}, { scheduler: { schedule: ({ run }) => { scheduled.set(++next, () => run({})); return next; }, cancel } });
    const listener = vi.fn(), unsubscribe = service.subscribe({ listener });
    expect(service.snapshot({})).toBe(service.snapshot({}));
    const id = service.push({ message: 'Saved' }); expect(service.snapshot({})).toEqual([{ id, message: 'Saved' }]);
    service.push({ message: 'Updated', durationMs: 0 }, { id }); expect(cancel).toHaveBeenCalledTimes(1);
    expect(service.snapshot({})).toEqual([{ id, message: 'Updated', durationMs: 0 }]);
    service.push({ message: 'Timed' }); scheduled.get(next)!();
    expect(service.snapshot({})).toHaveLength(1);
    unsubscribe(); service.dispose({}); expect(service.snapshot({})).toEqual([]);
    expect(() => service.push({ message: 'Too late' })).toThrow('disposed');
  });
});
