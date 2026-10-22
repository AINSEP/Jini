import { describe, expect, it } from 'vitest';
import { getAgentDef } from '../../registry.js';
import { droidAgentDef } from '../droid.js';
import { DEFAULT_MODEL_OPTION } from '../shared.js';

const BASE = ['exec', '--output-format', 'text'];

describe('droidAgentDef.buildArgs', () => {
  it('builds `exec --output-format text --skip-permissions-unsafe` with no model selected', () => {
    expect(droidAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).toEqual([...BASE, '--skip-permissions-unsafe']);
  });

  it('defaults options to {} when omitted entirely', () => {
    expect(droidAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [] })).toEqual([...BASE, '--skip-permissions-unsafe']);
  });

  it('never puts the prompt in argv (it goes over stdin)', () => {
    expect(droidAgentDef.buildArgs({ prompt: 'secret prompt text', imagePaths: [] }, { extraAllowedDirs: [], options: {} })).not.toContain('secret prompt text');
  });

  it('adds --model when a non-default model is selected', () => {
    expect(droidAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'gpt-5-codex' } })).toEqual([
      ...BASE,
      '--skip-permissions-unsafe',
      '--model',
      'gpt-5-codex',
    ]);
  });

  it('omits --model for the literal "default"', () => {
    expect(droidAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'default' } })).toEqual([...BASE, '--skip-permissions-unsafe']);
  });

  it('keeps droid exec read-only (no skip flag, no --auto) when permissionMode is "restricted"', () => {
    const args = droidAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted' } });
    expect(args).toEqual(BASE);
    expect(args).not.toContain('--auto');
  });
});

describe('droidAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(droidAgentDef.id).toBe('droid');
    expect(droidAgentDef.name).toBe('Factory Droid');
    expect(droidAgentDef.bin).toBe('droid');
    expect(droidAgentDef.fallbackModels).toEqual([DEFAULT_MODEL_OPTION]);
    expect(droidAgentDef.promptViaStdin).toBe(true);
    expect(droidAgentDef.streamFormat).toBe('plain');
  });

  it('is registered in the built-in catalog', () => {
    expect(getAgentDef({ id: 'droid' })).toBe(droidAgentDef);
  });
});
