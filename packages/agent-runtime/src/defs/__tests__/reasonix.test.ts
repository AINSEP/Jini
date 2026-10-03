import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { reasonixAgentDef } from '../reasonix.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe({ probe: null });
});

describe('reasonixAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the ACP handshake args for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (required, optional = {}) => {
        const request = { ...optional, ...required };
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }];
      },
    };
    setAcpModelProbe({ probe: stub });
    const models = await reasonixAgentDef.fetchModels!({ resolvedBin: 'reasonix', env: {} });
    expect(models).toEqual([{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }]);
    expect(seen).toEqual([{ bin: 'reasonix', args: ['acp'] }]);
  });
});

describe('reasonixAgentDef.buildArgs', () => {
  it('always returns the ACP argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = reasonixAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: ['img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'x' }, runtimeContext: { cwd: '/a' } })).toEqual(['acp']);
  });
});

describe('reasonixAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(reasonixAgentDef.id).toBe('reasonix');
    expect(reasonixAgentDef.name).toBe('DeepSeek Reasonix');
    expect(reasonixAgentDef.bin).toBe('reasonix');
    expect(reasonixAgentDef.fallbackBins).toEqual(['dsnix']);
    expect(reasonixAgentDef.fallbackModels).toContainEqual(DEFAULT_MODEL_OPTION);
    expect(reasonixAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(reasonixAgentDef.mcpDiscovery).toBe('mature-acp');
    expect(reasonixAgentDef.externalMcpInjection).toBe('acp-merge');
    expect(reasonixAgentDef.acpMcpEnvFormat).toBe('map');
    expect(typeof reasonixAgentDef.env?.REASONIX_HOME).toBe('string');
    expect((reasonixAgentDef.env?.REASONIX_HOME ?? '').length).toBeGreaterThan(0);
  });
});

// reasonixHome() (unexported) runs once at module-evaluation time to compute
// the def's `env.REASONIX_HOME`. Re-importing the module fresh (via
// vi.resetModules()) after changing process.env/process.platform is the only
// way to exercise its branches, since the statically-imported def above only
// ever reflects whatever the real test-runner environment happened to be.
describe('reasonixHome() env/platform resolution (via fresh module re-import)', () => {
  const originalPlatform = process.platform;
  const originalReasonixHome = process.env.REASONIX_HOME;
  const originalAppData = process.env.APPDATA;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalReasonixHome === undefined) delete process.env.REASONIX_HOME;
    else process.env.REASONIX_HOME = originalReasonixHome;
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    vi.resetModules();
  });

  it('honors an already-set REASONIX_HOME regardless of platform', async () => {
    process.env.REASONIX_HOME = '/custom/reasonix-home';
    vi.resetModules();
    const mod = await import('../reasonix.js');
    expect(mod.reasonixAgentDef.env?.REASONIX_HOME).toBe('/custom/reasonix-home');
  });

  it('falls back to ~/.reasonix on non-win32 platforms when REASONIX_HOME is unset', async () => {
    delete process.env.REASONIX_HOME;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.resetModules();
    const mod = await import('../reasonix.js');
    expect(mod.reasonixAgentDef.env?.REASONIX_HOME).toBe(path.join(os.homedir(), '.reasonix'));
  });

  it('uses %APPDATA%/reasonix on win32 when APPDATA is set', async () => {
    delete process.env.REASONIX_HOME;
    process.env.APPDATA = 'C:\\Users\\tester\\AppData\\Roaming';
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.resetModules();
    const mod = await import('../reasonix.js');
    expect(mod.reasonixAgentDef.env?.REASONIX_HOME).toBe(
      path.join('C:\\Users\\tester\\AppData\\Roaming', 'reasonix'),
    );
  });

  it('falls back to homedir/AppData/Roaming/reasonix on win32 when APPDATA is unset', async () => {
    delete process.env.REASONIX_HOME;
    delete process.env.APPDATA;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.resetModules();
    const mod = await import('../reasonix.js');
    expect(mod.reasonixAgentDef.env?.REASONIX_HOME).toBe(
      path.join(os.homedir(), 'AppData', 'Roaming', 'reasonix'),
    );
  });
});
