import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parse } from 'smol-toml';
import { expect, it, vi } from 'vitest';
import { codexTurnsOffPersonalConfig, resolveSourceCodexHomeDir, stageCodexHome } from '../codex/home-staging.js';
import { strategiesForDef } from '../../runtime-strategies.js';

const entry = { command: 'host-bridge', args: ['serve'], env: { JINI_RUN_ID: 'blue' } };
const original = 'model = "operator-model"\n[mcp_servers.calendar]\ncommand = "calendar-cli"\n';
const jini = { command: 'host-bridge', args: ['serve'], env: { JINI_RUN_ID: 'blue' } };
const read = ({ path }: { path: string }) => readFile(path, 'utf8');
const write = ({ path, content }: { path: string; content: string }) => writeFile(path, content, 'utf8');

it.each([true, false])('keeps native login and sessions across scratch cleanup (inherit user settings: %s)', async userSettings => {
  const source = await mkdtemp(join(tmpdir(), 'codex-home-source-'));
  try {
    await writeFile(join(source, 'config.toml'), original);
    await writeFile(join(source, 'auth.json'), '{"refresh":"old"}');
    await mkdir(join(source, 'skills'));
    await writeFile(join(source, 'skills', 'operator.md'), 'local only');
    const result = await stageCodexHome({
      runId: '../run/blue', entry, hostEnv: { CODEX_HOME: source }, io: { readFile: read, writeFile: write },
      nativeCapabilities: { userSettings, userMcp: true }, toolApprovalOwner: 'host',
    });
    if (result.kind !== 'staged') throw new Error(result.message);
    const { home } = result;
    try {
      expect(basename(home.path)).toMatch(/^jini-codex-home----run-blue-/);
      expect((await readdir(home.path)).sort()).toEqual([
        'archived_sessions', 'auth.json', 'config.toml', 'sessions', ...(userSettings ? ['skills'] : []),
      ]);
      const doc = parse(await readFile(join(home.path, 'config.toml'), 'utf8'));
      expect(doc.model).toBe(userSettings ? 'operator-model' : undefined);
      expect(doc.mcp_servers).toMatchObject({
        calendar: { command: 'calendar-cli' }, jini: { ...jini, default_tools_approval_mode: 'approve' },
      });
      if (userSettings) expect(await readFile(join(home.path, 'skills', 'operator.md'), 'utf8')).toBe('local only');
      await writeFile(join(home.path, 'auth.json'), '{"refresh":"new"}');
      await writeFile(join(home.path, 'sessions', 'rollout.jsonl'), '{"session":"active"}');
      await writeFile(join(home.path, 'archived_sessions', 'old.jsonl'), '{"session":"archived"}');
    } finally {
      await home.cleanup();
    }
    await expect(readdir(home.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(source, 'auth.json'), 'utf8')).toBe('{"refresh":"new"}');
    expect(await readFile(join(source, 'sessions', 'rollout.jsonl'), 'utf8')).toBe('{"session":"active"}');
    expect(await readFile(join(source, 'archived_sessions', 'old.jsonl'), 'utf8')).toBe('{"session":"archived"}');
    expect(await readFile(join(source, 'config.toml'), 'utf8')).toBe(original);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

function ioFixture() {
  return {
    readFile: vi.fn(async () => original),
    writeFile: vi.fn(write),
    mkdtemp: vi.fn(async () => '/scratch/staged'),
    removeDir: vi.fn(async () => {}),
    linkSessionStore: vi.fn(async () => {}),
  };
}

it.each(['locked native tools', 'MCP off', 'missing config'] as const)('stages only the bridge with %s', async mode => {
  const io = ioFixture();
  // Success is asserted via the exact destination, a parsed config, and what the real link port is asked to preserve.
  io.writeFile.mockResolvedValue(undefined);
  if (mode === 'missing config') io.readFile.mockRejectedValue(new Error('no config'));
  const result = await stageCodexHome({
    runId: '', entry, hostEnv: { CODEX_HOME: '/operator/home' }, io,
    ...(mode === 'locked native tools' ? { nativeToolAccess: false } : { nativeCapabilities: { userMcp: false } }),
  });
  if (result.kind !== 'staged') throw new Error(result.message);
  expect(io.mkdtemp.mock.calls).toEqual([[{ prefix: 'jini-codex-home-run-' }]]);
  expect(io.readFile.mock.calls).toEqual(mode === 'locked native tools' ? [] : [[{ path: join('/operator/home', 'config.toml') }]]);
  expect(io.writeFile).toHaveBeenCalledTimes(1);
  const [{ path, content }] = io.writeFile.mock.calls[0]!;
  expect(path).toBe(join('/scratch/staged', 'config.toml'));
  expect(parse(content)).toEqual({
    ...(mode === 'MCP off' ? { model: 'operator-model' } : {}),
    mcp_servers: { jini: { ...jini, tool_timeout_sec: 400 } },
  });
  expect(io.linkSessionStore.mock.calls).toEqual([[{ runHome: '/scratch/staged', sourceHome: '/operator/home' },
    { inheritUserConfig: mode !== 'locked native tools' }]]);
  await result.home.cleanup();
  expect(io.removeDir.mock.calls).toEqual([[{ path: '/scratch/staged' }]]);
});

it('refuses malformed source TOML before allocating scratch', async () => {
  const io = ioFixture();
  io.readFile.mockResolvedValue('[mcp_servers.unclosed');
  const path = join('/operator/home', 'config.toml');
  await expect(stageCodexHome({
    runId: 'blue', entry, hostEnv: { CODEX_HOME: '/operator/home' }, io, nativeCapabilities: { userMcp: false },
  })).resolves.toEqual({
    kind: 'refused',
    message: `Codex can't run with 'Your MCP servers' off: ${path} isn't valid TOML, so its MCP servers can't be checked. Turn it on in the assistant settings, or choose Claude.`,
  });
  expect(io.readFile.mock.calls).toEqual([[{ path }]]);
  expect(io.mkdtemp.mock.calls).toEqual([]);
  expect(io.writeFile.mock.calls).toEqual([]);
  expect(io.linkSessionStore.mock.calls).toEqual([]);
});

it('refuses inline MCP declarations before allocating scratch', async () => {
  const io = ioFixture();
  io.readFile.mockResolvedValue('mcp_servers = { calendar = { command = "calendar-cli" } }');
  await expect(stageCodexHome({
    runId: 'blue', entry, hostEnv: { CODEX_HOME: '/operator/home' }, io, nativeCapabilities: { userMcp: false },
  })).resolves.toEqual({
    kind: 'refused',
    message: 'Codex can\'t run with \'Your MCP servers\' off: Cannot turn off personal MCP servers: the Codex config.toml declares mcp_servers inline (a dotted key or `mcp_servers = {...}`), which cannot be removed safely; move each server into its own [mcp_servers.<name>] table. Turn it on in the assistant settings, or choose Claude.',
  });
  expect(io.mkdtemp.mock.calls).toEqual([]);
  expect(io.linkSessionStore.mock.calls).toEqual([]);
});

it('preserves a link failure when cleanup of partial Codex staging also fails', async () => {
  const io = ioFixture();
  const failure = new Error('cannot link sessions');
  io.writeFile.mockResolvedValue(undefined);
  io.linkSessionStore.mockRejectedValue(failure);
  io.removeDir.mockRejectedValue(new Error('cannot remove scratch'));
  await expect(stageCodexHome({ runId: 'blue', entry, hostEnv: { CODEX_HOME: '/operator/home' }, io })).rejects.toBe(failure);
  expect(io.linkSessionStore.mock.calls).toEqual([[{ runHome: '/scratch/staged', sourceHome: '/operator/home' }, { inheritUserConfig: true }]]);
  expect(io.removeDir.mock.calls).toEqual([[{ path: '/scratch/staged' }]]);
});

it('finds the operator home from the parent env and changes only stage-specific child env keys', () => {
  expect(resolveSourceCodexHomeDir({ hostEnv: {} })).toBe(join(homedir(), '.codex'));
  expect(resolveSourceCodexHomeDir({ hostEnv: { CODEX_HOME: '   ' } })).toBe(join(homedir(), '.codex'));
  expect(resolveSourceCodexHomeDir({ hostEnv: { CODEX_HOME: '/operator/home' } })).toBe('/operator/home');
  const env = { CODEX_HOME: '/operator/home', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'desktop', PATH: '/tools' };
  const home = strategiesForDef({ def: { id: 'test-cli', externalMcpInjection: 'codex-toml' } }).mcpHome!;
  expect(home.buildDelivery({ serverEntry: entry })).toEqual({ kind: 'codex-toml', serverEntry: entry });
  expect(home.withStagedHome({ env, homeDir: '/scratch/staged' })).toEqual({ CODEX_HOME: '/scratch/staged', PATH: '/tools' });
  expect(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE).toBe('desktop');
  expect(env.CODEX_HOME).toBe('/operator/home');
});

it.each([
  [{}, false],
  [{ userMcp: true, userSettings: true }, false],
  [{ userMcp: false, userSettings: true }, true],
  [{ userMcp: true, userSettings: false }, true],
] as const)('requires a staged home for a disabled personal configuration dimension: %j', (nativeCapabilities, expected) => {
  expect(codexTurnsOffPersonalConfig({ nativeCapabilities })).toBe(expected);
});
