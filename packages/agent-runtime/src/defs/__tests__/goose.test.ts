import { afterEach, describe, expect, it } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { getAgentDef } from '../../registry.js';
import { gooseAgentDef } from '../goose.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe(null);
});

describe('gooseAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the ACP handshake args for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (request) => {
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'x', label: 'x' }];
      },
    };
    setAcpModelProbe(stub);
    const models = await gooseAgentDef.fetchModels!('goose', {});
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'goose', args: ['acp'] }]);
  });
});

describe('gooseAgentDef.buildArgs', () => {
  it('always returns the ACP argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = gooseAgentDef.buildArgs;
    expect(buildArgs('prompt', ['img.png'], ['/extra'], { model: 'x', permissionMode: 'restricted' }, { cwd: '/a' })).toEqual(['acp']);
  });
});

describe('gooseAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(gooseAgentDef.id).toBe('goose');
    expect(gooseAgentDef.bin).toBe('goose');
    expect(gooseAgentDef.versionArgs).toEqual(['--version']);
    expect(gooseAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(gooseAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(gooseAgentDef.externalMcpInjection).toBe('acp-merge');
    expect(gooseAgentDef.imageDelivery).toBe('native');
  });

  it('is registered in the built-in catalog', () => {
    expect(getAgentDef('goose')).toBe(gooseAgentDef);
  });
});
