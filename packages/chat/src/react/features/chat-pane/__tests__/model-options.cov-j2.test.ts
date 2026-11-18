import { describe, expect, it } from 'vitest';
import { configuredPickerModel, pickerModelLabel, pickerModelValue } from '../model-options.js';
import type { ChatPaneAgent } from '../types.js';
import { fakeAgentPolicy } from '../../../__tests__/fake-chat-kit.js';
// The agent runtime's model rules are the host's; these tests exercise chat's own logic over a fake of that port.
const policy = fakeAgentPolicy();

const agent: ChatPaneAgent = { id: 'codex', name: 'Codex', available: true,
  models: [{ id: 'gpt-new', label: 'GPT New', identityKind: 'concrete' }],
  defaultModelResolution: { status: 'resolved', id: 'gpt-new', source: 'config-file', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'scope' } };

describe('picker model choices for agents that cannot pin a concrete model', () => {
  it('preselects nothing when the agent cannot select a concrete model, even with a resolved default', () => {
    const unpinnable: ChatPaneAgent = { ...agent, supportsConcreteModelSelection: false };
    expect(configuredPickerModel({ agent: unpinnable, policy })).toBeUndefined();
    expect(pickerModelValue({ agent: unpinnable, policy })).toBe('');
    expect(pickerModelLabel({ agent: unpinnable, policy })).toBe('Choose model');
  });

  it('labels a requested concrete model the catalog does not list by its raw id', () => {
    expect(pickerModelLabel({ agent: agent, policy }, { requested: 'gpt-unlisted' })).toBe('gpt-unlisted');
    expect(pickerModelValue({ agent: agent, policy }, { requested: 'gpt-unlisted' })).toBe('');
  });
});
