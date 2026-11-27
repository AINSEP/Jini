import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createProjectPaths, createProjectStore, openFileTreeProject } from '../filesystem.js';
import { projectLimits } from '../../paths.js';

const roots: string[] = [], hash = 'a'.repeat(64);
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture() {
  const base = await fs.mkdtemp(join(tmpdir(), 'jini-store-contract-')); roots.push(base);
  // realpath keeps the persisted root portable across /tmp -> /private/tmp on macOS.
  const canonical = await fs.realpath(base), root = join(canonical, 'app'), stateDir = join(canonical, 'state');
  await fs.mkdir(root); await fs.writeFile(join(root, 'safe.txt'), 'safe');
  await openFileTreeProject({ root, stateDir, policy: { allows: () => true } });
  const limits = projectLimits({ limits: { maxFiles: 2, maxFileBytes: 16, maxTreeBytes: 20 } });
  const paths = createProjectPaths({ root, limits, policy: { allows: () => true } });
  const store = createProjectStore({ root, stateDir, paths, limits });
  const current = await store.readCurrent();
  if (!current) throw new Error('fixture did not select a project revision');
  return { root, stateDir, store, current };
}

it.each([
  { patch: { version: 2 }, message: 'stateDir belongs to another root or schema' },
  { patch: { root: '/elsewhere' }, message: 'stateDir belongs to another root or schema' },
  ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(generation => ({ patch: { generation }, message: 'invalid generation' })),
  { patch: { revision: '../escape' }, message: 'invalid content identifier' },
  ...[false, '', {}, { from: 'bad' }].map(pending => ({ patch: { pending }, message: pending && typeof pending === 'object' && 'from' in pending ? 'invalid content identifier' : 'invalid pending journal' })),
  ...[null, [], 'bad'].map(observed => ({ patch: { observed }, message: 'invalid observed file metadata' })),
  { patch: { observed: { 'safe.txt': null } }, message: 'invalid file fingerprint' },
  { patch: { observed: { 'safe.txt': { size: -1, mtimeMs: 1, ctimeMs: 1 } } }, message: 'invalid fingerprint size' },
  { patch: { observed: { 'safe.txt': { size: 1, mtimeMs: null, ctimeMs: 1 } } }, message: 'invalid fingerprint timestamps' },
  { patch: { observed: { 'safe.txt': { size: 1, mtimeMs: 1, ctimeMs: null } } }, message: 'invalid fingerprint timestamps' },
])('refuses corrupt current metadata: $patch', async ({ patch, message }) => {
  const { root, stateDir, current, store } = await fixture();
  const serialized = JSON.stringify({ ...current, ...patch });
  await fs.writeFile(join(stateDir, 'current.json'), serialized);
  await expect(store.recover()).rejects.toMatchObject({ code: 'CORRUPT', message });
  expect(await fs.readFile(join(root, 'safe.txt'), 'utf8')).toBe('safe');
  expect(await fs.readFile(join(stateDir, 'current.json'), 'utf8')).toBe(serialized);
});

const file = { path: 'safe.txt', hash, size: 4 };
it.each([
  { value: null, message: 'unsupported manifest' },
  { value: { version: 2, files: [] }, message: 'unsupported manifest' },
  { value: { version: 1, files: {} }, message: 'unsupported manifest' },
  { value: { version: 1, files: [file, file, file] }, message: 'manifest exceeds file limit' },
  ...[null, { ...file, path: 3 }, { ...file, hash: 3 }].map(entry => ({ value: { version: 1, files: [entry] }, message: 'invalid manifest file' })),
  { value: { version: 1, files: [{ ...file, hash: 'bad' }] }, message: 'invalid content identifier' },
  ...[-1, 1.5, 17].map(size => ({ value: { version: 1, files: [{ ...file, size }] }, message: 'invalid manifest size' })),
  { value: { version: 1, files: [file, file] }, message: 'duplicate manifest path' },
  { value: { version: 1, files: [{ ...file, size: 16 }, { ...file, path: 'second.txt', size: 16 }] }, message: 'manifest exceeds tree limit' },
  { value: { version: 1, files: [file] }, message: 'manifest digest mismatch' },
])('refuses malformed or tampered manifests: $message ($value)', async ({ value, message }) => {
  const { root, stateDir, store } = await fixture();
  await fs.writeFile(join(stateDir, 'manifests', `${hash}.json`), JSON.stringify(value));
  await expect(store.manifest({ revisionId: hash })).rejects.toMatchObject({ code: 'CORRUPT', message });
  expect(await fs.readFile(join(root, 'safe.txt'), 'utf8')).toBe('safe');
});

it.each(['invalid json', 'oversized', 'missing manifest', 'missing object', 'oversized object', 'short object'] as const)('refuses %s without overwriting working bytes', async mode => {
  const { root, stateDir, store, current } = await fixture();
  const manifestPath = join(stateDir, 'manifests', `${current.revision}.json`);
  const manifest = await store.manifest({ revisionId: current.revision });
  const objectPath = join(stateDir, 'objects', manifest.files[0]!.hash);
  if (mode === 'invalid json') await fs.writeFile(join(stateDir, 'current.json'), '{');
  if (mode === 'oversized') await fs.writeFile(join(stateDir, 'current.json'), ' '.repeat(6145));
  if (mode === 'missing manifest') await fs.rm(manifestPath);
  if (mode === 'missing object') await fs.rm(objectPath);
  if (mode === 'oversized object') await fs.writeFile(objectPath, 'safe plus extra bytes');
  if (mode === 'short object') await fs.writeFile(objectPath, 's');
  const read = mode.includes('object') ? store.object({ file: manifest.files[0]! }) : store.recover();
  await expect(read).rejects.toMatchObject({ code: 'CORRUPT' });
  expect(await fs.readFile(join(root, 'safe.txt'), 'utf8')).toBe('safe');
});

it('refuses a generation overflow without replacing the current pointer', async () => {
  const { stateDir, current, store } = await fixture();
  const before = await fs.readFile(join(stateDir, 'current.json'), 'utf8');
  await expect(store.select({ current: { ...current, generation: Number.MAX_SAFE_INTEGER }, revisionId: current.revision })).rejects.toMatchObject({ code: 'LIMIT', message: 'generation exhausted' });
  expect(await fs.readFile(join(stateDir, 'current.json'), 'utf8')).toBe(before);
});

it('refuses to replace an unmanaged file during preflight for a new selection', async () => {
  const { root, stateDir, store } = await fixture();
  const pathname = join(root, 'local.txt');
  await fs.writeFile(pathname, 'local notes');
  const revisionId = await store.prepare({ files: new Map([['local.txt', Buffer.from('incoming')]]) });
  const pointer = join(stateDir, 'current.json');
  const before = await fs.readFile(pointer, 'utf8');
  await expect(store.preflight({ current: null, revisionId })).rejects.toMatchObject({
    code: 'INVALID_CHANGE', message: 'unmanaged file blocks local.txt',
  });
  expect(await fs.readFile(pathname, 'utf8')).toBe('local notes');
  expect(await fs.readFile(pointer, 'utf8')).toBe(before);
});

it('retains the native I/O failure when a file blocks the object directory', async () => {
  const { root, stateDir, store, current } = await fixture();
  const manifest = await store.manifest({ revisionId: current.revision });
  const directory = join(stateDir, 'objects');
  await fs.rename(directory, join(stateDir, 'objects-saved'));
  await fs.writeFile(directory, 'unexpected directory replacement');
  const bytes = Buffer.from('new');
  const files = new Map([['new.txt', bytes]]);
  await expect(store.object({ file: manifest.files[0]! })).rejects.toMatchObject({ code: 'ENOTDIR' });
  await expect(store.prepare({ files })).rejects.toMatchObject({ code: 'ENOTDIR' });
  expect(await fs.readFile(directory, 'utf8')).toBe('unexpected directory replacement');
  expect(await fs.readFile(join(root, 'safe.txt'), 'utf8')).toBe('safe');
});

it('recovery preserves a corrupt manifest error instead of treating the selected revision as absent', async () => {
  const { root, stateDir, store, current } = await fixture();
  await fs.writeFile(join(stateDir, 'manifests', `${current.revision}.json`), '{"version":1,"files":[]}');
  await expect(store.recover()).rejects.toMatchObject({ code: 'CORRUPT', message: 'manifest digest mismatch' });
  expect(await fs.readFile(join(root, 'safe.txt'), 'utf8')).toBe('safe');
});

it('collection reports a blocked object directory instead of silently assuming there are no objects', async () => {
  const { stateDir, store, current } = await fixture();
  const directory = join(stateDir, 'objects');
  await fs.rename(directory, join(stateDir, 'objects-saved'));
  await fs.writeFile(directory, 'not a directory');
  await expect(store.collect({ revisions: new Set([current.revision]) })).rejects.toMatchObject({ code: 'ENOTDIR' });
  expect(await fs.readFile(directory, 'utf8')).toBe('not a directory');
});

it('refreshes durable fingerprints after a same-byte touch without adding history or changing revision', async () => {
  const { root, stateDir, current, store } = await fixture();
  const filePath = join(root, 'safe.txt');
  // Reopening runs the real capture path, which owns the fingerprint refresh.
  await fs.utimes(filePath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-02T00:00:00Z'));
  const reopened = await openFileTreeProject({ root, stateDir, policy: { allows: () => true } });
  const stat = await fs.stat(filePath);
  expect(stat.mtimeMs).not.toBe(current.observed['safe.txt']?.mtimeMs);
  expect(await store.recover()).toEqual({
    ...current, observed: { 'safe.txt': { size: 4, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } },
  });
  expect(await reopened.getRevision()).toEqual({ revisionId: current.revision, generation: current.generation });
  expect(reopened.history.entries()).toEqual([]);
  expect(await reopened.target.readPart({ id: 'safe.txt' })).toBe('safe');
});
