import { afterEach, describe, expect, it } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { getAgentDef } from '../../registry.js';
import { clineAgentDef } from '../cline.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe({ probe: null });
});

describe('clineAgentDef.fetchModels', () => {
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
    const models = await clineAgentDef.fetchModels!({ resolvedBin: 'cline', env: {} });
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'cline', args: ['--acp'] }]);
  });
});

describe('clineAgentDef.buildArgs', () => {
  it('always returns the ACP argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = clineAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: ['img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'x', permissionMode: 'restricted' }, runtimeContext: { cwd: '/a' } })).toEqual(['--acp']);
  });
});

describe('clineAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(clineAgentDef.id).toBe('cline');
    expect(clineAgentDef.bin).toBe('cline');
    expect(clineAgentDef.versionArgs).toEqual(['--version']);
    expect(clineAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(clineAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(clineAgentDef.externalMcpInjection).toBe('acp-merge');
    expect(clineAgentDef.imageDelivery).toBe('native');
  });

  it('is registered in the built-in catalog', () => {
    expect(getAgentDef({ id: 'cline' })).toBe(clineAgentDef);
  });
});
