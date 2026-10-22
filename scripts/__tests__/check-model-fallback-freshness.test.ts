import { expect, it } from 'vitest';
import { checkModelFallbackFreshness } from '../check-model-fallback-freshness.js';

it('guards Antigravity against newly reported models missing from its fallback', async () => {
  const violations = await checkModelFallbackFreshness({
    now: new Date('2026-10-18T00:00:00Z'),
    probeLive: async target => target.agentId === 'antigravity'
      ? { kind: 'ids', ids: ['gemini-next-argon-high'] }
      : { kind: 'skipped', reason: 'Unrelated fixture' },
    report: () => {},
  });
  expect(violations.some(violation => violation.file.endsWith('/antigravity.ts')
    && violation.reason.includes('gemini-next-argon-high'))).toBe(true);
});
