import { describe, expect, it } from 'vitest';
import { CREATOR_KINDS, isPausedByAgentSwitch, resolveCreatorKind } from '../index.js';

describe('creator kind', () => {
  it('reads a missing or unknown stored value as person, so owner-made records are never paused', () => {
    expect(resolveCreatorKind({ value: undefined })).toBe('person');
    expect(resolveCreatorKind({ value: null })).toBe('person');
    expect(resolveCreatorKind({ value: 'robot' })).toBe('person');
    expect(resolveCreatorKind({ value: 'person' })).toBe('person');
    expect(resolveCreatorKind({ value: 'agent' })).toBe('agent');
    expect(CREATOR_KINDS).toEqual(['person', 'agent']);
  });

  it('pauses only agent-created records, and only while the agent is off', () => {
    expect(isPausedByAgentSwitch({ creatorKind: 'agent', agentEnabled: false })).toBe(true);
    expect(isPausedByAgentSwitch({ creatorKind: 'agent', agentEnabled: true })).toBe(false);
    expect(isPausedByAgentSwitch({ creatorKind: 'person', agentEnabled: false })).toBe(false);
    expect(isPausedByAgentSwitch({ creatorKind: undefined, agentEnabled: false })).toBe(false);
  });
});
