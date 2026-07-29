import { describe, expect, it } from 'vitest';
import { qwenAgentDef } from '../qwen.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

describe('qwenAgentDef.buildArgs', () => {
  it('builds the base --yolo argv with no model selected', () => {
    expect(qwenAgentDef.buildArgs('hi', [], [], {})).toEqual(['--yolo']);
  });

  it('defaults options to {} when omitted entirely', () => {
    expect(qwenAgentDef.buildArgs('hi', [], [])).toEqual(['--yolo']);
  });

  it('adds --model when a non-default model is selected', () => {
    expect(qwenAgentDef.buildArgs('hi', [], [], { model: 'qwen3-coder-plus' })).toEqual([
      '--yolo',
      '--model',
      'qwen3-coder-plus',
    ]);
  });

  it('omits --model when the model is the literal string "default"', () => {
    expect(qwenAgentDef.buildArgs('hi', [], [], { model: 'default' })).toEqual(['--yolo']);
  });

  it('omits --yolo entirely when permissionMode is "restricted"', () => {
    expect(qwenAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' })).toEqual([]);
  });

  it('still adds --model after omitting --yolo in restricted mode', () => {
    expect(qwenAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted', model: 'qwen3-coder-plus' })).toEqual([
      '--model',
      'qwen3-coder-plus',
    ]);
  });
});

describe('qwenAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(qwenAgentDef.id).toBe('qwen');
    expect(qwenAgentDef.bin).toBe('qwen');
    expect(qwenAgentDef.fallbackModels).toContainEqual(DEFAULT_MODEL_OPTION);
    expect(qwenAgentDef.promptViaStdin).toBe(true);
    expect(qwenAgentDef.streamFormat).toBe('plain');
  });
});
