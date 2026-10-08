import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createNodeAppFactory, createNodeArtifactWriter, createNodeAssetSource } from '../node-adapters.js';
import { ExportOutputNotEmptyError } from '../contracts.js';

test('Node writer refuses nonempty output, supports explicit clean and writes contained bytes', async () => {
  const outputDir = await realpath(await mkdtemp(path.join(tmpdir(), 'static-export-')));
  const writer = createNodeArtifactWriter({});
  try {
    await writeFile(path.join(outputDir, 'stale.txt'), 'stale');
    await assert.rejects(writer.prepare({ outputDir }), ExportOutputNotEmptyError);
    await writer.prepare({ outputDir }, { clean: true });
    await writer.write({ outputDir, outputFile: 'deep/image.bin', data: Buffer.from([0,255]) });
    assert.deepEqual(await readFile(path.join(outputDir, 'deep/image.bin')), Buffer.from([0,255]));
    await assert.rejects(readFile(path.join(outputDir, 'stale.txt')), { code: 'ENOENT' });
    await assert.rejects(writer.write({ outputDir, outputFile: '../escape', data: 'bad' }), /refused/);
    await assert.rejects(writer.write({ outputDir, outputFile: '/absolute', data: 'bad' }), /refused/);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('writer refuses symlinks at storage root, subdirectory and existing leaf', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'static-export-links-')));
  const writer = createNodeArtifactWriter({});
  try {
    const outputDir = path.join(root, 'output');
    await writer.prepare({ outputDir });
    await writeFile(path.join(root, 'outside.txt'), 'untouched');
    await symlink(root, path.join(outputDir, 'linked-dir'));
    await symlink(path.join(root, 'outside.txt'), path.join(outputDir, 'linked-file'));
    await symlink(outputDir, path.join(root, 'linked-output'));
    await assert.rejects(writer.prepare({ outputDir: path.join(root, 'linked-output') }), /regular directory/);
    await assert.rejects(writer.write({ outputDir, outputFile: 'linked-dir/escape', data: 'bad' }), /regular directory/);
    await assert.rejects(writer.write({ outputDir, outputFile: 'linked-file', data: 'bad' }), /regular file/);
    assert.equal(await readFile(path.join(root, 'outside.txt'), 'utf8'), 'untouched');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Node theme inventory is generic and ignores symlink entries', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'static-export-inventory-')));
  const writer = createNodeArtifactWriter({});
  try {
    await writer.write({ outputDir: root, outputFile: 'custom-pages/index.html', data: 'home' });
    await writer.write({ outputDir: root, outputFile: 'styles/main.css', data: 'css' });
    await symlink(root, path.join(root, 'loop'));
    const source = createNodeAssetSource({});
    assert.deepEqual(await source.listThemeFiles({ theme: { id: 'plain', dir: root } }), ['custom-pages/index.html', 'styles/main.css']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Port test: verifier runs on a host that can bind loopback sockets. NOT RUN here.
test('Node app adapter binds only loopback, serves the supplied app and closes idempotently', async () => {
  const factory = createNodeAppFactory({ createApp: () => (_request, response) => { response.end('real app'); } });
  const session = await factory.open({});
  try {
    assert.equal(new URL(session.baseUrl).hostname, '127.0.0.1');
    assert.equal(await (await fetch(session.baseUrl)).text(), 'real app');
  } finally { await session.close({}); }
  await session.close({});
  await assert.rejects(fetch(session.baseUrl));
});

test('writer accepts the platform temporary directory and keeps host refusal wording', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'static-export-native-'));
  const writer = createNodeArtifactWriter({}, { nonemptyReason: ({ count }) => `Output has ${count} existing file.` });
  try {
    await writer.prepare({ outputDir }, {});
    await writer.write({ outputDir, outputFile: 'existing.txt', data: 'saved' });
    await assert.rejects(writer.prepare({ outputDir }, {}), { message: 'Output has 1 existing file.' });
    assert.equal(await readFile(path.join(outputDir, 'existing.txt'), 'utf8'), 'saved');
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});
