import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { nodeLoginShellPorts, omitEnvironmentKeys, type LoginShellPorts } from '../child-environment.js';

describe('omitEnvironmentKeys', () => {
  it('omits scoped overrides without changing the parent or reporting their values', () => {
    const parent = Object.freeze({ PATH: '/bin', STORE: '/private/value', SKILLS: '', OTHER: 'keep' });
    const result = omitEnvironmentKeys({ env: parent, keys: ['STORE', 'SKILLS', 'ABSENT'] });
    expect(result).toEqual({ env: { PATH: '/bin', OTHER: 'keep' }, omitted: ['STORE', 'SKILLS'] });
    expect(parent.STORE).toBe('/private/value');
  });

  it('removes every Windows case variant and reports a key only once', () => {
    expect(omitEnvironmentKeys({ env: { store: 'one', STORE: 'two', Store: 'three', PATH: '/bin' },
      keys: ['STORE', 'STORE'] }, { caseInsensitive: true })).toEqual({ env: { PATH: '/bin' }, omitted: ['STORE'] });
  });

  it('keeps distinct POSIX names and ignores unset keys', () => {
    expect(omitEnvironmentKeys({ env: { store: 'keep', STORE: undefined }, keys: ['STORE'] })).toEqual({
      env: { store: 'keep' }, omitted: [],
    });
  });
});

import { readLoginShellEnvironment } from '../child-environment.js';

it('login-shell parity exposes operator credentials while withholding daemon secrets before AND after profiles', async () => {
  const result = await readLoginShellEnvironment({
    baseEnv: { HOME: '/operator', PATH: '/bin', HOST_INTEGRATIONS_ROOT_KEY: 'root-secret', JINI_DAEMON_TOKEN: 'bridge-secret', DATABASE_URL: 'database-secret' },
    excludedPrefixes: ['HOST_', 'JINI_'], excludedKeys: ['DATABASE_URL'], excludedSuffixes: ['_ROOT_KEY'],
  }, { read: async ({ env }) => {
    expect(env).toEqual({ HOME: '/operator', PATH: '/bin' });
    return { ...env, ANTHROPIC_API_KEY: 'operator-key', SSH_AUTH_SOCK: '/operator/ssh', HTTPS_PROXY: 'proxy',
      CODEX_HOME: '/operator/codex', HOST_INTEGRATIONS_ROOT_KEY: 'profile-secret', JINI_DAEMON_TOKEN: 'profile-token', DATABASE_URL: 'profile-db', OTHER_ROOT_KEY: 'private' };
  } });
  expect(result).toEqual({ HOME: '/operator', PATH: '/bin', ANTHROPIC_API_KEY: 'operator-key', SSH_AUTH_SOCK: '/operator/ssh', HTTPS_PROXY: 'proxy', CODEX_HOME: '/operator/codex' });
});

it('never exposes shell profile output through a failed environment read', async () => {
  await expect(readLoginShellEnvironment({ baseEnv: {}, excludedPrefixes: [], excludedKeys: [] }, {
    read: async () => { throw new Error('profile printed a secret'); },
  })).rejects.toThrow('Login shell environment unavailable');
});

describe('readLoginShellEnvironment default reader', () => {
  const posix = (stdout: string, calls: unknown[] = [], shell: string | null = '/bin/zsh'): LoginShellPorts => ({
    platform: 'linux', userShell: () => shell,
    runCommand: async (request) => { calls.push(request); return { stdout }; },
  });

  it('runs the account login shell with only bootstrap keys and keeps well-formed env -0 names', async () => {
    const calls: unknown[] = [];
    const result = await readLoginShellEnvironment({ baseEnv: { HOME: '/home/op', PATH: '/bin', SECRET_TOKEN: 'x' }, excludedPrefixes: [], excludedKeys: [] },
      { ports: posix('PATH=/usr/bin\0HOME=/home/op\0EQ=a=b\0=nameless\0bad-name=1\0noequals\0', calls) });
    expect(calls).toEqual([{ file: '/bin/zsh', args: ['-ilc', 'exec /usr/bin/env -0'], env: { HOME: '/home/op', PATH: '/bin' }, cwd: '/home/op' }]);
    expect(result).toEqual({ PATH: '/usr/bin', HOME: '/home/op', EQ: 'a=b' });
  });

  it.each([
    ['falls back to the baseline SHELL when the account has none', null, { SHELL: '/bin/fish' }, '/bin/fish'],
    ['falls back to /bin/sh when neither the account nor the baseline names a shell', '', {}, '/bin/sh'],
  ] as const)('%s', async (_name, accountShell, baseEnv, expectedShell) => {
    const calls: { file: string }[] = [];
    await readLoginShellEnvironment({ baseEnv, excludedPrefixes: [], excludedKeys: [] }, { ports: posix('', calls, accountShell) });
    expect(calls.map(call => call.file)).toEqual([expectedShell]);
  });

  it('on Windows reads the registry environment through PowerShell, layered over the baseline', async () => {
    const calls: { file: string; args: readonly string[]; cwd: string | undefined }[] = [];
    const ports: LoginShellPorts = { platform: 'win32', userShell: () => null,
      runCommand: async (request) => { calls.push(request); return { stdout: JSON.stringify({ Path: 'C:\\Tools', HOST_SECRET: 'x' }) }; } };
    const result = await readLoginShellEnvironment({ baseEnv: { USERPROFILE: 'C:\\Users\\op', ComSpec: 'cmd.exe' }, excludedPrefixes: ['host_'], excludedKeys: [] }, { ports });
    expect(calls[0]?.file).toBe('powershell.exe');
    expect(calls[0]?.args.slice(0, 3)).toEqual(['-NoLogo', '-NonInteractive', '-Command']);
    expect(calls[0]?.cwd).toBe('C:\\Users\\op');
    expect(result).toEqual({ USERPROFILE: 'C:\\Users\\op', ComSpec: 'cmd.exe', Path: 'C:\\Tools' });
  });

  it('turns a command failure into the generic unavailable error', async () => {
    const ports: LoginShellPorts = { platform: 'linux', userShell: () => '/bin/sh', runCommand: async () => { throw new Error('profile leaked a value'); } };
    await expect(readLoginShellEnvironment({ baseEnv: {}, excludedPrefixes: [], excludedKeys: [] }, { ports }))
      .rejects.toThrow(new Error('Login shell environment unavailable'));
  });

  it('the Node host ports report this process and run a real bounded command with the given env and cwd', async () => {
    const ports = nodeLoginShellPorts();
    expect(ports.platform).toBe(process.platform);
    const shell = ports.userShell();
    expect(shell === null || typeof shell === 'string').toBe(true);
    const { stdout } = await ports.runCommand({ file: process.execPath, args: ['-e', 'process.stdout.write(process.env.PROBE + "|" + process.cwd())'],
      env: { PROBE: 'value' }, cwd: tmpdir() });
    expect(stdout).toBe(`value|${realpathSync(tmpdir())}`);
  });
});
