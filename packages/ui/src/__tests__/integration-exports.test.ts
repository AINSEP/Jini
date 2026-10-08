// @vitest-environment node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

it('declares the runtime and source for every public entry without changing existing subpaths', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  expect(Object.keys(manifest.jini.entries).sort()).toEqual(Object.keys(manifest.exports).sort());
  for (const [key, target] of Object.entries(manifest.exports)) {
    expect(manifest.jini.entries[key], key).toBe(['./core', './mcp-ui/surfaces', './mcp-ui/secret-card', './interactive-ui/manifests'].includes(key) ? 'universal' : 'browser');
    if (typeof target === 'string') continue;
    const entry = target as { import: string; types: string; default: string };
    expect(entry.types).toBe(entry.import.replace(/\.js$/, '.d.ts'));
    expect(entry.default).toBe(entry.import);
    const source = entry.import.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    expect(existsSync(join(root, source)) || existsSync(join(root, source + 'x')), key).toBe(true);
  }
});
