import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeModelOption } from '../../types.js';

const mockState = vi.hoisted(() => ({
  execImpl: async (
    _bin: string,
    _args: string[],
    _opts?: unknown,
  ): Promise<{ stdout: string; stderr: string }> => ({ stdout: '', stderr: '' }),
  execCalls: [] as Array<{ bin: string; args: string[]; opts?: unknown }>,
  parseImpl: undefined as ((stdout: unknown) => RuntimeModelOption[] | null) | undefined,
}));

vi.mock('../shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared.js')>();
  return {
    ...actual,
    execAgentFile: (bin: string, args: string[], opts?: unknown) => {
      mockState.execCalls.push({ bin, args, opts });
      return mockState.execImpl(bin, args, opts);
    },
    parsePiModels: (stdout: unknown) =>
      mockState.parseImpl ? mockState.parseImpl(stdout) : actual.parsePiModels(stdout),
  };
});

import { piAgentDef } from '../pi.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

afterEach(() => {
  mockState.execCalls = [];
  mockState.execImpl = async () => ({ stdout: '', stderr: '' });
  mockState.parseImpl = undefined;
});

describe('piAgentDef.fetchModels', () => {
  it('reads --list-models from stderr and parses it into model options', async () => {
    mockState.execImpl = async () => ({
      stdout: '',
      stderr: 'provider\tmodel\nanthropic\tclaude-sonnet-4-5',
    });
    const models = await piAgentDef.fetchModels!('pi', { FOO: 'bar' });
    expect(mockState.execCalls).toHaveLength(1);
    expect(mockState.execCalls[0]).toMatchObject({ bin: 'pi', args: ['--list-models'] });
    expect((mockState.execCalls[0]!.opts as Record<string, unknown>).env).toEqual({ FOO: 'bar' });
    expect(models).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
    ]);
  });

  it('returns null when parsePiModels finds no usable rows (empty stderr)', async () => {
    mockState.execImpl = async () => ({ stdout: '', stderr: '' });
    const models = await piAgentDef.fetchModels!('pi', {});
    expect(models).toBeNull();
  });

  it('returns null when parsePiModels returns an empty (non-null) array', async () => {
    // Forces the `parsed.length === 0` disjunct directly, since the real
    // parsePiModels never actually returns a non-null empty array (it
    // returns null instead) — this exercises the defensive branch as
    // written without relying on an otherwise-unreachable real parse result.
    mockState.parseImpl = () => [];
    mockState.execImpl = async () => ({ stdout: '', stderr: 'anything' });
    const models = await piAgentDef.fetchModels!('pi', {});
    expect(models).toBeNull();
  });

  it('returns null when execAgentFile rejects (binary missing, timeout, etc.)', async () => {
    mockState.execImpl = async () => {
      throw new Error('spawn pi ENOENT');
    };
    const models = await piAgentDef.fetchModels!('pi', {});
    expect(models).toBeNull();
  });
});

describe('piAgentDef.buildArgs', () => {
  it('builds the base rpc-mode argv with no model/reasoning/extra dirs', () => {
    expect(piAgentDef.buildArgs('hi', [], [], {}, {})).toEqual(['--mode', 'rpc']);
  });

  it('defaults extraAllowedDirs/options/runtimeContext when omitted', () => {
    expect(piAgentDef.buildArgs('hi', [])).toEqual(['--mode', 'rpc']);
  });

  it('adds --model when a non-default model is selected', () => {
    expect(piAgentDef.buildArgs('hi', [], [], { model: 'anthropic/claude-sonnet-4-5' }, {})).toEqual([
      '--mode',
      'rpc',
      '--model',
      'anthropic/claude-sonnet-4-5',
    ]);
  });

  it('omits --model when the model is the literal string "default"', () => {
    expect(piAgentDef.buildArgs('hi', [], [], { model: 'default' }, {})).toEqual(['--mode', 'rpc']);
  });

  it('adds --thinking when reasoning is set and not "default"', () => {
    expect(piAgentDef.buildArgs('hi', [], [], { reasoning: 'high' }, {})).toEqual([
      '--mode',
      'rpc',
      '--thinking',
      'high',
    ]);
  });

  it('omits --thinking when reasoning is the literal string "default"', () => {
    expect(piAgentDef.buildArgs('hi', [], [], { reasoning: 'default' }, {})).toEqual(['--mode', 'rpc']);
  });

  it('adds --append-system-prompt for each absolute extraAllowedDirs entry, filtering relative/non-string ones', () => {
    const args = piAgentDef.buildArgs(
      'hi',
      [],
      ['/abs/one', 'relative/two', 123 as unknown as string, '/abs/three'],
      {},
      {},
    );
    expect(args).toEqual([
      '--mode',
      'rpc',
      '--append-system-prompt',
      '/abs/one',
      '--append-system-prompt',
      '/abs/three',
    ]);
  });

  it('treats an omitted extraAllowedDirs as empty (parameter default)', () => {
    expect(piAgentDef.buildArgs('hi', [], undefined, {}, {})).toEqual(['--mode', 'rpc']);
  });

  it('treats an explicit null extraAllowedDirs as empty (the `|| []` fallback, not the parameter default)', () => {
    expect(piAgentDef.buildArgs('hi', [], null as unknown as string[], {}, {})).toEqual(['--mode', 'rpc']);
  });

  it('composes model, reasoning, and extra dirs together', () => {
    const args = piAgentDef.buildArgs(
      'hi',
      [],
      ['/extra'],
      { model: 'openai/gpt-5', reasoning: 'medium' },
      {},
    );
    expect(args).toEqual([
      '--mode',
      'rpc',
      '--model',
      'openai/gpt-5',
      '--thinking',
      'medium',
      '--append-system-prompt',
      '/extra',
    ]);
  });
});

describe('piAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(piAgentDef.id).toBe('pi');
    expect(piAgentDef.bin).toBe('pi');
    expect(piAgentDef.versionProbeTimeoutMs).toBe(15_000);
    expect(piAgentDef.fallbackModels).toContainEqual(DEFAULT_MODEL_OPTION);
    expect(piAgentDef.reasoningOptions?.length).toBeGreaterThan(0);
    expect(piAgentDef.promptViaStdin).toBe(true);
    expect(piAgentDef.streamFormat).toBe('pi-rpc');
    expect(piAgentDef.imageDelivery).toBe('native');
  });
});
