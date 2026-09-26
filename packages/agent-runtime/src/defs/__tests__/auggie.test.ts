import { afterEach, describe, expect, it } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { getAgentDef } from '../../registry.js';
import { auggieAgentDef } from '../auggie.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe(null);
});

describe('auggieAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the ACP handshake args for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (request) => {
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'x', label: 'x' }];
      },
    };
    setAcpModelProbe(stub);
    const models = await auggieAgentDef.fetchModels!('auggie', {});
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'auggie', args: ['--acp'] }]);
  });
});

describe('auggieAgentDef.buildArgs', () => {
  it('always returns the ACP argv, ignoring any input params', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = auggieAgentDef.buildArgs;
    expect(buildArgs('prompt', ['img.png'], ['/extra'], { model: 'x', permissionMode: 'restricted' }, { cwd: '/a' })).toEqual(['--acp']);
  });
});

describe('auggieAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(auggieAgentDef.id).toBe('auggie');
    expect(auggieAgentDef.bin).toBe('auggie');
    expect(auggieAgentDef.versionArgs).toEqual(['--version']);
    expect(auggieAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(auggieAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(auggieAgentDef.externalMcpInjection).toBe('acp-merge');
    expect(auggieAgentDef.imageDelivery).toBe('native');
  });

  it('is registered in the built-in catalog', () => {
    expect(getAgentDef('auggie')).toBe(auggieAgentDef);
  });
});
