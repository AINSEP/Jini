import { expect, it, vi } from 'vitest';

// The module's release checks import built plugin hosts; these cases exercise only the argument list.
vi.mock('../check-plugin-packages.js', () => ({ checkPluginReleaseConsistency: vi.fn() }));
import { npmPublishArgs } from '../publish-pending.js';

it('a prerelease version publishes under the next dist-tag, never latest', () => {
  expect(npmPublishArgs({ tarball: '/tmp/core.tgz', version: '0.7.3-next.1' })).toEqual(
    ['publish', '/tmp/core.tgz', '--access', 'public', '--provenance', '--tag', 'next'],
  );
});

it('a stable version keeps the default latest dist-tag', () => {
  expect(npmPublishArgs({ tarball: '/tmp/core.tgz', version: '0.7.3' })).toEqual(
    ['publish', '/tmp/core.tgz', '--access', 'public', '--provenance'],
  );
});
