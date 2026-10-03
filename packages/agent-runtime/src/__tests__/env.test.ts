import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
