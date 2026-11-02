import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAssets, chunkUploads, assetHash } from '../assets.mjs';
import { fixture } from './fixture.mjs';
const { kit } = fixture({ respond: () => { throw new Error('No network allowed'); } });

test('asset boundaries include generated config, exact byte limit, paid plan and Windows paths', () => {
  const max = Buffer.alloc(25 * 1024 * 1024);
  assert.equal(prepareAssets({ files: [{ file: 'nested\\file.bin', data: max }], kit }).manifest['/nested/file.bin'].size, max.length);
  assert.throws(() => prepareAssets({ files: [{ file: 'big', data: Buffer.alloc(max.length + 1) }], kit }), /CLOUDFLARE_ASSET_SIZE_LIMIT.*big/);
  assert.throws(() => prepareAssets({ files: [{ file: 'index.html', data: '' }], responseHeaders: { Test: 'value' }, kit }, { maxFiles: 1 }), /CLOUDFLARE_ASSET_COUNT_LIMIT/);
  for (const file of ['', '../bad', '/bad']) assert.throws(() => prepareAssets({ files: [{ file, data: '' }], kit }), /CLOUDFLARE_ASSET_PATH/);
  assert.throws(() => prepareAssets({ files: [{ file: 'a', data: '' }, { file: 'a', data: '' }], kit }), /Duplicate export path/);
  const prepared = prepareAssets({ files: [{ file: 'docs/_headers', data: 'ordinary' }, { file: '_headers', data: 'root' }], kit });
  assert.equal(prepared.config._headers, 'root');
  assert.ok(prepared.manifest['/docs/_headers']);
  assert.notEqual(assetHash({ file: 'a.txt', data: 'x' }), assetHash({ file: 'a.html', data: 'x' }));
});

test('Pages upload chunks respect aggregate byte and file limits; empty means no uploads', () => {
  const files = Array.from({ length: 3 }, (_, i) => ({ hash: String(i), data: Buffer.from('x'), contentType: 'text/plain' }));
  assert.deepEqual(chunkUploads({ files: [] }), []);
  assert.deepEqual(chunkUploads({ files }, { maxFiles: 2 }).map(chunk => chunk.length), [2, 1]);
  assert.deepEqual(chunkUploads({ files }, { maxBytes: 160 }).map(chunk => chunk.length), [1, 1, 1]);
  assert.throws(() => chunkUploads({ files }, { maxBytes: 5 }), /CLOUDFLARE_UPLOAD_LIMIT/);
});

test('free and paid file-count boundaries include all generated files', () => {
  const free = Array.from({ length: 20_000 }, (_, index) => ({ file: `${index}.txt`, data: '' }));
  assert.equal(Object.keys(prepareAssets({ files: free, kit }).manifest).length, 20_000);
  assert.throws(() => prepareAssets({ files: free, kit, responseHeaders: { Test: 'generated' } }), /CLOUDFLARE_ASSET_COUNT_LIMIT/);
  const paid = Array.from({ length: 100_000 }, (_, index) => ({ file: `${index}.txt`, data: '' }));
  assert.equal(Object.keys(prepareAssets({ files: paid, kit }, { maxFiles: 100_000 }).manifest).length, 100_000);
  assert.throws(() => prepareAssets({ files: [...paid, { file: 'proof.txt', data: 'generated' }], kit }, { maxFiles: 100_000 }), /CLOUDFLARE_ASSET_COUNT_LIMIT/);
});
