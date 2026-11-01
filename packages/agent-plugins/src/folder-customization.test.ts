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
