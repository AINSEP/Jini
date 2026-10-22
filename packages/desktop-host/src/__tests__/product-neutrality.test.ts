import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?tsx?$/.test(file) && !file.endsWith('.test.ts') ? [file] : [];
  });
}

test('new public subpaths have JavaScript and declaration targets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [subpath, entry] of Object.entries({ './shutdown': 'shutdown/index', './electron/navigation-policy': 'electron/navigation-policy/index', './electron/updates': 'electron/updates/index', './node-toolchain': 'node-toolchain/index' })) {
    assert.deepEqual(manifest.exports[subpath], { types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js`, default: `./dist/${entry}.js` });
  }
});
