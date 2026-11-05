import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, chmod, readdir, rm, symlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { installOwnedJsonAgent } from '../owned-json-install.js';
import { planAgentInstall } from '../install.js';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'mcp-owned-')); homes.push(home);
  const required = { agentId: 'antigravity', allowed: true, ctx: { home, platform: 'linux' as const, serverName: 'jini' },
    spec: { command: 'node', args: ['/bridge.js'], env: {} } };
  const plan = planAgentInstall({ ...required, slug: 'antigravity' });
  if (plan.kind !== 'json') throw new Error('Expected JSON');
  return { required, file: plan.configPath };
}
test('denial performs no filesystem writes, even when a valid config already exists', async () => {
  const { required, file } = await fixture();
  await expect(installOwnedJsonAgent({ ...required, allowed: false })).rejects.toThrow(/Allow/);
  expect(await readdir(required.ctx.home)).toEqual([]);
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ mcpServers: { jini: required.spec } }));
  await expect(installOwnedJsonAgent({ ...required, allowed: false })).rejects.toThrow(/Allow/);
  expect(await readdir(dirname(file))).toEqual(['mcp_config.json']);
});
test('approved install preserves foreign fields, file mode and first backup; repeated/concurrent installs are idempotent', async () => {
  const { required, file } = await fixture();
  await mkdir(dirname(file), { recursive: true });
  const original = JSON.stringify({ mcpServers: { foreign: { command: 'keep' } }, theme: 'dark' });
  await writeFile(file, original, { mode: 0o640 }); await chmod(file, 0o640);
  await Promise.all([installOwnedJsonAgent(required), installOwnedJsonAgent(required)]);
  const installed = JSON.parse(await readFile(file, 'utf8'));
  expect(installed).toEqual({ mcpServers: { foreign: { command: 'keep' }, jini: { command: required.spec.command, args: required.spec.args } }, theme: 'dark' });
  expect(await readFile(`${file}.jini-backup`, 'utf8')).toBe(original);
  expect((await stat(file)).mode & 0o777).toBe(0o640);
  installed.theme = 'light'; await writeFile(file, JSON.stringify(installed));
  await installOwnedJsonAgent(required);
  expect(await readFile(`${file}.jini-backup`, 'utf8')).toBe(original);
});
test('foreign jini entry is refused without write or backup', async () => {
  const { required, file } = await fixture(); await mkdir(dirname(file), { recursive: true });
  const original = JSON.stringify({ mcpServers: { jini: { command: 'foreign' } } }); await writeFile(file, original);
  await expect(installOwnedJsonAgent(required)).rejects.toThrow(/different jini entry/);
  expect(await readFile(file, 'utf8')).toBe(original);
  expect(await readdir(dirname(file))).toEqual(['mcp_config.json']);
});
test('symlink config is refused without modifying its target', async () => {
  const { required, file } = await fixture(); await mkdir(dirname(file), { recursive: true });
  const target = join(required.ctx.home, 'target'); await writeFile(target, '{}'); await symlink(target, file);
  await expect(installOwnedJsonAgent(required)).rejects.toThrow(/symlink/);
  expect(await readFile(target, 'utf8')).toBe('{}');
});
test.each(['JINI_RUN_ID', 'JINI_DAEMON_TOKEN', 'SECRET'])('rejects persistent %s before I/O', async key => {
  const { required } = await fixture();
  await expect(installOwnedJsonAgent({ ...required, spec: { ...required.spec, env: { [key]: 'sentinel' } } })).rejects.toThrow(/cannot be saved/);
  expect(await readdir(required.ctx.home)).toEqual([]);
});
test('new config contains only the static launch entry and defaults to owner-only mode', async () => {
  const { required, file } = await fixture(); required.spec.env = { ELECTRON_RUN_AS_NODE: '1' } as typeof required.spec.env;
  await installOwnedJsonAgent(required);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ mcpServers: { jini: required.spec } });
  expect((await stat(file)).mode & 0o777).toBe(0o600);
});

test('malformed config errors do not disclose its contents', async () => {
  const { required, file } = await fixture(); await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'PRIVATE_SENTINEL');
  await expect(installOwnedJsonAgent(required)).rejects.toThrow(/not valid JSON/);
  try { await installOwnedJsonAgent(required); } catch (error) { expect(String(error)).not.toContain('PRIVATE_SENTINEL'); }
  expect(await readFile(file, 'utf8')).toBe('PRIVATE_SENTINEL');
});
