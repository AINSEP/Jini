import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createNodePackagingFilesystem, createNodePackageResolver } from '../node.js';
import { filesUnderPrefixes, verifyAsarAgainstSource, bundledNpmFailures, toArchiveEntryPath } from '../archive.js';
import { stageTransitiveDependencies, assertClosureComplete, stagePackedWorkspace, newestMtime, stripNonRuntimeFiles, pruneNativePrebuilds, stageBundledNpm, hasNativeBinaryMagic } from '../staging.js';
import { undeclaredDistImports, assertDistImportsDeclared } from '../imports.js';
import { observeMovingPaths } from '../stability.js';
import { createAsarArchiveReader } from '../asar-adapter.js';
import type { ArchiveReaderPort, ImportReaderPort } from '../ports.js';

function fixture(work: (root: string) => void): void {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-')));
  try { work(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function write(file: string, body: string): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }
function pkg(directory: string, name: string, dependencies: Record<string, string> = {}): void { write(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies })); }
const filesystem = createNodePackagingFilesystem({});
const resolver = createNodePackageResolver({ fs: filesystem });

test('archive walk supports file/directory prefixes, excludes links and rejects traversal', () => {
  const headerFiles = { src: { files: { 'a.js': { size: 3 }, nested: { files: { 'b.js': { size: 3 } } }, link: { link: 'a.js' } } }, 'main.js': { size: 3 }, ignored: { size: 3 } };
  assert.deepEqual(filesUnderPrefixes({ headerFiles, prefixes: ['src', 'main.js', 'absent'] }), ['src/a.js', 'src/nested/b.js', 'main.js']);
  assert.throws(() => filesUnderPrefixes({ headerFiles, prefixes: ['../escape'] }), /Unsafe/);
  assert.equal(toArchiveEntryPath({ relPath: 'src/a.js', separator: String.fromCharCode(92) }), String.raw`src\a.js`);
});
test('same-length corruption is caught; missing source/checked prefix and unreadable archive entries fail', () => fixture(root => {
  write(path.join(root, 'src/a.js'), 'AAA'); write(path.join(root, 'src/b.js'), 'BBB');
  const archive: ArchiveReaderPort = {
    header: () => ({ files: { src: { files: { 'a.js': { size: 3 }, 'b.js': { size: 3 }, 'gone.js': { size: 3 } } } } }),
    read: ({ entryPath }) => Buffer.from(entryPath === 'src/a.js' ? 'ZZZ' : 'BBB'),
  };
  const result = verifyAsarAgainstSource({ archivePath: 'fixture.asar', sourceRoot: root, prefixes: ['src', 'dist'], separator: '/', fs: filesystem, archive });
  assert.equal(result.checkedCount, 3);
  assert.deepEqual(result.mismatches.map(x => x.relPath), ['dist', 'src/a.js', 'src/gone.js']);
  assert.match(result.mismatches[1]!.reason, /content differs/);
  archive.read = () => { throw new Error('offset invalid'); };
  assert.match(verifyAsarAgainstSource({ archivePath: 'fixture.asar', sourceRoot: root, prefixes: ['src'], separator: '/', fs: filesystem, archive }).mismatches[0]!.reason, /offset invalid/);
}));
test('clean archive and required npm files pass; empty verification/resources do not', () => fixture(root => {
  write(path.join(root, 'main.js'), 'code');
  const archive: ArchiveReaderPort = { header: () => ({ files: { 'main.js': { size: 4 } } }), read: () => Buffer.from('code') };
  assert.deepEqual(verifyAsarAgainstSource({ archivePath: 'fixture', sourceRoot: root, prefixes: ['main.js'], separator: '/', fs: filesystem, archive }), { checkedCount: 1, mismatches: [] });
  assert.equal(verifyAsarAgainstSource({ archivePath: 'fixture', sourceRoot: root, prefixes: [], separator: '/', fs: filesystem, archive }).mismatches.length, 1);
  assert.equal(bundledNpmFailures({ resourcesDirs: [], requiredFiles: ['npm/bin/npx-cli.js'], fs: filesystem }).length, 1);
  write(path.join(root, 'npm/bin/npx-cli.js'), 'code');
  assert.deepEqual(bundledNpmFailures({ resourcesDirs: [root], requiredFiles: ['npm/bin/npx-cli.js'], fs: filesystem }), []);
}));
test('staging follows a cyclic dependency closure, drops nested modules and catches missing shipped dependencies', () => fixture(root => {
  const a = path.join(root, 'a'); const b = path.join(a, 'node_modules/b'); const c = path.join(a, 'node_modules/c'); const outDir = path.join(root, 'out');
  pkg(a, 'a', { b: '*' }); pkg(b, 'b', { c: '*' }); pkg(c, 'c', { b: '*' });
  write(path.join(b, 'marker'), 'actual-b');
  const required = { roots: [a], outDir, excluded: new Set<string>(), fs: filesystem, resolver };
  assert.equal(stageTransitiveDependencies(required), 2);
  assert.equal(fs.readFileSync(path.join(outDir, 'node_modules/b/marker'), 'utf8'), 'actual-b');
  assert.equal(fs.existsSync(path.join(outDir, 'node_modules/b/node_modules')), false);
  assert.doesNotThrow(() => assertClosureComplete({ outDir, excluded: required.excluded, fs: filesystem }));
  fs.rmSync(path.join(outDir, 'node_modules/c'), { recursive: true });
  assert.throws(() => assertClosureComplete({ outDir, excluded: required.excluded, fs: filesystem }), /b -> c/);
}));
test('unresolved dependencies and conflicting package versions fail before any staged copy', () => fixture(root => {
  const a = path.join(root, 'a'); const outDir = path.join(root, 'out'); pkg(a, 'a', { missing: '*' });
  assert.throws(() => stageTransitiveDependencies({ roots: [a], outDir, excluded: new Set(), fs: filesystem, resolver }), /missing/);
  assert.equal(fs.existsSync(outDir), false);
  const b = path.join(root, 'b'); pkg(a, 'a', { shared: '*' }); pkg(b, 'b', { shared: '*' });
  pkg(path.join(a, 'node_modules/shared'), 'shared'); pkg(path.join(b, 'node_modules/shared'), 'shared');
  write(path.join(b, 'node_modules/shared/package.json'), JSON.stringify({ name: 'shared', version: '2.0.0' }));
  assert.throws(() => stageTransitiveDependencies({ roots: [a, b], outDir, excluded: new Set(), fs: filesystem, resolver }), /conflict/);
  assert.equal(fs.existsSync(outDir), false);
}));
test('mtime walk ignores tests, hidden files and dependencies, using stored timestamps', () => fixture(root => {
  write(path.join(root, 'source.ts'), 'source'); fs.utimesSync(path.join(root, 'source.ts'), 1, 1);
  for (const relative of ['__tests__/a.ts', '__measurements__/a.ts', 'node_modules/pkg/a.js', '.cache/a.js']) write(path.join(root, relative), 'newer');
  assert.equal(newestMtime({ absolutePath: root, fs: filesystem }), fs.statSync(path.join(root, 'source.ts')).mtimeMs);
  assert.equal(newestMtime({ absolutePath: path.join(root, 'missing'), fs: filesystem }), 0);
}));
test('stripping and native pruning touch only staged files and preserve selected maps/universal builds', () => fixture(root => {
  const outDir = path.join(root, 'out'); const packageDir = path.join(outDir, 'node_modules/@vendor/native'); pkg(packageDir, '@vendor/native');
  for (const relative of ['dist/a.d.ts', 'dist/a.js.map', 'coverage/index.html', 'prebuilds/darwin-x64+arm64.node', 'prebuilds/linux-x64.node', 'deps/sqlite.c', 'binding.gyp']) write(path.join(packageDir, relative), 'x');
  const tally = stripNonRuntimeFiles({ outDir, keepScopes: new Set(['@vendor']), fs: filesystem });
  assert.equal(tally.declaration, 1); assert.equal(tally.coverage, 1); assert.equal(tally.sourceMap, 0);
  const native = pruneNativePrebuilds({ outDir, targets: [{ platform: 'darwin', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' }], fs: filesystem });
  assert.equal(native.prebuilds, 1); assert.equal(native.buildInputs, 2); assert.equal(fs.existsSync(path.join(packageDir, 'prebuilds/darwin-x64+arm64.node')), true);
}));
test('workspace packing delegates unchanged paths/root set to the existing pack mechanism port', () => {
  const input = { repoRoot: '/repo', packagesDir: '/repo/packages', rootNames: ['@vendor/core'], destDir: '/packed' };
  const packed = { closure: ['@vendor/core'], tarballPathByName: new Map([['@vendor/core', '/packed/core.tgz']]) };
  assert.equal(stagePackedWorkspace({ ...input, packer: { pack(required) { assert.deepEqual(required, input); return packed; } } }), packed);
});
test('reachable import walk reports bare/missing imports and follows host aliases without parsing comments itself', () => fixture(root => {
  const entry = path.join(root, 'main.js'); write(entry, 'entry'); write(path.join(root, 'sub.js'), 'sub'); write(path.join(root, 'unreachable.js'), 'unused');
  const imports: ImportReaderPort = { imports: ({ source }) => source === 'entry' ? ['node:fs', 'path', '@vendor/core/sub', '#alias', './gone.js'] : source === 'sub' ? ['dev-only', './main.js'] : ['unused-dev'] };
  const required = { distDir: root, entry, declared: new Set(['@vendor/core']), fs: filesystem, imports, aliases: { resolve: ({ specifier }: { specifier: string }) => specifier === '#alias' ? path.join(root, 'sub.js') : undefined } };
  assert.deepEqual(undeclaredDistImports(required), ['./gone.js (main.js: file not found)', 'dev-only (sub.js)']);
  assert.throws(() => assertDistImportsDeclared(required), /dev-only/);
}));
test('moving paths compare snapshots across an injected observation interval', async () => {
  let calls = 0; let slept = 0;
  const moving = await observeMovingPaths({ roots: ['/surface'], intervalMs: 100, snapshots: { snapshot: () => ++calls === 1 ? new Map([['a', 'old'], ['removed', 'old']]) : new Map([['a', 'new'], ['added', 'new']]) }, clock: { sleep: async ({ milliseconds }) => { slept = milliseconds; } } });
  assert.deepEqual(moving, ['a', 'added', 'removed']); assert.equal(slept, 100);
});
test('npm staging drops caller-selected docs/wrappers, keeps cmd files and rejects native bytes without changing output', () => fixture(root => {
  const npmSource = path.join(root, 'npm'); const outDir = path.join(root, 'out');
  for (const relative of ['bin/npx-cli.js', 'bin/npm.cmd', 'bin/npm.ps1', 'docs/help.md', 'node_modules/pkg/man/help.md', 'node_modules/pkg/index.js']) write(path.join(npmSource, relative), 'javascript');
  const input = { npmSource, outDir, marker: 'bin/npx-cli.js', droppedDirectoryNames: new Set(['docs', 'man']), droppedFileSuffixes: ['.ps1'], fs: filesystem };
  assert.equal(stageBundledNpm(input).fileCount, 3);
  assert.equal(fs.existsSync(path.join(outDir, 'bin/npm.cmd')), true); assert.equal(fs.existsSync(path.join(outDir, 'bin/npm.ps1')), false);
  fs.writeFileSync(path.join(npmSource, 'native'), Buffer.from('7f454c46', 'hex'));
  assert.throws(() => stageBundledNpm(input), /native-binary/);
  assert.equal(fs.existsSync(path.join(outDir, 'bin/npx-cli.js')), true);
  assert.equal(hasNativeBinaryMagic({ bytes: Buffer.from('4d5a', 'hex') }), true);
  assert.equal(hasNativeBinaryMagic({ bytes: Buffer.from('x') }), false);
}));
test('universal native target missing one architecture fails before pruning any package', () => fixture(root => {
  const outDir = path.join(root, 'out'); const directory = path.join(outDir, 'node_modules/native'); pkg(directory, 'native');
  write(path.join(directory, 'prebuilds/darwin-x64.node'), 'binary'); write(path.join(directory, 'prebuilds/linux-x64.node'), 'foreign');
  assert.throws(() => pruneNativePrebuilds({ outDir, targets: [{ platform: 'darwin', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' }], fs: filesystem }), /every requested target/);
  assert.equal(fs.existsSync(path.join(directory, 'prebuilds/linux-x64.node')), true);
}));
test('archive adapter forwards the exact archive and host separator paths to the maintained SDK', () => {
  const files = { 'main.js': { size: 4 } }; const bytes = Buffer.from('code');
  const archive = createAsarArchiveReader({ asar: {
    getRawHeader(archivePath) { assert.equal(archivePath, '/archive.asar'); return { header: { files } }; },
    extractFile(archivePath, entryPath) { assert.equal(archivePath, '/archive.asar'); assert.equal(entryPath, String.raw`src\main.js`); return bytes; },
  } });
  assert.deepEqual(archive.header({ archivePath: '/archive.asar' }), { files });
  assert.equal(archive.read({ archivePath: '/archive.asar', entryPath: String.raw`src\main.js` }), bytes);
});
