import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createNodePackagingFilesystem, createNodePackageResolver } from '../node.js';
import type { PackagingFilesystemPort } from '../ports.js';

function fixture(work: (root: string) => void): void {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-node-')));
  try { work(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function write(file: string, body: string): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }

test('prefix reads refuse a negative, fractional or unsafe byte bound before opening the file', () => {
  const filesystem = createNodePackagingFilesystem({});
  // The path does not exist: reaching openSync would throw ENOENT instead of the bound error.
  for (const maxBytes of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => filesystem.readPrefix!({ path: '/definitely/not/here', maxBytes }), { message: 'maxBytes must be a nonnegative safe integer' });
  }
});

test('a zero-byte prefix bound reads nothing from an existing file', () => fixture(root => {
  write(path.join(root, 'a.bin'), 'payload');
  assert.equal(createNodePackagingFilesystem({}).readPrefix!({ path: path.join(root, 'a.bin'), maxBytes: 0 }).length, 0);
}));

test('copy refuses a destination equal to, inside, or containing the source and leaves both trees untouched', () => fixture(root => {
  const filesystem = createNodePackagingFilesystem({});
  const source = path.join(root, 'pkg');
  write(path.join(source, 'index.js'), 'module');
  for (const to of [source, path.join(source, 'nested', 'copy'), root]) {
    assert.throws(() => filesystem.copy({ from: source, to }), { message: 'staging source and destination must be disjoint' });
  }
  assert.deepEqual(fs.readdirSync(source), ['index.js']);
}));

test('copy into a sibling whose name merely shares the source prefix is allowed', () => fixture(root => {
  const filesystem = createNodePackagingFilesystem({});
  write(path.join(root, 'pkg', 'index.js'), 'module');
  filesystem.copy({ from: path.join(root, 'pkg'), to: path.join(root, 'pkg-copy') });
  assert.equal(fs.readFileSync(path.join(root, 'pkg-copy', 'index.js'), 'utf8'), 'module');
}));

test('stat reports symlinks as other without following them', () => fixture(root => {
  write(path.join(root, 'target.js'), 'x');
  fs.symlinkSync(path.join(root, 'target.js'), path.join(root, 'link.js'));
  const filesystem = createNodePackagingFilesystem({});
  assert.equal(filesystem.stat({ path: path.join(root, 'link.js') }).kind, 'other');
  assert.equal(filesystem.stat({ path: path.join(root, 'target.js') }).kind, 'file');
  assert.equal(filesystem.stat({ path: root }).kind, 'directory');
}));

test('package resolution rejects names that could escape node_modules without probing the filesystem', () => {
  const probes: string[] = [];
  const probingFs: PackagingFilesystemPort = {
    ...createNodePackagingFilesystem({}),
    exists: ({ path: probe }) => { probes.push(probe); return false; },
  };
  const resolver = createNodePackageResolver({ fs: probingFs });
  for (const packageName of ['../up', '@scope/../x', '', '.hidden', '@scope/', 'a/b']) {
    assert.throws(() => resolver.resolve({ fromDirectory: '/work', packageName }), { message: 'Invalid package name' });
  }
  assert.deepEqual(probes, []);
});

test('package resolution walks upward to the first node_modules that has the package and stops at the root', () => fixture(root => {
  const filesystem = createNodePackagingFilesystem({});
  write(path.join(root, 'node_modules', '@scope', 'lib', 'package.json'), '{}');
  const deep = path.join(root, 'apps', 'web', 'src');
  fs.mkdirSync(deep, { recursive: true });
  const resolver = createNodePackageResolver({ fs: filesystem });
  assert.equal(resolver.resolve({ fromDirectory: deep, packageName: '@scope/lib' }), path.join(root, 'node_modules', '@scope', 'lib'));
  assert.equal(resolver.resolve({ fromDirectory: deep, packageName: 'not-installed-anywhere-xyz' }), undefined);
}));
