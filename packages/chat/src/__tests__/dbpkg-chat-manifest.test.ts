import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// This contract intentionally checks the real manifest. A merge fragment alone does not make a
// package subpath resolvable; the coordinator must apply it before this package can be released.
it('publishes every isolated extraction entry with its browser or universal classification', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const merge = JSON.parse(readFileSync(new URL('./fixtures/chat-subpaths.json', import.meta.url), 'utf8'));
  for (const [entry, value] of Object.entries(merge.exports)) {
    expect(manifest.exports[entry]).toEqual(value);
    expect(manifest.jini.entries[entry]).toBe(merge.jini.entries[entry]);
    expect(manifest.typesVersions['*'][entry.slice(2)]).toEqual(merge.typesVersions['*'][entry.slice(2)]);
  }
  expect(manifest.peerDependencies['@ag-ui/core']).toBe('0.0.58');
  expect(manifest.peerDependenciesMeta['@ag-ui/core']).toEqual({ optional: true });
  expect(manifest.devDependencies['@ag-ui/core']).toBe('0.0.58');
  expect(manifest.devDependencies['@jini-ai/agent-runtime']).toBe('workspace:*');
  expect(manifest.dependencies['@ag-ui/core']).toBeUndefined();
});
