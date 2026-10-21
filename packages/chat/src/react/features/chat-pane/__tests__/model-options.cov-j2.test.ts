import { describe, expect, it } from 'vitest';
import { configuredPickerModel, pickerModelLabel, pickerModelValue } from '../model-options.js';
import type { ChatPaneAgent } from '../types.js';

const agent: ChatPaneAgent = { id: 'codex', name: 'Codex', available: true,
  models: [{ id: 'gpt-new', label: 'GPT New', identityKind: 'concrete' }],
  defaultModelResolution: { status: 'resolved', id: 'gpt-new', source: 'config-file', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'scope' } };

describe('picker model choices for agents that cannot pin a concrete model', () => {
  it('preselects nothing when the agent cannot select a concrete model, even with a resolved default', () => {
    const unpinnable: ChatPaneAgent = { ...agent, supportsConcreteModelSelection: false };
    expect(configuredPickerModel(unpinnable)).toBeUndefined();
    expect(pickerModelValue(unpinnable)).toBe('');
    expect(pickerModelLabel(unpinnable)).toBe('Choose model');
  });

  it('labels a requested concrete model the catalog does not list by its raw id', () => {
    expect(pickerModelLabel(agent, 'gpt-unlisted')).toBe('gpt-unlisted');
    expect(pickerModelValue(agent, 'gpt-unlisted')).toBe('');
  });
});
