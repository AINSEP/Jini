import { describe, expect, it } from 'vitest';
import { getAgentDef } from '../../registry.js';
import { crushAgentDef } from '../crush.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

describe('crushAgentDef.buildArgs', () => {
  it('builds `run --quiet --yolo` with no model selected', () => {
    expect(crushAgentDef.buildArgs('hi', [], [], {})).toEqual(['run', '--quiet', '--yolo']);
  });

  it('defaults options to {} when omitted entirely', () => {
    expect(crushAgentDef.buildArgs('hi', [], [])).toEqual(['run', '--quiet', '--yolo']);
  });

  it('never puts the prompt in argv (it goes over stdin)', () => {
    expect(crushAgentDef.buildArgs('secret prompt text', [], [], {})).not.toContain('secret prompt text');
  });

  it('adds --model when a non-default model is selected', () => {
    expect(crushAgentDef.buildArgs('hi', [], [], { model: 'anthropic/claude-sonnet-5' })).toEqual([
      'run',
      '--quiet',
      '--yolo',
      '--model',
      'anthropic/claude-sonnet-5',
    ]);
  });

  it('omits --model for the literal "default"', () => {
    expect(crushAgentDef.buildArgs('hi', [], [], { model: 'default' })).toEqual(['run', '--quiet', '--yolo']);
  });

  it('omits --yolo when permissionMode is "restricted"', () => {
    expect(crushAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted', model: 'm' })).toEqual([
      'run',
      '--quiet',
      '--model',
      'm',
    ]);
  });
});

describe('crushAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(crushAgentDef.id).toBe('crush');
    expect(crushAgentDef.bin).toBe('crush');
    expect(crushAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(crushAgentDef.promptViaStdin).toBe(true);
    expect(crushAgentDef.streamFormat).toBe('plain');
  });

  it('is registered in the built-in catalog', () => {
    expect(getAgentDef('crush')).toBe(crushAgentDef);
  });
});
