import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { stageTransitiveDependencies } from '../staging.js';
import type { PackageResolverPort } from '../ports.js';
import { effects, memoryFs } from './memory-fs.js';

const manifestOf = (name: string, version: string, dependencies: Record<string, string> = {}) => JSON.stringify({ name, version, dependencies });
const resolver: PackageResolverPort = {
  resolve: ({ fromDirectory, packageName }) => (fromDirectory === '/w/lib' && packageName === 'debug' ? '/w/lib/node_modules/debug' : `/store/${packageName}`),
};

/**
 * A workspace package the caller already staged at /out/node_modules/@w/lib needs debug@2, while the
 * top level already ships debug@4. Only a caller that says where the root sits lets its edge nest.
 */
function workspaceRootFixture() {
  return memoryFs({ files: {
    '/w/lib/package.json': manifestOf('@w/lib', '1.0.0', { debug: '2' }),
    '/w/lib/node_modules/debug/package.json': manifestOf('debug', '2.6.9'),
    '/out/node_modules/@w/lib/package.json': manifestOf('@w/lib', '1.0.0', { debug: '2' }),
    '/out/node_modules/debug/package.json': manifestOf('debug', '4.4.3'),
  } });
}
const base = { roots: ['/w/lib'], outDir: '/out', excluded: new Set<string>() };

describe('stageTransitiveDependencies rootDestinations', () => {
  test('a conflicting edge of a supplied root nests under the root\'s staged destination', () => {
    const fs = workspaceRootFixture();
    const count = stageTransitiveDependencies({ ...base, fs, resolver }, { rootDestinations: new Map([['/w/lib', '/out/node_modules/@w/lib']]) });
    assert.equal(count, 1);
    assert.deepEqual(effects(fs).map(call => call.op === 'copy' && `${call.from} -> ${call.to}`), [
      '/w/lib/node_modules/debug -> /out/node_modules/@w/lib/node_modules/debug',
    ]);
  });

  test('without the map the supplied root still fails closed on a conflict', () => {
    const fs = workspaceRootFixture();
    assert.throws(() => stageTransitiveDependencies({ ...base, fs, resolver }), { message: /^Package version conflict while flattening debug: / });
    assert.deepEqual(effects(fs), []);
  });

  test('a map with no entry for that root still fails closed', () => {
    const fs = workspaceRootFixture();
    assert.throws(
      () => stageTransitiveDependencies({ ...base, fs, resolver }, { rootDestinations: new Map([['/elsewhere', '/out/node_modules/@w/other']]) }),
      { message: /^Package version conflict while flattening debug: / },
    );
  });
});
