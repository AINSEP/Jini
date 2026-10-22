import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// This pins the merge needs as executable release acceptance; the dirty manifest is host-owned.
it('publishes the provider-free builder and its isolated SQLite adapter', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports['./tool-catalog-builder']).toEqual({
    types: './dist/tool-catalog-builder/index.d.ts',
    import: './dist/tool-catalog-builder/index.js',
    default: './dist/tool-catalog-builder/index.js',
  });
  expect(manifest.exports['./tool-catalog-builder/sqlite']).toEqual({
    types: './dist/tool-catalog-builder/sqlite.d.ts',
    import: './dist/tool-catalog-builder/sqlite.js',
    default: './dist/tool-catalog-builder/sqlite.js',
  });
  expect(manifest.jini.entries['./tool-catalog-builder']).toBe('universal');
  expect(manifest.jini.entries['./tool-catalog-builder/sqlite']).toBe('node');
});
