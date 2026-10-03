import { afterEach, describe, expect, it } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { kiloAgentDef } from '../kilo.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe({ probe: null });
});

describe('kiloAgentDef.fetchModels', () => {
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
    const models = await kiloAgentDef.fetchModels!({ resolvedBin: 'kilo', env: {} });
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'kilo', args: ['acp'] }]);
  });
});

describe('kiloAgentDef.buildArgs', () => {
  it('always returns the ACP argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = kiloAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: ['img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'x' }, runtimeContext: { cwd: '/a' } })).toEqual(['acp']);
  });
});

describe('kiloAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(kiloAgentDef.id).toBe('kilo');
    expect(kiloAgentDef.bin).toBe('kilo');
    expect(kiloAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(kiloAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(kiloAgentDef.externalMcpInjection).toBe('acp-merge');
  });
});
