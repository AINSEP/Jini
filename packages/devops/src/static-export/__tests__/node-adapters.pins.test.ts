import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import { ExportPathError } from '../contracts.js';
import { createNodeArtifactWriter, createNodeAssetSource } from '../node-adapters.js';

let root = '';
beforeEach(async () => { root = await realpath(await mkdtemp(path.join(tmpdir(), 'static-export-pins-'))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/** Asserts the rejection is an ExportPathError carrying exactly `message`. */
async function refuses(promise: Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof ExportPathError && error.message === message);
}

test('prepare refuses a relative output directory', async () => {
  await refuses(createNodeArtifactWriter({}).prepare({ outputDir: 'relative/out' }), 'Output path must be absolute.');
});

test('write refuses a relative output directory after validating the artifact path', async () => {
  await refuses(createNodeArtifactWriter({}).write({ outputDir: 'relative/out', outputFile: 'a.txt', data: 'x' }), 'Output path must be absolute.');
});

test('write refuses an escaping artifact path before touching the filesystem', async () => {
  const outputDir = path.join(root, 'never-created');
  await refuses(createNodeArtifactWriter({}).write({ outputDir, outputFile: 'a/../../b', data: 'x' }), 'Output path resolved outside the output directory — refused');
  await assert.rejects(lstat(outputDir), { code: 'ENOENT' });
});

test('prepare creates every missing ancestor as a directory', async () => {
  const outputDir = path.join(root, 'a', 'b', 'c');
  await createNodeArtifactWriter({}).prepare({ outputDir });
  assert.equal((await stat(outputDir)).isDirectory(), true);
});

test('prepare refuses an output ancestor that is a regular file', async () => {
  await writeFile(path.join(root, 'file'), 'x');
  await refuses(createNodeArtifactWriter({}).prepare({ outputDir: path.join(root, 'file', 'out') }), 'Output path must be a regular directory.');
});

test('prepare propagates mkdir errors other than EEXIST', async () => {
  await assert.rejects(createNodeArtifactWriter({}).prepare({ outputDir: path.join(root, 'x'.repeat(300)) }), { code: 'ENAMETOOLONG' });
});

test('write refuses an artifact subdirectory that is a regular file', async () => {
  await writeFile(path.join(root, 'sub'), 'x');
  await refuses(createNodeArtifactWriter({}).write({ outputDir: root, outputFile: 'sub/a.txt', data: 'y' }), 'Artifact path must be a regular directory.');
});

test('write refuses an existing artifact that is a directory', async () => {
  await mkdir(path.join(root, 'dir'));
  await refuses(createNodeArtifactWriter({}).write({ outputDir: root, outputFile: 'dir', data: 'y' }), 'Artifact output must be a regular file.');
});

test('write propagates lstat errors other than ENOENT for the artifact', async () => {
  await assert.rejects(createNodeArtifactWriter({}).write({ outputDir: root, outputFile: 'y'.repeat(300), data: 'x' }), { code: 'ENAMETOOLONG' });
});

test('write truncates a longer existing artifact before writing', async () => {
  await writeFile(path.join(root, 'a.txt'), 'much longer old content');
  await createNodeArtifactWriter({}).write({ outputDir: root, outputFile: 'a.txt', data: 'new' });
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'new');
});

test('write creates new artifacts owner-read-write only', async () => {
  await createNodeArtifactWriter({}).write({ outputDir: root, outputFile: 'a.txt', data: 'x' });
  assert.equal((await stat(path.join(root, 'a.txt'))).mode & 0o777, 0o600);
});

test('clean removes nested directories and symlinks without following them', async () => {
  const outputDir = path.join(root, 'out');
  const outside = path.join(root, 'outside');
  await mkdir(path.join(outputDir, 'nested', 'deeper'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'keep');
  await writeFile(path.join(outputDir, 'nested', 'deeper', 'f'), 'x');
  await symlink(outside, path.join(outputDir, 'link'));
  await createNodeArtifactWriter({}).prepare({ outputDir }, { clean: true });
  assert.deepEqual(await readdir(outputDir), []);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('theme inventory refuses a relative theme directory', async () => {
  await refuses(createNodeAssetSource({}).listThemeFiles({ theme: { id: 't', dir: 'theme' } }), 'Theme path must be absolute.');
});

test('theme inventory refuses a symlinked theme directory', async () => {
  await mkdir(path.join(root, 'real'));
  await symlink(path.join(root, 'real'), path.join(root, 'link'));
  await refuses(createNodeAssetSource({}).listThemeFiles({ theme: { id: 't', dir: path.join(root, 'link') } }), 'Theme path must be a regular directory.');
});

test('theme inventory never creates a missing theme directory', async () => {
  await assert.rejects(createNodeAssetSource({}).listThemeFiles({ theme: { id: 't', dir: path.join(root, 'missing') } }), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(root, 'missing')), { code: 'ENOENT' });
});

test('theme inventory lists nested regular files sorted and skips file symlinks', async () => {
  await mkdir(path.join(root, 'b', 'c'), { recursive: true });
  await writeFile(path.join(root, 'z.css'), 'z');
  await writeFile(path.join(root, 'b', 'c', 'a.png'), 'a');
  await writeFile(path.join(root, 'a.html'), 'a');
  await symlink(path.join(root, 'z.css'), path.join(root, 'link.css'));
  assert.deepEqual(await createNodeAssetSource({}).listThemeFiles({ theme: { id: 't', dir: root } }), ['a.html', 'b/c/a.png', 'z.css']);
});
