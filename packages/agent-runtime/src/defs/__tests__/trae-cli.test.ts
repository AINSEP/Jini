import { afterEach, describe, expect, it } from 'vitest';
import { discoveryContext, offlineDiscoveryDeps } from './discovery-fakes.js';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { traeCliAgentDef } from '../trae-cli.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  setAcpModelProbe({ probe: null });
});

describe('traeCliAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the ACP serve handshake args for the resolved binary', async () => {
    const seen: Array<{ bin: string; args: string[] }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (required, optional = {}) => {
        const request = { ...optional, ...required };
        seen.push({ bin: request.bin, args: request.args });
        return [{ id: 'x', label: 'x' }];
      },
    };
    setAcpModelProbe({ probe: stub });
    const models = await traeCliAgentDef.fetchModels!({ resolvedBin: 'traecli', env: {} });
    expect(models).toEqual([{ id: 'x', label: 'x' }]);
    expect(seen).toEqual([{ bin: 'traecli', args: ['acp', 'serve'] }]);
  });
});

describe('traeCliAgentDef.buildArgs', () => {
  it('always returns the ACP serve --yolo argv, ignoring prompt/images/dirs/model/cwd', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = traeCliAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: ['img.png'] }, { extraAllowedDirs: ['/extra'], options: { model: 'x' }, runtimeContext: { cwd: '/a' } })).toEqual([
      'acp',
      'serve',
      '--yolo',
    ]);
  });

  it('omits --yolo when permissionMode is "restricted"', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = traeCliAgentDef.buildArgs;
    expect(buildArgs({ prompt: 'prompt', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted' } })).toEqual(['acp', 'serve']);
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

describe('traeCliAgentDef.discoverModels', () => {
  it('offline discovery yields an empty catalog: the only static fallback is the \'default\' sentinel, which the catalog strips', async () => {
    const catalog = await traeCliAgentDef.discoverModels({ context: discoveryContext }, { deps: offlineDiscoveryDeps() });
    expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.models).toEqual([]);
  });
});

describe('traeCliAgentDef.fetchModels with an explicitly injected probe', () => {
  it('uses the acpModelProbe passed in the options instead of the process-wide probe', async () => {
    const seen: string[][] = [];
    const injected: AcpModelProbe = {
      detectModels: async (required) => {
        seen.push(required.args);
        return [{ id: 'injected', label: 'injected' }];
      },
    };
    const models = await traeCliAgentDef.fetchModels!({ resolvedBin: '/bin/agent', env: {} }, { acpModelProbe: injected });
    expect(models).toEqual([{ id: 'injected', label: 'injected' }]);
    expect(seen).toEqual([['acp', 'serve']]);
  });
});
