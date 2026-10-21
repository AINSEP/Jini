import { afterEach, describe, expect, it } from 'vitest';
import { discoveryContext, offlineDiscoveryDeps } from './discovery-fakes.js';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { kiroAgentDef } from '../kiro.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe({ probe: null });
});

describe('kiroAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the ACP handshake args for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (required, optional = {}) => {
        const request = { ...optional, ...required };
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'x', label: 'x' }];
      },
    };
    setAcpModelProbe({ probe: stub });
    const models = await kiroAgentDef.fetchModels!({ resolvedBin: 'kiro-cli', env: {} });
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'kiro-cli', args: ['acp'] }]);
  });
});

describe('kiroAgentDef.buildArgs', () => {
  it('always returns the ACP argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = kiroAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: ['img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'x' }, runtimeContext: { cwd: '/a' } })).toEqual(['acp']);
  });
});

describe('kiroAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(kiroAgentDef.id).toBe('kiro');
    expect(kiroAgentDef.bin).toBe('kiro-cli');
    expect(kiroAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(kiroAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(kiroAgentDef.externalMcpInjection).toBe('acp-merge');
  });
});

describe('kiroAgentDef.discoverModels', () => {
  it('offline discovery yields an empty catalog: the only static fallback is the \'default\' sentinel, which the catalog strips', async () => {
    const catalog = await kiroAgentDef.discoverModels({ context: discoveryContext }, { deps: offlineDiscoveryDeps() });
    expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.models).toEqual([]);
  });
});

describe('kiroAgentDef.fetchModels with an explicitly injected probe', () => {
  it('uses the acpModelProbe passed in the options instead of the process-wide probe', async () => {
    const seen: string[][] = [];
    const injected: AcpModelProbe = {
      detectModels: async (required) => {
        seen.push(required.args);
        return [{ id: 'injected', label: 'injected' }];
      },
    };
    const models = await kiroAgentDef.fetchModels!({ resolvedBin: '/bin/agent', env: {} }, { acpModelProbe: injected });
    expect(models).toEqual([{ id: 'injected', label: 'injected' }]);
    expect(seen).toEqual([['acp']]);
  });
});
