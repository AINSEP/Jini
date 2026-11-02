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
it.each(['string_decoder', 'events', 'buffer', 'punycode'])('copies an installed npm package that shares builtin name %s', dependency => {
  const source = mkdtempSync(join(tmpdir(), 'packed-fixture-src-')); dirs.push(source);
  writePackage(source, { name: 'builtin-named-consumer', dependencies: { [dependency]: '*' } });
  writePackage(join(source, 'node_modules', dependency), { name: dependency });
  const dir = fixture('packed-fixture-dest-'); dirs.push(dir);
  copyRuntimeTree(dir, 'builtin-named-consumer', source);
  expect(existsSync(join(dir, 'node_modules', dependency, 'package.json'))).toBe(true);
});

// A declared dependency is an npm package, even when its name also denotes a Node builtin.
it.each(['node:fs', 'events', 'unresolvable-fixture-dependency'])('fails explicitly when declared dependency %s is not installed', dependency => {
  const source = mkdtempSync(join(tmpdir(), 'packed-fixture-src-')); dirs.push(source);
  writePackage(source, { name: 'builtin-consumer', dependencies: { [dependency]: '*' } });
  const dir = fixture('packed-fixture-dest-'); dirs.push(dir);
  expect(() => copyRuntimeTree(dir, 'builtin-consumer', source)).toThrow(`Cannot locate declared dependency ${dependency}`);
});
