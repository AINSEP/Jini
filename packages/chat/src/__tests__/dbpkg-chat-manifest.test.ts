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
  const expectedPeers = {
    'react': '^18.3.0 || ^19.0.0',
    'react-dom': '^18.3.0 || ^19.0.0',
    '@jini-ai/db': '^0.2.0 || ^0.3.0',
    'kysely': '^0.29.6',
    'better-sqlite3': '^13.0.0',
    '@electric-sql/pglite': '0.5.8',
    'pg': '^8.23.0',
    '@ag-ui/core': '0.0.58',
    '@mcp-ui/client': '7.1.1',
    '@radix-ui/react-checkbox': '^1.3.11',
    '@radix-ui/react-label': '^2.1.15',
    '@radix-ui/react-radio-group': '^1.4.7',
    '@radix-ui/react-select': '^2.3.7',
    '@radix-ui/react-slot': '^1.3.3',
    'recharts': '^3.10.1',
    '@jini-ai/agent-runtime': '^0.4.4',
    '@jini-ai/agentic': '^0.4.2',
    '@jini-ai/protocol': '^0.4.3',
    '@jini-ai/ui': '^0.4.7',
    '@jini-ai/diagnostics': '^0.5.0',
  };
  expect(manifest.peerDependencies).toEqual(expectedPeers);
  expect(manifest.peerDependenciesMeta).toEqual(
    Object.fromEntries(Object.keys(expectedPeers).map(name => [name, { optional: true }])),
  );
  expect(manifest.devDependencies['@ag-ui/core']).toBe('0.0.58');
  expect(manifest.devDependencies['@jini-ai/agent-runtime']).toBe('workspace:*');
  // SQL stores and surface cards use core's default clock at runtime, so core is required.
  expect(manifest.dependencies).toEqual({ '@jini-ai/core': 'workspace:^' });
});
