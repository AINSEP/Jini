import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipCustomizedAgentPluginFolder } from './folder-zip-node.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-customize-'));
  roots.push(root);
  await mkdir(path.join(root, 'skills'));
  await writeFile(path.join(root, 'plugin.json'), JSON.stringify({ name: 'stock', version: '1.0.0', extensions: { host: { id: 'vendor/stock', renamedFrom: ['vendor/old'] } } }));
  await writeFile(path.join(root, 'skills/SKILL.md'), 'Use blue.');
  return { path: root, maxBytes: 1024 * 1024, name: 'custom', identityNamespace: 'host', edit: { path: 'skills/SKILL.md', oldString: 'blue', newString: 'green' } };
}

test('fork archive changes identity and literal text without mutating source', async () => {
  const input = await fixture();
  const archive = await zipCustomizedAgentPluginFolder(input);
  expect(Buffer.from(archive).includes(Buffer.from('Use green.'))).toBe(true);
  expect(Buffer.from(archive).includes(Buffer.from('vendor/stock'))).toBe(false);
  expect(Buffer.from(archive).includes(Buffer.from('local/custom'))).toBe(true);
  expect(Buffer.from(archive).includes(Buffer.from('vendor/old'))).toBe(false);
  expect(await readFile(path.join(input.path, input.edit.path), 'utf8')).toBe('Use blue.');
});

test.each(['../outside', '/absolute', 'skills\\SKILL.md', 'plugin.json'])('refuses an unsafe or identity edit path: %s', async file => {
  const input = await fixture();
  await expect(zipCustomizedAgentPluginFolder({ ...input, edit: { ...input.edit, path: file } })).rejects.toThrow();
});

test.each(['', 'missing', 'e'])('refuses empty, missing and ambiguous old text: %j', async oldString => {
  const input = await fixture();
  await expect(zipCustomizedAgentPluginFolder({ ...input, edit: { ...input.edit, oldString } })).rejects.toThrow();
});

test('refuses a non-UTF-8 edit target as a named folder error, not a raw decoder error', async () => {
  const input = await fixture();
  await writeFile(path.join(input.path, 'skills/logo.png'), Buffer.from([0x89, 0xff, 0x80]));
  await expect(zipCustomizedAgentPluginFolder({ ...input, edit: { ...input.edit, path: 'skills/logo.png' } })).rejects.toThrow(expect.objectContaining({ reason: 'unreadable', message: expect.stringMatching(/Binary files/) }));
});

test('refuses links, same identity and over-budget replacement bytes', async () => {
  const input = await fixture();
  await expect(zipCustomizedAgentPluginFolder({ ...input, name: 'stock' })).rejects.toThrow();
  await expect(zipCustomizedAgentPluginFolder({ ...input, maxBytes: 512, edit: { ...input.edit, newString: 'x'.repeat(1024) } })).rejects.toThrow();
  await symlink(path.join(input.path, input.edit.path), path.join(input.path, 'link'));
  await expect(zipCustomizedAgentPluginFolder(input)).rejects.toThrow();
});

// The upload and manifest parser share the spec's id grammar, including delimiter and size bounds.
test.each(['Uppercase', 'has--double', 'has..double', '-leading', 'trailing.', 'a'.repeat(65)])
('refuses an invalid fork name: %s', async name => {
  const input = await fixture();
  await expect(zipCustomizedAgentPluginFolder({ ...input, name })).rejects.toThrow('Choose a valid new Agent Plugin id');
});

/** Reads one stored (uncompressed) entry by walking the local headers `zipFolderFiles` writes. */
function storedEntryText(archive: Uint8Array, entryName: string): string {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const dataStart = offset + 30 + nameLength + view.getUint16(offset + 28, true);
    const name = Buffer.from(archive.subarray(offset + 30, offset + 30 + nameLength)).toString('utf8');
    if (name === entryName || name.endsWith(`/${entryName}`)) return Buffer.from(archive.subarray(dataStart, dataStart + size)).toString('utf8');
    offset = dataStart + size;
  }
  throw new Error(`${entryName} not found in archive`);
}

async function forkManifest(extensions: Record<string, unknown> | undefined, identityNamespace: string) {
  const input = await fixture();
  await writeFile(path.join(input.path, 'plugin.json'), JSON.stringify({ name: 'stock', version: '1.0.0', ...(extensions ? { extensions } : {}) }));
  const archive = await zipCustomizedAgentPluginFolder({ ...input, identityNamespace });
  return { manifest: JSON.parse(storedEntryText(archive, 'plugin.json')), text: Buffer.from(archive).toString('utf8') };
}

const HISTORY = { renamedFrom: ['tovu/old-stock'], supersedes: { plugins: ['tovu/older'] } };

// Legacy-only: a moved plugin that still declares only the `tovu` host key.
test.each(['tovu', 'open-marketing'])('a fork of a tovu-only manifest gets a fresh local id when forked by %s', async host => {
  const { manifest, text } = await forkManifest({ tovu: { id: 'tovu/stock', provides: ['stock-data'], ...HISTORY } }, host);
  expect(manifest.extensions.tovu).toEqual({ id: 'local/custom', provides: ['stock-data'] });
  expect(manifest.extensions[host].id).toBe('local/custom');
  for (const claim of ['tovu/stock', 'tovu/old-stock', 'tovu/older', 'renamedFrom', 'supersedes']) expect(text).not.toContain(claim);
});

test('a fork of a dual-key manifest keeps no foreign publisher id, alias or supersession claim', async () => {
  const { manifest, text } = await forkManifest({
    tovu: { id: 'tovu/stock', ...HISTORY },
    'open-marketing': { id: 'jini/stock', renamedFrom: ['jini/old-stock'], hostRange: '^1.0.0' },
    'com.example.client': { theme: 'dark' },
  }, 'open-marketing');
  expect(manifest.extensions).toEqual({
    tovu: { id: 'local/custom' },
    'open-marketing': { id: 'local/custom', hostRange: '^1.0.0' },
    'com.example.client': { theme: 'dark' },
  });
  for (const claim of ['tovu/stock', 'jini/stock', 'jini/old-stock', 'tovu/old-stock', 'tovu/older']) expect(text).not.toContain(claim);
});

test('a fork of a manifest with no extensions declares a local id for the requesting host', async () => {
  const { manifest } = await forkManifest(undefined, 'tovu');
  expect(manifest.extensions).toEqual({ tovu: { id: 'local/custom' } });
});

test('refuses a manifest whose extensions value is not an object', async () => {
  const input = await fixture();
  await writeFile(path.join(input.path, 'plugin.json'), JSON.stringify({ name: 'stock', extensions: ['tovu'] }));
  await expect(zipCustomizedAgentPluginFolder(input)).rejects.toThrow('plugin.json extensions must be an object.');
});
