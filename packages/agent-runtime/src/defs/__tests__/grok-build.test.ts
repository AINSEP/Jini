import { describe, expect, it } from 'vitest';
import { grokBuildAgentDef, parseGrokBuildModels } from '../grok-build.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

describe('parseGrokBuildModels', () => {
  it('returns just the default option when nothing matches', () => {
    expect(parseGrokBuildModels({ stdout: '' })).toEqual([DEFAULT_MODEL_OPTION]);
    expect(parseGrokBuildModels({ stdout: 'You are logged in with grok.com\nStatus: ok' })).toEqual([
      DEFAULT_MODEL_OPTION,
    ]);
  });

  it('extracts bare grok-* ids', () => {
    expect(parseGrokBuildModels({ stdout: 'grok-4.3' })).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'grok-4.3', label: 'grok-4.3' },
    ]);
  });

  it('extracts bullet-prefixed ids with "*" and "-" markers', () => {
    const stdout = '* grok-4.3 (default)\n- grok-4.20-reasoning';
    expect(parseGrokBuildModels({ stdout: stdout })).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'grok-4.3', label: 'grok-4.3' },
      { id: 'grok-4.20-reasoning', label: 'grok-4.20-reasoning' },
    ]);
  });

  it('matches case-insensitively', () => {
    expect(parseGrokBuildModels({ stdout: 'GROK-4.3' })).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'GROK-4.3', label: 'GROK-4.3' },
    ]);
  });

  it('de-dupes repeated ids while preserving order', () => {
    const stdout = 'grok-4.3\ngrok-4.3\ngrok-build';
    expect(parseGrokBuildModels({ stdout: stdout })).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'grok-4.3', label: 'grok-4.3' },
      { id: 'grok-build', label: 'grok-build' },
    ]);
  });
});

describe('grokBuildAgentDef.buildArgs', () => {
  it('throws when runtimeContext.promptFilePath is missing', () => {
    expect(() => grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toThrow(
      /requires runtimeContext.promptFilePath/,
    );
  });

  it('builds the minimal argv with just the prompt file when no model/reasoning is given', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: { promptFilePath: '/tmp/p.txt' } });
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt']);
  });

  it('adds --model when a non-default model is selected', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'grok-4.3' }, runtimeContext: { promptFilePath: '/tmp/p.txt' } }
    );
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt', '--model', 'grok-4.3']);
  });

  it('omits --model when the model is the synthetic default id', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: DEFAULT_MODEL_OPTION.id }, runtimeContext: { promptFilePath: '/tmp/p.txt' } }
    );
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt']);
  });

  it('adds --effort when reasoning is set and the model name contains "reasoning"', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'grok-4.20-reasoning', reasoning: 'high' }, runtimeContext: { promptFilePath: '/tmp/p.txt' } }
    );
    expect(args).toEqual([
      '--prompt-file',
      '/tmp/p.txt',
      '--model',
      'grok-4.20-reasoning',
      '--effort',
      'high',
    ]);
  });

  it('omits --effort when reasoning is set but there is no model selected', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { reasoning: 'high' }, runtimeContext: { promptFilePath: '/tmp/p.txt' } }
    );
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt']);
  });

  it('omits --effort when the model is the synthetic default id', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: DEFAULT_MODEL_OPTION.id, reasoning: 'high' }, runtimeContext: { promptFilePath: '/tmp/p.txt' } }
    );
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt']);
  });

  it('omits --effort when the model is the literal "grok-build" id', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'grok-build', reasoning: 'high' }, runtimeContext: { promptFilePath: '/tmp/p.txt' } }
    );
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt', '--model', 'grok-build']);
  });

  it('omits --effort when the model does not mention "reasoning"', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'grok-4.3', reasoning: 'high' }, runtimeContext: { promptFilePath: '/tmp/p.txt' } }
    );
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt', '--model', 'grok-4.3']);
  });

  it('defaults extra args and options params when omitted', () => {
    const args = grokBuildAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { runtimeContext: {
      promptFilePath: '/tmp/p.txt',
    } });
    expect(args).toEqual(['--prompt-file', '/tmp/p.txt']);
  });
});

describe('grokBuildAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(grokBuildAgentDef.id).toBe('grok-build');
    expect(grokBuildAgentDef.bin).toBe('grok');
    expect(grokBuildAgentDef.listModels?.parse).toBe(parseGrokBuildModels);
    expect(grokBuildAgentDef.fallbackModels).toContainEqual(DEFAULT_MODEL_OPTION);
    expect(grokBuildAgentDef.promptViaFile).toBe(true);
    expect(grokBuildAgentDef.streamFormat).toBe('plain');
  });
});
