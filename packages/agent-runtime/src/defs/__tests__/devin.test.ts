import { afterEach, describe, expect, it } from 'vitest';
import { setAcpModelProbe, type AcpModelProbe } from '../../acp-model-probe.js';
import type { RuntimeAgentDef } from '../../types.js';
import { devinAgentDef } from '../devin.js';

afterEach(() => {
  setAcpModelProbe(null);
});

describe('devinAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(devinAgentDef.id).toBe('devin');
    expect(devinAgentDef.bin).toBe('devin');
    expect(devinAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(devinAgentDef.externalMcpInjection).toBe('acp-merge');
    expect(devinAgentDef.fallbackModels.map((m) => m.id)).toEqual([
      'default',
      'adaptive',
      'swe',
      'opus',
      'sonnet',
      'codex',
      'gpt',
      'gemini',
    ]);
  });
});

describe('devinAgentDef.buildArgs', () => {
  it('returns the fixed dangerous-mode ACP argv regardless of prompt/image/dir/model inputs', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = devinAgentDef.buildArgs;
    const args = buildArgs('any prompt', ['/img.png'], ['/extra'], { model: 'sonnet' }, { cwd: '/x' });
    expect(args).toEqual(['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false', 'acp']);
  });

  it('omits --permission-mode dangerous and --respect-workspace-trust false when permissionMode is "restricted"', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = devinAgentDef.buildArgs;
    const args = buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('dangerous');
    expect(args).not.toContain('--respect-workspace-trust');
    expect(args).toEqual(['acp']);
  });

  it('still emits the dangerous-mode flags when permissionMode is explicitly "bypass"', () => {
    const buildArgs: RuntimeAgentDef['buildArgs'] = devinAgentDef.buildArgs;
    expect(buildArgs('hi', [], [], { permissionMode: 'bypass' })).toEqual([
      '--permission-mode',
      'dangerous',
      '--respect-workspace-trust',
      'false',
      'acp',
    ]);
  });
});

describe('devinAgentDef.fetchModels', () => {
  it('delegates to detectAcpModels with the same fixed ACP argv and a 15s timeout', async () => {
    const seen: Array<{ bin: string; args: string[]; timeoutMs?: number | undefined }> = [];
    const stub: AcpModelProbe = {
      detectModels: async (request) => {
        seen.push({ bin: request.bin, args: request.args, timeoutMs: request.timeoutMs });
        return [{ id: 'adaptive', label: 'adaptive' }];
      },
    };
    setAcpModelProbe(stub);

    const models = await devinAgentDef.fetchModels!('devin', {});

    expect(models).toEqual([{ id: 'adaptive', label: 'adaptive' }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      bin: 'devin',
      args: ['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false', 'acp'],
      timeoutMs: 15_000,
    });
  });

  it('propagates whatever the resolved bin path is through to the probe request', async () => {
    const seen: string[] = [];
    setAcpModelProbe({
      detectModels: async (request) => {
        seen.push(request.bin);
        return [];
      },
    });

    await devinAgentDef.fetchModels!('/abs/path/to/devin', {});

    expect(seen).toEqual(['/abs/path/to/devin']);
  });
});
