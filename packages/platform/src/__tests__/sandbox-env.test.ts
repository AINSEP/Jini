import { mkdtemp, rm } from 'node:fs/promises';
import fs, { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applySandboxRuntimeEnv,
  ensureSandboxRuntimeDirs,
  isSandboxImportedProjectRootAllowed,
  isSandboxModeEnabled,
  resolveSandboxRuntimeConfig,
  resolveSandboxRuntimeConfigFromEnv,
  sandboxAgentProfilesConfigPath,
  sandboxImportAllowedRoots,
  sandboxImportedProjectRootUnavailableReason,
  type SandboxEnvConfig,
} from '../sandbox-env.js';

const CONFIG: SandboxEnvConfig = {
  modeEnvVar: 'FAKE_SANDBOX_MODE',
  importAllowedRootsEnvVar: 'FAKE_SANDBOX_IMPORT_ALLOWED_ROOTS',
  dataDirEnvVar: 'FAKE_DATA_DIR',
  agentHomeEnvVar: 'FAKE_AGENT_HOME',
  agentProfilesConfigEnvVar: 'FAKE_AGENT_PROFILES_CONFIG',
  agentProfilesDirName: '.fake-agent',
};

const tempDirsToClean: string[] = [];

afterEach(async () => {
  while (tempDirsToClean.length > 0) {
    const dir = tempDirsToClean.pop();
    if (dir) await rm(dir, { force: true, recursive: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirsToClean.push(dir);
  return dir;
}

describe('@jini-ai/platform — sandbox-env — isSandboxModeEnabled', () => {
  it('is false when unset', () => {
    expect(isSandboxModeEnabled(CONFIG, {})).toBe(false);
  });

  it('recognizes truthy and falsy spellings', () => {
    for (const truthy of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(isSandboxModeEnabled(CONFIG, { [CONFIG.modeEnvVar]: truthy })).toBe(true);
    }
    for (const falsy of ['0', 'false', 'no', 'off', '']) {
      expect(isSandboxModeEnabled(CONFIG, { [CONFIG.modeEnvVar]: falsy })).toBe(false);
    }
  });

  it('throws on an unrecognized value', () => {
    expect(() => isSandboxModeEnabled(CONFIG, { [CONFIG.modeEnvVar]: 'maybe' })).toThrow(
      /FAKE_SANDBOX_MODE must be one of/,
    );
  });
});

describe('@jini-ai/platform — sandbox-env — import allowed roots', () => {
  it('is empty when unset or blank', () => {
    expect(sandboxImportAllowedRoots(CONFIG, {})).toEqual([]);
    expect(sandboxImportAllowedRoots(CONFIG, { [CONFIG.importAllowedRootsEnvVar]: '   ' })).toEqual([]);
  });

  it('rejects a relative root entry', () => {
    expect(() =>
      sandboxImportAllowedRoots(CONFIG, { [CONFIG.importAllowedRootsEnvVar]: 'relative/dir' }),
    ).toThrow(/must be absolute paths. Got: relative\/dir/);
  });

  it('canonicalizes existing and non-existing root paths', async () => {
    const realDir = await makeTempDir('jini-sandbox-roots-');
    const missing = join(realDir, 'does-not-exist');
    const roots = sandboxImportAllowedRoots(CONFIG, {
      [CONFIG.importAllowedRootsEnvVar]: [realDir, missing].join(path.delimiter),
    });
    expect(roots).toHaveLength(2);
    expect(roots[1]).toBe(path.normalize(missing));
  });
});

describe('@jini-ai/platform — sandbox-env — imported project root allowed', () => {
  it('allows anything when sandboxing is off', () => {
    expect(isSandboxImportedProjectRootAllowed(CONFIG, '/anywhere', {})).toBe(true);
    expect(sandboxImportedProjectRootUnavailableReason(CONFIG, '/anywhere', {})).toBeNull();
  });

  it('allows a root nested under an allowed root, and the allowed root itself', async () => {
    const allowedRoot = await makeTempDir('jini-sandbox-allowed-');
    const nested = join(allowedRoot, 'nested', 'project');
    const env = {
      [CONFIG.modeEnvVar]: '1',
      [CONFIG.importAllowedRootsEnvVar]: allowedRoot,
    };
    expect(isSandboxImportedProjectRootAllowed(CONFIG, allowedRoot, env)).toBe(true);
    expect(isSandboxImportedProjectRootAllowed(CONFIG, nested, env)).toBe(true);
    expect(sandboxImportedProjectRootUnavailableReason(CONFIG, nested, env)).toBeNull();
  });

  it('denies a root outside every allowed root, with a reason string', async () => {
    const allowedRoot = await makeTempDir('jini-sandbox-allowed-');
    const outsideRoot = await makeTempDir('jini-sandbox-outside-');
    const env = {
      [CONFIG.modeEnvVar]: '1',
      [CONFIG.importAllowedRootsEnvVar]: allowedRoot,
    };
    expect(isSandboxImportedProjectRootAllowed(CONFIG, outsideRoot, env)).toBe(false);
    expect(sandboxImportedProjectRootUnavailableReason(CONFIG, outsideRoot, env)).toMatch(
      /Imported-folder projects are not available/,
    );
  });

  it('falls back to the raw normalized candidate, without hanging, when no ancestor (down to the filesystem root) can be realpath-resolved', () => {
    // Adversarial case for the candidate-canonicalization walk-up: if
    // `fs.realpathSync.native` fails for every ancestor including the
    // filesystem root itself (e.g. a permission-denied edge case), the walk
    // must terminate instead of looping forever on `dirname('/') === '/'`.
    const nativeSpy = vi.spyOn(fs.realpathSync, 'native').mockImplementation(() => {
      throw new Error('simulated: no ancestor is resolvable');
    });
    try {
      const env = {
        [CONFIG.modeEnvVar]: '1',
        [CONFIG.importAllowedRootsEnvVar]: '/unresolvable-root',
      };
      expect(isSandboxImportedProjectRootAllowed(CONFIG, '/unresolvable-root/nested', env)).toBe(true);
      expect(isSandboxImportedProjectRootAllowed(CONFIG, '/elsewhere/nested', env)).toBe(false);
    } finally {
      nativeSpy.mockRestore();
    }
  });

  it('also terminates (rather than hanging) when a relative candidate root has no resolvable ancestor', () => {
    // Same invariant as above, but for a *relative* candidate: the walk-up's
    // fixed point for a relative path is '.' (path.dirname('.') === '.'),
    // not '/' — a guard that only checked against the absolute filesystem
    // root would spin forever here instead of falling back.
    const nativeSpy = vi.spyOn(fs.realpathSync, 'native').mockImplementation(() => {
      throw new Error('simulated: no ancestor is resolvable, including cwd');
    });
    try {
      const env = {
        [CONFIG.modeEnvVar]: '1',
        [CONFIG.importAllowedRootsEnvVar]: '/unresolvable-root',
      };
      expect(isSandboxImportedProjectRootAllowed(CONFIG, 'relative/nested/root', env)).toBe(false);
    } finally {
      nativeSpy.mockRestore();
    }
  });
});

describe('@jini-ai/platform — sandbox-env — runtime config derivation', () => {
  it('derives the full directory tree from a data dir', () => {
    const runtime = resolveSandboxRuntimeConfig(true, '/data');
    expect(runtime.enabled).toBe(true);
    expect(runtime.roots.agentHomeDir).toBe(join('/data', 'sandbox', 'agent-home'));
    expect(runtime.roots.mcpConfigDir).toBe('/data');
    expect(runtime.roots.generatedFilesDir).toBe(join('/data', 'generated-files'));
  });

  it('resolves null from env when sandboxing is off', () => {
    expect(resolveSandboxRuntimeConfigFromEnv(CONFIG, {}, '/project')).toBeNull();
  });

  it('throws from env when sandboxing is on but the data dir is unset', () => {
    expect(() =>
      resolveSandboxRuntimeConfigFromEnv(CONFIG, { [CONFIG.modeEnvVar]: '1' }, '/project'),
    ).toThrow(/FAKE_DATA_DIR is required/);
  });

  it('resolves a runtime config from env, expanding a home-relative data dir', () => {
    const runtime = resolveSandboxRuntimeConfigFromEnv(
      CONFIG,
      { [CONFIG.modeEnvVar]: '1', [CONFIG.dataDirEnvVar]: 'relative-data' },
      '/project',
    );
    expect(runtime?.enabled).toBe(true);
    expect(runtime?.dataDir).toBe(path.resolve('/project', 'relative-data'));
  });

  it('derives the agent-profiles config path from the configured dir name', () => {
    const runtime = resolveSandboxRuntimeConfig(true, '/data');
    expect(sandboxAgentProfilesConfigPath(CONFIG, runtime)).toBe(
      join(runtime.roots.agentHomeDir, '.fake-agent', 'agents.local.json'),
    );
  });
});

describe('@jini-ai/platform — sandbox-env — dirs and env overlay', () => {
  it('creates every sandbox directory, idempotently', async () => {
    const dataDir = await makeTempDir('jini-sandbox-dirs-');
    const runtime = resolveSandboxRuntimeConfig(true, dataDir);
    ensureSandboxRuntimeDirs(runtime);
    ensureSandboxRuntimeDirs(runtime);
    for (const dir of Object.values(runtime.roots)) {
      expect(existsSync(dir)).toBe(true);
    }
  });

  it('is a no-op when the runtime config is disabled', async () => {
    // F1: a fresh tmp parent + absent child, never a path at the filesystem root — a mutant that
    // ignores `enabled` used to create `/should-not-be-touched/**` on the host (Stryker L1 §2.2).
    const parent = await makeTempDir('jini-sandbox-disabled-');
    const dataDir = join(parent, 'should-not-be-touched');
    const runtime = resolveSandboxRuntimeConfig(false, dataDir);
    expect(() => ensureSandboxRuntimeDirs(runtime)).not.toThrow();
    expect(existsSync(dataDir)).toBe(false);
    for (const dir of Object.values(runtime.roots)) expect(existsSync(dir)).toBe(false);
  });

  it('returns baseEnv unchanged when disabled', () => {
    const runtime = resolveSandboxRuntimeConfig(false, '/data');
    const baseEnv = { PATH: '/usr/bin' };
    expect(applySandboxRuntimeEnv(CONFIG, baseEnv, runtime)).toBe(baseEnv);
  });

  it('overlays sandboxed HOME/XDG/TMPDIR vars when enabled', () => {
    const runtime = resolveSandboxRuntimeConfig(true, '/data');
    const baseEnv = { PATH: '/usr/bin' };
    const env = applySandboxRuntimeEnv(CONFIG, baseEnv, runtime);
    expect(env).not.toBe(baseEnv);
    expect(env.PATH).toBe('/usr/bin');
    expect(env[CONFIG.modeEnvVar]).toBe('1');
    expect(env[CONFIG.dataDirEnvVar]).toBe('/data');
    expect(env[CONFIG.agentHomeEnvVar]).toBe(runtime.roots.agentHomeDir);
    expect(env.HOME).toBe(runtime.roots.agentHomeDir);
    expect(env.USERPROFILE).toBe(runtime.roots.agentHomeDir);
    expect(env.XDG_CONFIG_HOME).toBe(runtime.roots.configDir);
    expect(env.TMPDIR).toBe(runtime.roots.tempDir);
    expect(env.CODEX_HOME).toBe(join(runtime.roots.agentHomeDir, '.codex'));
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(runtime.roots.configDir, 'claude'));
    expect(env[CONFIG.agentProfilesConfigEnvVar]).toBe(
      sandboxAgentProfilesConfigPath(CONFIG, runtime),
    );
    expect(env.NPM_CONFIG_USERCONFIG).toBe(join(runtime.roots.toolConfigDir, 'npmrc'));
  });
});

// F1 fix wave (Stryker L1 §4 sandbox-env.ts:74-91,135,144 — trim, `some`→`every`, `relative===''`).
describe('@jini-ai/platform — sandbox-env — F1 allowed-roots containment', () => {
  async function roots() {
    const a = fs.realpathSync.native(await makeTempDir('jini-root-a-'));
    const b = fs.realpathSync.native(await makeTempDir('jini-root-b-'));
    const c = fs.realpathSync.native(await makeTempDir('jini-root-c-'));
    return { a, b, c };
  }
  const envFor = (value: string) => ({ FAKE_SANDBOX_MODE: '1', FAKE_SANDBOX_IMPORT_ALLOWED_ROOTS: value });

  it('padded entries are trimmed and empty segments dropped', async () => {
    const { a, b } = await roots();
    const env = envFor(`  ${a}  ${path.delimiter}${path.delimiter} ${b}\t`);
    expect(sandboxImportAllowedRoots(CONFIG, env)).toEqual([a, b]);
  });

  it.each(['', '   ', path.delimiter])('a blank roots value %j means no allowed roots', (value) => {
    expect(sandboxImportAllowedRoots(CONFIG, envFor(value))).toEqual([]);
  });

  it('a relative entry anywhere in the list is refused with the env var name and the entry', async () => {
    const { a } = await roots();
    expect(() => sandboxImportAllowedRoots(CONFIG, envFor(`${a}${path.delimiter}rel/dir`))).toThrow(
      new Error('FAKE_SANDBOX_IMPORT_ALLOWED_ROOTS entries must be absolute paths. Got: rel/dir'),
    );
  });

  it('a project under ANY one of several roots is allowed (first, middle, last); under none is refused', async () => {
    const { a, b, c } = await roots();
    const env = envFor([a, b, c].join(path.delimiter));
    for (const root of [a, b, c]) {
      expect(isSandboxImportedProjectRootAllowed(CONFIG, join(root, 'proj'), env)).toBe(true);
      expect(sandboxImportedProjectRootUnavailableReason(CONFIG, join(root, 'proj', 'deep'), env)).toBeNull();
    }
    const outside = fs.realpathSync.native(await makeTempDir('jini-outside-'));
    expect(isSandboxImportedProjectRootAllowed(CONFIG, outside, env)).toBe(false);
    expect(sandboxImportedProjectRootUnavailableReason(CONFIG, outside, env)).toBe(
      'Imported-folder projects are not available in FAKE_SANDBOX_MODE unless their root is under FAKE_SANDBOX_IMPORT_ALLOWED_ROOTS.',
    );
  });

  it('the root itself counts as inside; a sibling sharing its name prefix and a parent-escape do not', async () => {
    const { a } = await roots();
    const env = envFor(a);
    expect(isSandboxImportedProjectRootAllowed(CONFIG, a, env)).toBe(true);
    expect(isSandboxImportedProjectRootAllowed(CONFIG, `${a}-sibling`, env)).toBe(false);
    expect(isSandboxImportedProjectRootAllowed(CONFIG, join(a, '..', 'escape'), env)).toBe(false);
  });

  it('sandboxing on with no roots configured refuses every imported root', async () => {
    const { a } = await roots();
    expect(isSandboxImportedProjectRootAllowed(CONFIG, a, { FAKE_SANDBOX_MODE: 'true' })).toBe(false);
  });
});
