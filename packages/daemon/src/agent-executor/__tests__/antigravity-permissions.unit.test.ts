import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureAntigravityMcpPermission } from '../antigravity-permissions.js';

// Direct characterization of the permission writer: every branch of the grant decision is pinned
// here, independently of the launch seam exercised by antigravity-permissions.test.ts.

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(path => fs.rm(path, { recursive: true, force: true })));
});

async function settingsFile(raw?: string): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'agy-permission-unit-'));
  roots.push(root);
  const settingsPath = join(root, 'settings.json');
  if (raw !== undefined) await fs.writeFile(settingsPath, raw);
  return settingsPath;
}
const grant = (settingsPath: string, serverName = 'jini') => ensureAntigravityMcpPermission({ settingsPath, serverName });
const read = (path: string) => fs.readFile(path, 'utf8');
const exists = (path: string) => fs.access(path).then(() => true, () => false);

describe('ensureAntigravityMcpPermission server-name validation', () => {
  it.each(['', 'a b', 'a/b', '../x', 'a*', 'jini)', 'x\n', 'a,b'])('refuses %j before touching the settings', async serverName => {
    const settingsPath = await settingsFile();
    await expect(grant(settingsPath, serverName)).rejects.toThrow(/^Invalid MCP server name$/);
    expect(await exists(settingsPath)).toBe(false);
    expect(await exists(`${settingsPath}.jini-lock`)).toBe(false);
  });

  it('accepts word characters, dots and dashes', async () => {
    const settingsPath = await settingsFile();
    await grant(settingsPath, 'a.B-c_9');
    expect(JSON.parse(await read(settingsPath))).toEqual({ permissions: { allow: ['mcp(a.B-c_9/*)'] } });
  });
});

describe('ensureAntigravityMcpPermission settings reads', () => {
  it('creates a missing file, including a missing parent directory, without a backup', async () => {
    const settingsPath = join(await settingsFile(), '..', 'nested', 'deeper', 'settings.json');
    await grant(settingsPath);
    expect(await read(settingsPath)).toBe(`${JSON.stringify({ permissions: { allow: ['mcp(jini/*)'] } }, null, 2)}\n`);
    expect(await exists(`${settingsPath}.jini-backup`)).toBe(false);
  });

  it('rethrows a read failure other than ENOENT', async () => {
    const settingsPath = await settingsFile();
    await fs.mkdir(settingsPath);
    await expect(grant(settingsPath)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('rethrows invalid JSON without rewriting the file', async () => {
    const settingsPath = await settingsFile('{broken');
    await expect(grant(settingsPath)).rejects.toThrow(SyntaxError);
    expect(await read(settingsPath)).toBe('{broken');
    expect(await exists(`${settingsPath}.jini-backup`)).toBe(false);
  });

  it.each(['[]', 'null', '7', '"text"', 'true'])('refuses non-object settings %s', async raw => {
    const settingsPath = await settingsFile(raw);
    await expect(grant(settingsPath)).rejects.toThrow(/^Antigravity settings must be an object$/);
    expect(await read(settingsPath)).toBe(raw);
  });

  it.each([
    '{"permissions":null}', '{"permissions":[]}', '{"permissions":"x"}', '{"permissions":3}',
    '{"permissions":{"allow":null}}', '{"permissions":{"allow":"mcp(*)"}}', '{"permissions":{"allow":{"0":"x"}}}',
  ])('refuses a malformed permissions shape %s', async raw => {
    const settingsPath = await settingsFile(raw);
    await expect(grant(settingsPath)).rejects.toThrow(/^Antigravity permissions\.allow must be an array$/);
    expect(await read(settingsPath)).toBe(raw);
  });
});

describe('ensureAntigravityMcpPermission grant decision', () => {
  it('adds a permissions block when none exists and preserves other settings', async () => {
    const settingsPath = await settingsFile('{"theme":"dark"}');
    await grant(settingsPath);
    expect(JSON.parse(await read(settingsPath))).toEqual({ theme: 'dark', permissions: { allow: ['mcp(jini/*)'] } });
    expect(await read(`${settingsPath}.jini-backup`)).toBe('{"theme":"dark"}');
  });

  it('adds an allow list when permissions has none and preserves other permission keys', async () => {
    const settingsPath = await settingsFile('{"permissions":{"deny":["command(rm)"]}}');
    await grant(settingsPath);
    expect(JSON.parse(await read(settingsPath))).toEqual({ permissions: { deny: ['command(rm)'], allow: ['mcp(jini/*)'] } });
  });

  it('appends after existing entries, keeping non-string and near-miss entries untouched', async () => {
    const settingsPath = await settingsFile('{"permissions":{"allow":[1,null,"mcp(jini/*) ","mcp(JINI/*)"]}}');
    await grant(settingsPath);
    expect(JSON.parse(await read(settingsPath)).permissions.allow).toEqual([1, null, 'mcp(jini/*) ', 'mcp(JINI/*)', 'mcp(jini/*)']);
  });

  it('leaves the file byte-identical and creates no backup when the rule is present exactly once', async () => {
    const raw = '{ "permissions": { "allow": ["mcp(jini/*)", "x"] } }';
    const settingsPath = await settingsFile(raw);
    await grant(settingsPath);
    expect(await read(settingsPath)).toBe(raw);
    expect(await exists(`${settingsPath}.jini-backup`)).toBe(false);
  });

  it('removes later duplicates of the rule only, writes and backs up the original', async () => {
    const raw = '{"permissions":{"allow":["a","mcp(jini/*)","b","mcp(jini/*)","a"]}}';
    const settingsPath = await settingsFile(raw);
    await grant(settingsPath);
    expect(JSON.parse(await read(settingsPath)).permissions.allow).toEqual(['a', 'mcp(jini/*)', 'b', 'a']);
    expect(await read(`${settingsPath}.jini-backup`)).toBe(raw);
  });

  it('never replaces an existing backup', async () => {
    const settingsPath = await settingsFile('{}');
    await fs.writeFile(`${settingsPath}.jini-backup`, 'first');
    await grant(settingsPath);
    expect(await read(`${settingsPath}.jini-backup`)).toBe('first');
    expect(JSON.parse(await read(settingsPath))).toEqual({ permissions: { allow: ['mcp(jini/*)'] } });
  });

  it('rejects and leaves the settings unwritten when the backup copy fails for another reason', async () => {
    const settingsPath = await settingsFile('{}');
    const failure = Object.assign(new Error('copy refused'), { code: 'EACCES' });
    vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(failure);
    await expect(grant(settingsPath)).rejects.toBe(failure);
    expect(await read(settingsPath)).toBe('{}');
  });

  it('releases its lock file after a successful grant', async () => {
    const settingsPath = await settingsFile('{}');
    await grant(settingsPath);
    expect(await exists(`${settingsPath}.jini-lock`)).toBe(false);
  });
});

describe('ensureAntigravityMcpPermission symlinked settings', () => {
  // The atomic writer refuses the symlink, but readFile and copyFile already followed it: the link
  // target's bytes are copied into <settings>.jini-backup before the refusal.
  it('refuses to write through a symlink only after reading through it and backing up its target (reported, not fixed)', async () => {
    const target = await settingsFile('{"theme":"linked"}');
    const settingsPath = join(target, '..', 'link.json');
    await fs.symlink(target, settingsPath);
    await expect(grant(settingsPath)).rejects.toThrow(/^atomic write refused a symbolic-link/);
    expect(await read(target)).toBe('{"theme":"linked"}');
    expect(await read(`${settingsPath}.jini-backup`)).toBe('{"theme":"linked"}');
  });
});
