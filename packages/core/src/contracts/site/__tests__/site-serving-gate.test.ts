import { expect, it, vi } from 'vitest';
import { siteServingDecision } from '../site-serving-gate.js';

it('exempts admin paths before status reads and blocks an ordinary public slug', async () => {
  const readStatus = vi.fn(async () => 'BLOCKED_PENDING_RECOVERY' as const);
  const required = { exactPaths: new Set(['/admin']), prefixes: ['/admin/'], readStatus };
  expect(await siteServingDecision({ ...required, path: '/admin/settings' })).toBe('serve');
  expect(readStatus).not.toHaveBeenCalled();
  expect(await siteServingDecision({ ...required, path: '/admin-news' })).toBe('blocked');
  expect(readStatus).toHaveBeenCalledTimes(1);
});
