import { expect, it, vi } from 'vitest';
import { createStorageRoutes } from '../routes.js';
import { createRetentionRunner } from '../runner.js';

const routes = createStorageRoutes({ paths: { report: '/report', cleanup: '/cleanup' } }, {});
const copy = { invalidClass: 'Choose only cache, derived, or old-copy data.' };
it('cleanup defaults to dryRun', async () => {
  const runOnce = vi.fn(async () => ({})), authorize = vi.fn();
  const parsed = routes.cleanup.parse({ body: {}, params: {}, query: {} });
  if (!parsed.ok) throw new Error('parse failed');
  await routes.cleanup.handle({ input: parsed.value, deps: { runOnce, copy }, authorize }, {});
  expect(runOnce).toHaveBeenCalledWith({ dryRun: true }, {});
  expect(authorize).toHaveBeenCalledWith({ permission: 'storage.manage' });
  expect(routes.cleanup.requireSameOrigin).toBe(true);
});
it('content class refused in plain words', async () => {
  for (const dryRun of [true, false]) {
    const runOnce = vi.fn();
    expect(await routes.cleanup.handle({ input: { dryRun, classes: ['content'] }, deps: { runOnce, copy }, authorize: vi.fn() }, {})).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: copy.invalidClass } });
    expect(runOnce).not.toHaveBeenCalled();
  }
});
it('owner role only', async () => {
  const measure = vi.fn(), runOnce = vi.fn();
  const authorize = vi.fn(async ({ permission }: { permission: string }) => { expect(permission).toBe('storage.manage'); throw new Error('Owner only'); });
  await expect(routes.report.handle({ input: {}, deps: { measure }, authorize }, {})).rejects.toThrow('Owner only');
  await expect(routes.cleanup.handle({ input: {}, deps: { runOnce, copy }, authorize }, {})).rejects.toThrow('Owner only');
  expect(measure).not.toHaveBeenCalled(); expect(runOnce).not.toHaveBeenCalled();
});
it('a dry run during a live pass still returns measurement', async () => {
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const measure = vi.fn(async () => ({ bytes: 5 }));
  const runner = createRetentionRunner({ policies: [{ id: 'cache', kind: 'cache', measure, sweep: async () => { started(); await pending; return { freedBytes: 1, removed: 1 }; } }], clock: { now: () => 1 }, scheduler: { setInterval: vi.fn(), clearInterval: vi.fn() }, reportError: vi.fn() }, {});
  const live = runner.runOnce({ dryRun: false }); await entered;
  const dry = routes.cleanup.handle({ input: {}, deps: { runOnce: input => runner.runOnce(input), copy }, authorize: vi.fn() }, {});
  release(); await live;
  expect(await dry).toMatchObject({ ok: true, value: { dryRun: true, policies: [{ status: 'measured', measurement: { bytes: 5 } }] } });
  await runner.stop();
});
