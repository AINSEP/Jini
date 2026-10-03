import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('declares each independent subpath with a runtime, source entry and legacy type resolution', () => {
  const root = new URL('../../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const entries = {
    './media-providers': 'node',
    './media-providers/catalog': 'universal',
    './credentialed-http': 'node',
    './webhooks': 'node',
  };
  for (const [subpath, runtime] of Object.entries(entries)) {
    const entry = manifest.exports[subpath];
    expect(manifest.jini.entries[subpath]).toBe(runtime);
    expect(entry.default).toBe(entry.import);
    expect(entry.types).toBe(entry.import.replace(/\.js$/, '.d.ts'));
    expect(manifest.typesVersions['*'][subpath.slice(2)]).toEqual([entry.types]);
    const source = entry.import.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    expect(existsSync(fileURLToPath(new URL(source, root))), source).toBe(true);
  }
  expect(manifest.exports['.']).toBeUndefined();
  expect(manifest.exports['./http-ports']).toBeUndefined();
});
