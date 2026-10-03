import { describe, expect, it } from 'vitest';
import { deepseekAgentDef } from '../deepseek.js';

describe('deepseekAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(deepseekAgentDef.id).toBe('deepseek');
    expect(deepseekAgentDef.bin).toBe('deepseek');
    expect(deepseekAgentDef.fallbackBins).toEqual(['codewhale']);
    expect(deepseekAgentDef.streamFormat).toBe('plain');
    expect(deepseekAgentDef.maxPromptArgBytes).toBe(30_000);
    expect(deepseekAgentDef.fallbackModels.map((m) => m.id)).toEqual([
      'default',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ]);
  });
});

describe('deepseekAgentDef.buildArgs', () => {
  it('omits --model when no options are passed at all, and appends the prompt last', () => {
    const args = deepseekAgentDef.buildArgs({ prompt: 'hello', imagePaths: [] }, { extraAllowedDirs: [] });
    expect(args).toEqual(['exec', '--auto', 'hello']);
  });

  it('omits --model when options.model is the synthetic "default" sentinel', () => {
    const args = deepseekAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'default' } });
    expect(args).toEqual(['exec', '--auto', 'hi']);
  });

  it('omits --model when options.model is falsy', () => {
    const args = deepseekAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: '' } });
    expect(args).not.toContain('--model');
  });

  it('includes --model <id> before the trailing prompt when a concrete model is selected', () => {
    const args = deepseekAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'deepseek-v4-pro' } });
    expect(args).toEqual(['exec', '--auto', '--model', 'deepseek-v4-pro', 'hi']);
  });

  it('defaults options to {} when omitted entirely', () => {
    expect(() => deepseekAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [] })).not.toThrow();
  });
});
