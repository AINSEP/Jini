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
  const current = JSON.parse(await fs.readFile(join(stateDir, 'current.json'), 'utf8'));
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
