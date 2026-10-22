import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = dirname(root.slice(0, -1));
test('the additive subpaths have both runtime and declaration exports without replacing the existing root export', () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' });
  for (const subpath of ['providers/tool-turn', 'model-catalog/cache', 'providers/sse-decode']) {
    expect(manifest.exports[`./${subpath}`]).toEqual({ types: `./dist/${subpath === 'model-catalog/cache' ? 'model-catalog-cache' : subpath}.d.ts`, import: `./dist/${subpath === 'model-catalog/cache' ? 'model-catalog-cache' : subpath}.js`, default: `./dist/${subpath === 'model-catalog/cache' ? 'model-catalog-cache' : subpath}.js` });
  }
});
