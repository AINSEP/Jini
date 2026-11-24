import { describe, expect, test } from 'vitest';
import { adoptAndEnsureDaemonSecret } from '../run-credentials.js';

/** @file The adopt-from-env / keep-in-memory / never-rotate contract hosts use for daemon and tool RPC secrets. */
let minted = 0;
const crypto = { mintToken: () => `minted-${++minted}` };

describe('adoptAndEnsureDaemonSecret', () => {
  test('adopts an operator value, removes it from env, and keeps it across calls', () => {
    const env: Record<string, string | undefined> = { SECRET: 'operator' }; const holder: Record<string, string | undefined> = {};
    expect(adoptAndEnsureDaemonSecret({ env, holder, envVarName: 'SECRET', crypto })).toBe('operator');
    expect(env.SECRET).toBeUndefined();
    env.SECRET = 'later';
    expect(adoptAndEnsureDaemonSecret({ env, holder, envVarName: 'SECRET', crypto })).toBe('operator');
    expect(env.SECRET).toBeUndefined();
  });
  test('mints once when no operator value exists, and reads through the host secret resolver', () => {
    const holder: Record<string, string | undefined> = {};
    const first = adoptAndEnsureDaemonSecret({ env: {}, holder, envVarName: 'SECRET', crypto });
    expect(first).toMatch(/^minted-/);
    expect(adoptAndEnsureDaemonSecret({ env: {}, holder, envVarName: 'SECRET', crypto })).toBe(first);
    const resolved = adoptAndEnsureDaemonSecret({ env: { SECRET_FILE: '/x' }, holder: {}, envVarName: 'SECRET', crypto },
      { readOperatorSecrets: ({ env }) => ({ ...env, SECRET: 'from-file' }) });
    expect(resolved).toBe('from-file');
  });
});
