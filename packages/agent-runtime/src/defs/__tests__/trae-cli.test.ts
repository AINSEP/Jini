import { afterEach, describe, expect, it } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { traeCliAgentDef } from '../trae-cli.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe(null);
});

describe('traeCliAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the ACP serve handshake args for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (request) => {
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'x', label: 'x' }];
      },
    };
    setAcpModelProbe(stub);
    const models = await traeCliAgentDef.fetchModels!('traecli', {});
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'traecli', args: ['acp', 'serve'] }]);
  });
});

describe('traeCliAgentDef.buildArgs', () => {
  it('always returns the ACP serve --yolo argv, ignoring prompt/images/dirs/model/cwd', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = traeCliAgentDef.buildArgs;
    expect(buildArgs('prompt', ['img.png'], ['/extra'], { model: 'x' }, { cwd: '/a' })).toEqual([
      'acp',
      'serve',
      '--yolo',
    ]);
  });

  it('omits --yolo when permissionMode is "restricted"', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = traeCliAgentDef.buildArgs;
    expect(buildArgs('prompt', [], [], { permissionMode: 'restricted' })).toEqual(['acp', 'serve']);
  });
});

describe('traeCliAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(traeCliAgentDef.id).toBe('trae-cli');
    expect(traeCliAgentDef.bin).toBe('traecli');
    expect(traeCliAgentDef.versionProbeTimeoutMs).toBe(10_000);
    expect(traeCliAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(traeCliAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(traeCliAgentDef.mcpDiscovery).toBe('mature-acp');
    expect(traeCliAgentDef.externalMcpInjection).toBe('acp-merge');
  });
});
