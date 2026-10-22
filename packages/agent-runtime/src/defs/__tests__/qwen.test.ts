import { describe, expect, it } from 'vitest';
import { discoveryContext, offlineDiscoveryDeps } from './discovery-fakes.js';
import { qwenAgentDef } from '../qwen.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

describe('qwenAgentDef.buildArgs', () => {
  it('builds the base --yolo argv with no model selected', () => {
    expect(qwenAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).toEqual(['--yolo']);
  });

  it('defaults options to {} when omitted entirely', () => {
    expect(qwenAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [] })).toEqual(['--yolo']);
  });

  it('adds --model when a non-default model is selected', () => {
    expect(qwenAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'qwen3-coder-plus' } })).toEqual([
      '--yolo',
      '--model',
      'qwen3-coder-plus',
    ]);
  });

  it('omits --model when the model is the literal string "default"', () => {
    expect(qwenAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'default' } })).toEqual(['--yolo']);
  });

  it('omits --yolo entirely when permissionMode is "restricted"', () => {
    expect(qwenAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted' } })).toEqual([]);
  });

  it('still adds --model after omitting --yolo in restricted mode', () => {
    expect(qwenAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted', model: 'qwen3-coder-plus' } })).toEqual([
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

describe('qwenAgentDef.discoverModels', () => {
  it('falls back to the concrete static fallback models (minus the default sentinel) when every probe is offline', async () => {
    const catalog = await qwenAgentDef.discoverModels({ context: discoveryContext }, { deps: offlineDiscoveryDeps() });
    expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.models.map((model) => model.id)).toEqual(['qwen3-coder-plus', 'qwen3-coder-flash']);
  });
});
