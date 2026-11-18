import { expect, it } from 'vitest';
import { publishArgs } from '../publish-pending.js';

it('publishes a stable version with no explicit dist-tag', () => {
  expect(publishArgs({ tarball: '/t/a.tgz', version: '0.7.1' })).toEqual(['publish', '/t/a.tgz', '--access', 'public', '--provenance']);
});

it.each(['0.7.1-next.0', '1.0.0-rc.1', '2.0.0-beta'])('publishes prerelease %s with --tag next so latest never moves', (version) => {
  const args = publishArgs({ tarball: '/t/a.tgz', version });
  expect(args).toEqual(['publish', '/t/a.tgz', '--access', 'public', '--provenance', '--tag', 'next']);
  expect(args).not.toContain('latest');
});
