import { expect, it, vi } from 'vitest';
import { dispatchSiteServingGate, siteServingDecision } from '../site-serving-gate.js';

it('exempts admin paths before status reads and blocks an ordinary public slug', async () => {
  const readStatus = vi.fn(async () => 'BLOCKED_PENDING_RECOVERY' as const);
  const required = { exactPaths: new Set(['/admin']), prefixes: ['/admin/'], readStatus };
  expect(await siteServingDecision({ ...required, path: '/admin/settings' })).toBe('serve');
  expect(readStatus).not.toHaveBeenCalled();
  expect(await siteServingDecision({ ...required, path: '/admin-news' })).toBe('blocked');
  expect(readStatus).toHaveBeenCalledTimes(1);
});

it('dispatches exact and prefix skips without reading status', async () => {
  const readStatus = vi.fn(async () => 'BLOCKED_PENDING_RECOVERY' as const);
  const serve = vi.fn(); const blocked = vi.fn(); const failure = vi.fn();
  const required = { exactPaths: new Set(['/recovery']), prefixes: ['/recovery/'], readStatus, serve, blocked, failure };
  await dispatchSiteServingGate({ ...required, path: '/recovery' });
  await dispatchSiteServingGate({ ...required, path: '/recovery/status' });
  expect(readStatus).not.toHaveBeenCalled(); expect(serve).toHaveBeenCalledTimes(2);
  expect(blocked).not.toHaveBeenCalled(); expect(failure).not.toHaveBeenCalled();
});

it('reads once and dispatches the blocked reply without serving', async () => {
  const readStatus = vi.fn(async () => 'BLOCKED_PENDING_RECOVERY' as const);
  const serve = vi.fn(); const blocked = vi.fn(); const failure = vi.fn();
  await dispatchSiteServingGate({ path: '/recovery-news', exactPaths: new Set(['/recovery']), prefixes: ['/recovery/'], readStatus, serve, blocked, failure });
  expect(readStatus).toHaveBeenCalledTimes(1); expect(blocked).toHaveBeenCalledOnce();
  expect(serve).not.toHaveBeenCalled(); expect(failure).not.toHaveBeenCalled();
});

it('forwards status-store rejection before either reply', async () => {
  const error = new Error('status unavailable');
  const readStatus = vi.fn(async () => { throw error; });
  const serve = vi.fn(); const blocked = vi.fn(); const failure = vi.fn();
  await dispatchSiteServingGate({ path: '/page', exactPaths: new Set(), prefixes: [], readStatus, serve, blocked, failure });
  expect(readStatus).toHaveBeenCalledTimes(1); expect(failure).toHaveBeenCalledWith(error);
  expect(serve).not.toHaveBeenCalled(); expect(blocked).not.toHaveBeenCalled();
});

it('serves public traffic while a migration is only pending', async () => {
  const readStatus = vi.fn(async () => 'PENDING_MIGRATION' as const);
  const serve = vi.fn();
  const blocked = vi.fn();
  const failure = vi.fn();
  await dispatchSiteServingGate({ path: '/news', exactPaths: new Set(), prefixes: [], readStatus, serve, blocked, failure });
  expect(readStatus.mock.calls).toEqual([[]]);
  expect(serve.mock.calls).toEqual([[]]);
  expect(blocked.mock.calls).toEqual([]);
  expect(failure.mock.calls).toEqual([]);
});
