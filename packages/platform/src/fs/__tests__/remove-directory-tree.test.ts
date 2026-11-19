import { afterEach, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeDirectoryTreeWritable, removeDirectoryTree, type WritableTreePort } from '../index.js';

function filesFake() {
  const writes: [string, number][] = [];
  const files: WritableTreePort = {
    lstatSync: (entry) => ({ mode: entry.endsWith('package') ? 0o555 : 0o444,
      isDirectory: () => entry.endsWith('package'), isSymbolicLink: () => entry.endsWith('link') }),
    chmodSync: (entry, mode) => { writes.push([entry, mode]); },
    readdirSync: () => ['mcp.json', 'link'],
  };
  return { files, writes };
}
test('D-01: owner-write is added recursively before removing the immutable store, without following links', async () => {
  const { files, writes } = filesFake();
  await removeDirectoryTree({ root: '/site/package' }, { files, remove: async (root) => {
    assert.equal(root, '/site/package');
    assert.deepEqual(writes, [['/site/package', 0o755], ['/site/package/mcp.json', 0o644]]);
  } });
});
test('D-01: an absent tree is harmless, but permission failures propagate and prevent removal', async () => {
  const { files } = filesFake();
  files.lstatSync = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  makeDirectoryTreeWritable({ root: '/gone' }, { files });
  files.lstatSync = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  await assert.rejects(removeDirectoryTree({ root: '/site' }, { files, remove: async () => assert.fail('must not remove') }), { message: 'denied' });
});


const removalRoots: string[] = [];
afterEach(() => { for (const root of removalRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

test('a real symlink leaves the external target permissions and content untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-directory-tree-'));
  removalRoots.push(root);
  const tree = path.join(root, 'tree'), outside = path.join(root, 'outside');
  fs.mkdirSync(tree);
  fs.mkdirSync(outside);
  const content = path.join(outside, 'keep.txt');
  fs.writeFileSync(content, 'keep');
  fs.chmodSync(content, 0o444);
  const mode = fs.statSync(content).mode;
  fs.symlinkSync(outside, path.join(tree, 'link'), 'junction');
  await removeDirectoryTree({ root: tree });
  assert.equal(fs.existsSync(tree), false);
  assert.equal(fs.readFileSync(content, 'utf8'), 'keep');
  assert.equal(fs.statSync(content).mode, mode);
});
