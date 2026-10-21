import { describe, expect, it } from 'vitest';
import { CUSTOM_PRESET_ID } from '../constants.js';
import { customPreset, modelIdForReasoningLevel, presetsForProtocol, reasoningModelGroups } from '../rules.js';
import type { AgentModelOption } from '../types.js';

const LEVELS: readonly AgentModelOption[] = [
  { id: 'high', label: 'High' },
  { id: 'low', label: 'Low effort' },
];

describe('reasoningModelGroups base label', () => {
  it('keeps a suffixed model label that carries no trailing parenthetical', () => {
    const [group] = reasoningModelGroups([{ id: 'base-high', label: 'Base Model' }], LEVELS);
    expect(group).toMatchObject({ baseId: 'base', label: 'Base Model' });
  });

  it('keeps a trailing parenthetical that names neither the level id nor its label', () => {
    const [group] = reasoningModelGroups([{ id: 'base-high', label: 'Base Model (Preview)' }], LEVELS);
    expect(group?.label).toBe('Base Model (Preview)');
  });

  it('strips a qualifier that matches the level label rather than its id, ignoring case and padding', () => {
    const [group] = reasoningModelGroups([{ id: 'base-low', label: 'Base Model  ( LOW EFFORT )  ' }], LEVELS);
    expect(group?.label).toBe('Base Model');
  });

  it('keeps the whole label when stripping the qualifier would leave nothing', () => {
    const [group] = reasoningModelGroups([{ id: 'base-high', label: '(High)' }], LEVELS);
    expect(group?.label).toBe('(High)');
  });
});

describe('modelIdForReasoningLevel over a hand-built group', () => {
  it('falls back to the base id when the first listed level has no catalog id', () => {
    const group = { baseId: 'base', label: 'Base', levels: [{ id: 'high', label: 'High' }], modelIdByLevel: {} };
    expect(modelIdForReasoningLevel(group, null)).toBe('base');
    expect(modelIdForReasoningLevel(group, 'high')).toBe('base');
  });

  it('returns the bare base id for a group built from nothing', () => {
    expect(modelIdForReasoningLevel({ baseId: 'empty', label: 'Empty', levels: [], modelIdByLevel: {} }, 'high')).toBe('empty');
  });
});

describe('customPreset', () => {
  it('builds the manual-entry preset for the given protocol with an empty endpoint', () => {
    expect(customPreset('anthropic')).toEqual({
      id: CUSTOM_PRESET_ID, title: 'Custom', protocol: 'anthropic', baseUrl: '', preferredModels: [], custom: true,
    });
    expect(customPreset('openai', 'Eigener Anbieter').title).toBe('Eigener Anbieter');
  });

  it('is never listed among the presets for its protocol', () => {
    expect(presetsForProtocol([customPreset('openai')], 'openai')).toEqual([]);
  });
});
