import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, test, vi } from 'vitest';
import { createNodePackagingFilesystem } from '../node.js';
import type { PackagingFilesystemPort } from '../ports.js';
import { hasNativeBinaryMagic, stageBundledNpm } from '../staging.js';

// Keep the real descriptor reads; make an accidental whole-file read fail before allocating.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    readSync: vi.fn(actual.readSync),
    closeSync: vi.fn(actual.closeSync),
    readFileSync: vi.fn(() => { throw new Error('whole-file reads are forbidden during native inspection'); }),
  };
});
beforeEach(() => { vi.clearAllMocks(); });

function fixture(work: (root: string) => void): void {
  // Staging inspects canonical paths; temporary roots can have symlinked ancestors.
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'native-prefix-')));
  try { work(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('Node prefix port reads only four bytes from a large sparse file and closes its descriptor', () => fixture(root => {
  const file = path.join(root, 'large');
  writeFileSync(file, Buffer.from('7f454c46', 'hex'));
  truncateSync(file, 64 * 1024 * 1024);
  const fs = createNodePackagingFilesystem({});
  assert.ok(fs.readPrefix);
  assert.deepEqual(fs.readPrefix({ path: file, maxBytes: 4 }), Buffer.from('7f454c46', 'hex'));
  assert.equal(vi.mocked(readFileSync).mock.calls.length, 0);
  const calls = vi.mocked(readSync).mock.calls;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.slice(2), [0, 4, 0]);
  assert.equal((calls[0]![1] as Uint8Array).byteLength, 4);
  assert.deepEqual(vi.mocked(closeSync).mock.calls, [[vi.mocked(openSync).mock.results[0]!.value]]);
}));

test('bounded reads retain short-file semantics and every native magic signature', () => fixture(root => {
  const fs = createNodePackagingFilesystem({});
  assert.ok(fs.readPrefix);
  const cases: [string, boolean][] = [
    ['', false], ['4d', false], ['4d5a', true], ['4d5a00', true],
    ['feedface', true], ['feedfacf', true], ['cafebabe', true], ['cefaedfe', true], ['cffaedfe', true], ['7f454c46', true],
    ['000000004d5a', false],
  ];
  for (const [hex, native] of cases) {
    const file = path.join(root, 'sample');
    writeFileSync(file, Buffer.from(hex, 'hex'));
    const bytes = fs.readPrefix({ path: file, maxBytes: 4 });
    assert.deepEqual(bytes, Buffer.from(hex.slice(0, 8), 'hex'));
    assert.equal(hasNativeBinaryMagic({ bytes }), native, hex);
  }
  assert.equal(vi.mocked(readFileSync).mock.calls.length, 0);
}));

test('prefix adapter closes its descriptor even when the read fails', () => fixture(root => {
  const file = path.join(root, 'sample');
  writeFileSync(file, 'text');
  const fs = createNodePackagingFilesystem({});
  assert.ok(fs.readPrefix);
  vi.mocked(readSync).mockImplementationOnce(() => { throw new Error('read unavailable'); });
  assert.throws(() => fs.readPrefix!({ path: file, maxBytes: 4 }), /read unavailable/);
  assert.deepEqual(vi.mocked(closeSync).mock.calls, [[vi.mocked(openSync).mock.results[0]!.value]]);
}));

test('npm inspection uses only bounded prefix reads and refuses native bytes before copying', () => fixture(root => {
  const source = path.join(root, 'npm');
  mkdirSync(source);
  const file = path.join(source, 'marker.js');
  writeFileSync(file, Buffer.from('4d5a', 'hex'));
  truncateSync(file, 64 * 1024 * 1024);
  const fs = createNodePackagingFilesystem({});
  assert.ok(fs.readPrefix);
  const requests: { path: string; maxBytes: number }[] = [];
  const readPrefix = fs.readPrefix;
  const bounded: PackagingFilesystemPort = {
    ...fs,
    read: () => { throw new Error('whole-file port must not be used'); },
    readPrefix: request => { requests.push(request); return readPrefix(request); },
    copy: vi.fn(), remove: vi.fn(),
  };
  assert.throws(() => stageBundledNpm({ npmSource: source, outDir: path.join(root, 'out'), marker: 'marker.js', droppedDirectoryNames: new Set(), droppedFileSuffixes: [], fs: bounded }), /native-binary/);
  assert.deepEqual(requests, [{ path: file, maxBytes: 4 }]);
  assert.equal(vi.mocked(readFileSync).mock.calls.length, 0);
  assert.equal(vi.mocked(bounded.copy).mock.calls.length, 0);
  assert.equal(vi.mocked(bounded.remove).mock.calls.length, 0);
}));

test('npm staging fails closed without a prefix port instead of falling back to whole-file reads', () => fixture(root => {
  const source = path.join(root, 'npm');
  mkdirSync(source);
  writeFileSync(path.join(source, 'marker.js'), 'text');
  const { readPrefix: _readPrefix, ...legacy } = createNodePackagingFilesystem({});
  const fs: PackagingFilesystemPort = { ...legacy, read: vi.fn(), copy: vi.fn(), remove: vi.fn() };
  assert.throws(() => stageBundledNpm({ npmSource: source, outDir: path.join(root, 'out'), marker: 'marker.js', droppedDirectoryNames: new Set(), droppedFileSuffixes: [], fs }), /bounded prefix-read port/);
  assert.equal(vi.mocked(fs.read).mock.calls.length, 0);
  assert.equal(vi.mocked(fs.copy).mock.calls.length, 0);
  assert.equal(vi.mocked(fs.remove).mock.calls.length, 0);
}));
