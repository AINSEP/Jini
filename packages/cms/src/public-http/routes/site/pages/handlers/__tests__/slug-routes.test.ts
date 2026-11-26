import { expect, it } from 'vitest';
import { nestedPageRoute } from '../slug-routes.js';

it('keeps nested redirect phases in order before fallthrough', async () => {
  const phases: string[] = [];
  expect(await nestedPageRoute({ path: '/nested/path', tryRedirectPhase: async ({ phase }) => { phases.push(phase); return false; } })).toEqual({ kind: 'next' });
  expect(phases).toEqual(['pre_content', 'post_content']);
});
