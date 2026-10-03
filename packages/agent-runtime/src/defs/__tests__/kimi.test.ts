import { afterEach, describe, expect, it } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { kimiAgentDef } from '../kimi.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe({ probe: null });
});

describe('kimiAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the ACP handshake args for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (required, optional = {}) => {
        const request = { ...optional, ...required };
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' }];
      },
    };
    setAcpModelProbe({ probe: stub });
    const models = await kimiAgentDef.fetchModels!({ resolvedBin: 'kimi', env: {} });
    expect(models).toEqual([{ id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' }]);
    expect(seen).toEqual([{ bin: 'kimi', args: ['acp'] }]);
  });
});

describe('kimiAgentDef.buildArgs', () => {
  it('always returns the ACP argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = kimiAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: ['img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'x' }, runtimeContext: { cwd: '/a' } })).toEqual(['acp']);
  });
});

describe('kimiAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(kimiAgentDef.id).toBe('kimi');
    expect(kimiAgentDef.bin).toBe('kimi');
    expect(kimiAgentDef.fallbackModels).toContainEqual(DEFAULT_MODEL_OPTION);
    expect(kimiAgentDef.fallbackModels.length).toBeGreaterThan(1);
    expect(kimiAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(kimiAgentDef.mcpDiscovery).toBe('mature-acp');
    expect(kimiAgentDef.externalMcpInjection).toBe('acp-merge');
  });
});
