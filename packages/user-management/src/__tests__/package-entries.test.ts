import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('every published entry has matching runtime metadata and a source module', () => {
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  for (const [entry, value] of Object.entries(manifest.exports)) {
    const paths = value as { types: string; import: string; default: string };
    expect(paths.types).toBe(paths.import.replace(/\.js$/, '.d.ts'));
    expect(paths.default).toBe(paths.import);
    const source = paths.import.replace('./dist/', './src/').replace(/\.js$/, '.ts');
    expect(readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8').length, entry).toBeGreaterThan(0);
    expect(manifest.jini.entries[entry]).toBe(entry.startsWith('./react') ? 'browser' : entry === './server' ? 'node' : 'universal');
  }
});

test('React dependencies are optional peers and available to package development', () => {
  for (const name of ['react', 'react-dom', '@jini-ai/ui', '@jini-ai/admin', '@jini-ai/agentic']) {
    expect(manifest.peerDependencies[name], name).toBeTruthy();
    expect(manifest.peerDependenciesMeta[name], name).toEqual({ optional: true });
    expect(manifest.devDependencies[name], name).toBeTruthy();
    expect(manifest.dependencies?.[name], name).toBeUndefined();
  }
  expect(manifest.peerDependenciesMeta.argon2).toEqual({ optional: true });
});
