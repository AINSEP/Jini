import { describe, expect, it } from 'vitest';
import { omitEnvironmentKeys } from '../child-environment.js';

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
