import { afterEach, describe, expect, it } from 'vitest';
import { discoveryContext, offlineDiscoveryDeps } from './discovery-fakes.js';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { vibeAgentDef } from '../vibe.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe({ probe: null });
});

describe('vibeAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with an empty ACP handshake argv for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (required, optional = {}) => {
        const request = { ...optional, ...required };
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'x', label: 'x' }];
      },
    };
    setAcpModelProbe({ probe: stub });
    const models = await vibeAgentDef.fetchModels!({ resolvedBin: 'vibe-acp', env: {} });
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'vibe-acp', args: [] }]);
  });
});

describe('vibeAgentDef.buildArgs', () => {
  it('always returns an empty argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = vibeAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: ['img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'x' }, runtimeContext: { cwd: '/a' } })).toEqual([]);
  });
});

describe('vibeAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(vibeAgentDef.id).toBe('vibe');
    expect(vibeAgentDef.bin).toBe('vibe-acp');
    expect(vibeAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(vibeAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(vibeAgentDef.externalMcpInjection).toBe('acp-merge');
  });
});

describe('vibeAgentDef.discoverModels', () => {
  it('offline discovery yields an empty catalog: the only static fallback is the \'default\' sentinel, which the catalog strips', async () => {
    const catalog = await vibeAgentDef.discoverModels({ context: discoveryContext }, { deps: offlineDiscoveryDeps() });
    expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.models).toEqual([]);
  });
});

describe('vibeAgentDef.fetchModels with an explicitly injected probe', () => {
  it('uses the acpModelProbe passed in the options instead of the process-wide probe', async () => {
    const seen: string[][] = [];
    const injected: AcpModelProbe = {
      detectModels: async (required) => {
        seen.push(required.args);
        return [{ id: 'injected', label: 'injected' }];
      },
    };
    const models = await vibeAgentDef.fetchModels!({ resolvedBin: '/bin/agent', env: {} }, { acpModelProbe: injected });
    expect(models).toEqual([{ id: 'injected', label: 'injected' }]);
    expect(seen).toEqual([[]]);
  });
});
