import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { copyRuntimeTree, fixture } from '../testing/packed-fixture.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function writePackage(dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

// Bug class: an npm package that shares a Node builtin's name (string_decoder, punycode, buffer, events…).
// mammoth → jszip → readable-stream depends on the npm string_decoder, which it loads as 'string_decoder/'.
it('copies an installed npm package that shares a builtin name', () => {
  const source = mkdtempSync(join(tmpdir(), 'packed-fixture-src-')); dirs.push(source);
  writePackage(source, { name: 'builtin-named-consumer', dependencies: { string_decoder: '*' } });
  writePackage(join(source, 'node_modules', 'string_decoder'), { name: 'string_decoder' });
  const dir = fixture('packed-fixture-dest-'); dirs.push(dir);
  copyRuntimeTree(dir, 'builtin-named-consumer', source);
  expect(existsSync(join(dir, 'node_modules', 'string_decoder', 'package.json'))).toBe(true);
});

// A dependency on a builtin that is not installed is a runtime capability, not a directory to copy.
it('skips a builtin dependency that has no installed npm package', () => {
  const source = mkdtempSync(join(tmpdir(), 'packed-fixture-src-')); dirs.push(source);
  writePackage(source, { name: 'builtin-consumer', dependencies: { 'node:fs': '*', events: '*' } });
  const dir = fixture('packed-fixture-dest-'); dirs.push(dir);
  copyRuntimeTree(dir, 'builtin-consumer', source);
  expect(existsSync(join(dir, 'node_modules', 'node:fs'))).toBe(false);
  expect(existsSync(join(dir, 'node_modules', 'events'))).toBe(false);
});
