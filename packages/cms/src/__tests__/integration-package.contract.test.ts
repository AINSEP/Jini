import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const packageRoot = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  exports: Record<string, { types: string; import: string; default: string }>;
  jini: { entries: Record<string, string> };
  dependencies: Record<string, string>;
};

it('keeps exports and entry runtime metadata synchronized', () => {
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  expect(manifest.jini.entries['./core/tools']).toBe('universal');
  expect(manifest.jini.entries['./media/import']).toBe('universal');
  // REGRESSION: fails if the removed server entry is restored in either manifest map.
  expect(Object.hasOwn(manifest.exports, './server')).toBe(false);
  expect(Object.hasOwn(manifest.jini.entries, './server')).toBe(false);
  expect(manifest.jini.entries['./media']).toBe('node');
  expect(Object.keys(manifest.dependencies)).toEqual(["@jini-ai/core"]);
});

it('gives every public export a source target for a subsequent clean build', () => {
  // PARITY: each advertised entry must still resolve to an actual source module after moves.
  const missing: string[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const source = target.import.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    if (!existsSync(new URL(source, packageRoot))) missing.push(subpath);
    expect(target.default).toBe(target.import);
    expect(target.types).toBe(target.import.replace(/\.js$/, '.d.ts'));
  }
  expect(missing).toEqual([]);
});
