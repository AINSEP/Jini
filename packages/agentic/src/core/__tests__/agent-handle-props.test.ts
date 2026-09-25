import { describe, expect, it } from 'vitest';

import { AGENT_ELEMENT_ATTRIBUTE, AGENT_LABEL_ATTRIBUTE, AGENT_ROLE_ATTRIBUTE, agentHandleProps, agentSubHandle } from '../index.js';

describe('agentSubHandle', () => {
  it('joins base and action with a single hyphen', () => {
    expect(agentSubHandle('mcp-add', 'submit')).toBe('mcp-add-submit');
  });
});

describe('agentHandleProps', () => {
  it('returns an empty object when base is undefined — the opt-in, additive default', () => {
    expect(agentHandleProps(undefined, { role: 'button', label: 'Save' })).toEqual({});
  });

  it('publishes the base handle itself when no action is given', () => {
    expect(agentHandleProps('settings-execution', { role: 'region', label: 'Execution mode' })).toEqual({
      [AGENT_ELEMENT_ATTRIBUTE]: 'settings-execution',
      [AGENT_ROLE_ATTRIBUTE]: 'region',
      [AGENT_LABEL_ATTRIBUTE]: 'Execution mode',
    });
  });

  it('derives <base>-<action> when an action is given', () => {
    expect(agentHandleProps('settings-execution', { action: 'mode-byok', role: 'button', label: 'BYOK' })).toEqual({
      [AGENT_ELEMENT_ATTRIBUTE]: 'settings-execution-mode-byok',
      [AGENT_ROLE_ATTRIBUTE]: 'button',
      [AGENT_LABEL_ATTRIBUTE]: 'BYOK',
    });
  });

  it('still throws on an invalid base, rather than silently swallowing it', () => {
    expect(() => agentHandleProps('Not Valid', { role: 'button', label: 'x' })).toThrow(/invalid element handle/);
  });
});
