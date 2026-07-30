import { describe, expect, it } from 'vitest';
import { copilotAgentDef } from '../copilot.js';

describe('copilotAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(copilotAgentDef.id).toBe('copilot');
    expect(copilotAgentDef.bin).toBe('copilot');
    expect(copilotAgentDef.promptViaStdin).toBe(true);
    expect(copilotAgentDef.streamFormat).toBe('copilot-stream-json');
    expect(copilotAgentDef.inactivityTimeoutMs).toBe(30 * 60 * 1000);
    expect(copilotAgentDef.fallbackModels.map((m) => m.id)).toEqual(['default', 'claude-sonnet-4.6', 'gpt-5.2']);
  });
});

describe('copilotAgentDef.buildArgs', () => {
  it('produces the base argv with no model and no extra dirs', () => {
    const args = copilotAgentDef.buildArgs('hi', [], []);
    expect(args).toEqual(['--allow-all-tools', '--output-format', 'json']);
  });

  it('omits --model when options.model is the synthetic "default" sentinel', () => {
    const args = copilotAgentDef.buildArgs('hi', [], [], { model: 'default' });
    expect(args).not.toContain('--model');
  });

  it('omits --model when options.model is falsy', () => {
    const args = copilotAgentDef.buildArgs('hi', [], [], { model: '' });
    expect(args).not.toContain('--model');
  });

  it('includes --model <id> when a concrete model is selected', () => {
    const args = copilotAgentDef.buildArgs('hi', [], [], { model: 'gpt-5.2' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.2');
  });

  it('appends --add-dir once per non-empty extraAllowedDirs entry, filtering out non-string/empty entries', () => {
    const args = copilotAgentDef.buildArgs('hi', [], [
      '/dir-a',
      '',
      // @ts-expect-error deliberately exercising the runtime string-type guard
      42,
      '/dir-b',
    ]);
    const addDirIndices = args.reduce<number[]>((acc, v, i) => (v === '--add-dir' ? [...acc, i] : acc), []);
    expect(addDirIndices).toHaveLength(2);
    expect(args[addDirIndices[0]! + 1]).toBe('/dir-a');
    expect(args[addDirIndices[1]! + 1]).toBe('/dir-b');
  });

  it('emits no --add-dir flags when extraAllowedDirs is omitted/empty', () => {
    const args = copilotAgentDef.buildArgs('hi', []);
    expect(args).not.toContain('--add-dir');
  });

  it('tolerates an explicit null extraAllowedDirs (the `|| []` fallback, distinct from the default param)', () => {
    const args = copilotAgentDef.buildArgs('hi', [], null as unknown as string[]);
    expect(args).not.toContain('--add-dir');
  });

  it('omits --allow-all-tools entirely when permissionMode is "restricted"', () => {
    const args = copilotAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--allow-all-tools');
    expect(args).toEqual(['--output-format', 'json']);
  });

  it('still emits --allow-all-tools when permissionMode is explicitly "bypass"', () => {
    expect(copilotAgentDef.buildArgs('hi', [], [], { permissionMode: 'bypass' })).toEqual([
      '--allow-all-tools',
      '--output-format',
      'json',
    ]);
  });

  it('still adds --model and --add-dir after omitting --allow-all-tools in restricted mode', () => {
    const args = copilotAgentDef.buildArgs('hi', [], ['/dir-a'], {
      permissionMode: 'restricted',
      model: 'gpt-5.2',
    });
    expect(args).toEqual(['--output-format', 'json', '--model', 'gpt-5.2', '--add-dir', '/dir-a']);
  });
});
