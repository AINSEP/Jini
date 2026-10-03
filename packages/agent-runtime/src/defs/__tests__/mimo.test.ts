import { describe, expect, it } from 'vitest';
import { mimoAgentDef } from '../mimo.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

describe('mimoAgentDef.buildArgs', () => {
  it('builds the base run/json argv with no model selected', () => {
    expect(mimoAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).toEqual(['run', '--format', 'json']);
  });

  it('defaults options to {} when omitted entirely', () => {
    expect(mimoAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [] })).toEqual(['run', '--format', 'json']);
  });

  it('adds --model when a non-default model is selected', () => {
    expect(mimoAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'mimo-large' } })).toEqual([
      'run',
      '--format',
      'json',
      '--model',
      'mimo-large',
    ]);
  });

  it('omits --model when the model is the literal string "default"', () => {
    expect(mimoAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'default' } })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });
});

describe('mimoAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(mimoAgentDef.id).toBe('mimo');
    expect(mimoAgentDef.bin).toBe('mimo');
    expect(mimoAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(mimoAgentDef.promptViaStdin).toBe(true);
    expect(mimoAgentDef.streamFormat).toBe('json-event-stream');
    expect(mimoAgentDef.eventParser).toBe('opencode');
    expect(mimoAgentDef.externalMcpInjection).toBe('mimo-env-content');
  });
});
