import { afterEach, describe, expect, it } from 'vitest';
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
