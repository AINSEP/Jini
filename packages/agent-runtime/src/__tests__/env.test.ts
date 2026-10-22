import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnEnvForAgent } from '../env.js';

function makeExecutable(filePath: string): void {
  writeFileSync(filePath, '#!/bin/sh\necho stub\n', 'utf8');
  chmodSync(filePath, 0o755);
}

describe('spawnEnvForAgent', () => {
  it('merges base env with configured overrides without touching an unrelated agent', () => {
    const env = spawnEnvForAgent({ agentId: 'claude', baseEnv: { PATH: '/usr/bin' } }, { configuredEnv: { ANTHROPIC_API_KEY: 'sk-test' }, systemProxyEnv: {} });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('disables OpenCode project-config discovery by default', () => {
    const env = spawnEnvForAgent({ agentId: 'opencode', baseEnv: {} }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');
  });

  it('leaves an already-set OPENCODE_DISABLE_PROJECT_CONFIG value untouched', () => {
    const env = spawnEnvForAgent({ agentId: 'opencode', baseEnv: { OPENCODE_DISABLE_PROJECT_CONFIG: 'false' } }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('false');
  });

  it('disables MiMo project-config discovery by default', () => {
    const env = spawnEnvForAgent({ agentId: 'mimo', baseEnv: {} }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(env.MIMOCODE_DISABLE_PROJECT_CONFIG).toBe('true');
  });

  it('leaves an already-set MIMOCODE_DISABLE_PROJECT_CONFIG value untouched', () => {
    const env = spawnEnvForAgent({ agentId: 'mimo', baseEnv: { MIMOCODE_DISABLE_PROJECT_CONFIG: 'false' } }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(env.MIMOCODE_DISABLE_PROJECT_CONFIG).toBe('false');
  });

  it('leaves an already-set HOME value untouched for the amr branch', () => {
    const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: { HOME: '/already/set/home' } }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(env.HOME).toBe('/already/set/home');
  });

  it('leaves an already-set VELA_OPENCODE_BIN value untouched for the amr branch', () => {
    const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: { HOME: '/h', VELA_OPENCODE_BIN: '/already/set/opencode' } }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(env.VELA_OPENCODE_BIN).toBe('/already/set/opencode');
  });

  describe('amr: VELA_OPENCODE_BIN backfill (resolveAmrOpenCodeExecutable)', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-env-amr-opencode-test-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('backfills VELA_OPENCODE_BIN from the bundled companion tree when unset and resolvable', () => {
      const resourceRoot = path.join(dir, 'resources');
      const companionDir = path.join(resourceRoot, 'bin', 'libexec', 'opencode');
      mkdirSync(companionDir, { recursive: true });
      const companionBin = path.join(companionDir, process.platform === 'win32' ? 'opencode.exe' : 'opencode');
      makeExecutable(companionBin);
      const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: { HOME: '/h', AGENT_RUNTIME_RESOURCE_ROOT: resourceRoot } }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env.VELA_OPENCODE_BIN).toBe(companionBin);
    });

    it('leaves VELA_OPENCODE_BIN unset when nothing resolves anywhere', () => {
      const originalPath = process.env.PATH;
      // Scope both PATH and the toolchain-bin-dir search to an isolated
      // empty fake home so this assertion doesn't depend on whether
      // opencode/opencode-cli happens to be installed on this dev machine.
      process.env.AGENT_RUNTIME_HOME = dir;
      process.env.PATH = dir;
      try {
        const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: { HOME: '/h' } }, { configuredEnv: {}, systemProxyEnv: {} });
        expect(env.VELA_OPENCODE_BIN).toBeUndefined();
      } finally {
        process.env.PATH = originalPath;
        delete process.env.AGENT_RUNTIME_HOME;
      }
    });
  });

  it('strips OpenCode server-identity env keys case-insensitively', () => {
    const env = spawnEnvForAgent({ agentId: 'opencode', baseEnv: { opencode_pid: '123', OPENCODE_RUN_ID: 'x' } }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(env.opencode_pid).toBeUndefined();
    expect(env.OPENCODE_RUN_ID).toBeUndefined();
  });

  it('calls the perAgentEnv hook and merges its return value in', () => {
    const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: {} }, { configuredEnv: {}, systemProxyEnv: {}, hooks: {
      perAgentEnv: ({ agentId, env: liveEnv }) => {
        expect(agentId).toBe('amr');
        expect(liveEnv.HOME).toBeTruthy(); // backfilled by the amr branch above
        return { VELA_LINK_URL: 'https://example.test' };
      },
    } });
    expect(env.VELA_LINK_URL).toBe('https://example.test');
  });

  it('applies the sandboxOverlay hook last', () => {
    const env = spawnEnvForAgent({ agentId: 'claude', baseEnv: {} }, { configuredEnv: {}, systemProxyEnv: {}, hooks: {
      sandboxOverlay: ({ env: liveEnv }) => ({ ...liveEnv, SANDBOX_MARKER: '1' }),
    } });
    expect(env.SANDBOX_MARKER).toBe('1');
  });

  it('never emits the product-branded env vars the origin hardcoded (installation id, analytics client-source identity)', () => {
    // Built via concatenation so this test file doesn't itself contain the
    // banned literal — see auth.test.ts's ORIGIN_PRODUCT_NAME comment.
    const bannedInstallationIdKey = ['OD', 'INSTALLATION', 'ID'].join('_');
    const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: {} }, { configuredEnv: {}, systemProxyEnv: {} });
    expect(Object.keys(env)).not.toContain(bannedInstallationIdKey);
    expect(env.AMR_CLIENT_SOURCE).toBeUndefined();
  });

  describe('characterization (pinned before the complexity refactor)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('lets configuredEnv override the same key from baseEnv', () => {
      const env = spawnEnvForAgent({ agentId: 'claude', baseEnv: { FAKE_KEY: 'base' } }, { configuredEnv: { FAKE_KEY: 'configured' }, systemProxyEnv: {} });
      expect(env.FAKE_KEY).toBe('configured');
    });

    it('backfills a whitespace-only HOME from os.homedir() for amr', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/fake/os/home');
      const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: { HOME: '   ', VELA_OPENCODE_BIN: '/x' } }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env.HOME).toBe('/fake/os/home');
    });

    it('leaves HOME unset for amr when os.homedir() returns an empty string', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('');
      const env = spawnEnvForAgent({ agentId: 'amr', baseEnv: { VELA_OPENCODE_BIN: '/x' } }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env.HOME).toBeUndefined();
    });

    it('does not backfill HOME for a non-amr agent', () => {
      const homedir = vi.spyOn(os, 'homedir').mockReturnValue('/fake/os/home');
      const env = spawnEnvForAgent({ agentId: 'claude', baseEnv: {} }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env.HOME).toBeUndefined();
      expect(homedir).not.toHaveBeenCalled();
    });

    it('replaces a whitespace-only OPENCODE_DISABLE_PROJECT_CONFIG with "true"', () => {
      const env = spawnEnvForAgent({ agentId: 'opencode', baseEnv: { OPENCODE_DISABLE_PROJECT_CONFIG: ' ' } }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');
    });

    it('replaces a whitespace-only MIMOCODE_DISABLE_PROJECT_CONFIG with "true"', () => {
      const env = spawnEnvForAgent({ agentId: 'mimo', baseEnv: { MIMOCODE_DISABLE_PROJECT_CONFIG: ' ' } }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env.MIMOCODE_DISABLE_PROJECT_CONFIG).toBe('true');
    });

    it('strips exactly the four OpenCode identity keys for opencode, including ones supplied by configuredEnv', () => {
      const env = spawnEnvForAgent(
        { agentId: 'opencode', baseEnv: { OPENCODE: '1', Opencode_Pid: '2', OPENCODE_CONFIG_CONTENT: '{}' } },
        { configuredEnv: { opencode_run_id: '3', OPENCODE_SERVER_PASSWORD: 'fake-password' }, systemProxyEnv: {} },
      );
      expect(Object.keys(env).sort()).toEqual(['OPENCODE_CONFIG_CONTENT', 'OPENCODE_DISABLE_PROJECT_CONFIG']);
    });

    it('strips exactly the four MiMo identity keys for mimo, case-insensitively', () => {
      const env = spawnEnvForAgent(
        { agentId: 'mimo', baseEnv: { mimocode: '1', MIMOCODE_PID: '2', MimoCode_Run_Id: '3', MIMOCODE_SERVER_PASSWORD: 'fake-password', MIMOCODE_CONFIG_CONTENT: '{}', OPENCODE_PID: '9' } },
        { configuredEnv: {}, systemProxyEnv: {} },
      );
      expect(Object.keys(env).sort()).toEqual(['MIMOCODE_CONFIG_CONTENT', 'MIMOCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_PID']);
    });

    it('keeps OpenCode/MiMo identity keys and adds no disable flags for an unrelated agent', () => {
      const env = spawnEnvForAgent({ agentId: 'claude', baseEnv: { OPENCODE_PID: '1', MIMOCODE_PID: '2' } }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env).toEqual({ OPENCODE_PID: '1', MIMOCODE_PID: '2' });
    });

    it('treats a prototype-ish agentId as an unrelated agent', () => {
      const env = spawnEnvForAgent({ agentId: '__proto__', baseEnv: { A: '1' } }, { configuredEnv: {}, systemProxyEnv: {} });
      expect(env).toEqual({ A: '1' });
    });

    it('lets perAgentEnv overrides win over housekeeping values, including re-adding a stripped key', () => {
      const env = spawnEnvForAgent({ agentId: 'opencode', baseEnv: { OPENCODE_PID: '1' } }, { configuredEnv: {}, systemProxyEnv: {}, hooks: {
        perAgentEnv: () => ({ OPENCODE_DISABLE_PROJECT_CONFIG: 'false', OPENCODE_PID: '7' }),
      } });
      expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('false');
      expect(env.OPENCODE_PID).toBe('7');
    });

    it('keeps env unchanged when perAgentEnv returns nothing', () => {
      const env = spawnEnvForAgent({ agentId: 'claude', baseEnv: { A: '1' } }, { configuredEnv: {}, systemProxyEnv: {}, hooks: {
        perAgentEnv: () => undefined,
      } });
      expect(env).toEqual({ A: '1' });
    });

    it('runs sandboxOverlay after perAgentEnv and returns exactly what the overlay returns', () => {
      const env = spawnEnvForAgent({ agentId: 'claude', baseEnv: { A: '1' } }, { configuredEnv: {}, systemProxyEnv: {}, hooks: {
        perAgentEnv: () => ({ B: '2' }),
        sandboxOverlay: ({ env: liveEnv }) => ({ SEEN_B: liveEnv.B ?? 'missing' }),
      } });
      expect(env).toEqual({ SEEN_B: '2' });
    });
  });
});
