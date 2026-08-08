import { describe, expect, it } from 'vitest';

import {
  AGENT_ELEMENT_ATTRIBUTE,
  AGENT_LABEL_ATTRIBUTE,
  AGENT_PAGE_ATTRIBUTE,
  AGENT_ROLE_ATTRIBUTE,
  agentHandle,
} from '../index.js';

describe('agentHandle', () => {
  it('publishes just the element attribute when given no options', () => {
    expect(agentHandle('save')).toEqual({ [AGENT_ELEMENT_ATTRIBUTE]: 'save' });
  });

  it('adds role, label and page only when supplied', () => {
    expect(agentHandle('add-task-button', { role: 'button' })).toEqual({
      [AGENT_ELEMENT_ATTRIBUTE]: 'add-task-button',
      [AGENT_ROLE_ATTRIBUTE]: 'button',
    });

    expect(agentHandle('new-task-input', { role: 'field', label: 'New task' })).toEqual({
      [AGENT_ELEMENT_ATTRIBUTE]: 'new-task-input',
      [AGENT_ROLE_ATTRIBUTE]: 'field',
      [AGENT_LABEL_ATTRIBUTE]: 'New task',
    });

    expect(agentHandle('board', { page: 'tasks' })).toEqual({
      [AGENT_ELEMENT_ATTRIBUTE]: 'board',
      [AGENT_PAGE_ATTRIBUTE]: 'tasks',
    });
  });

  it('sets all four attributes when every option is supplied', () => {
    expect(
      agentHandle('task-water-plants', { role: 'checkbox', label: 'Water plants', page: 'tasks' }),
    ).toEqual({
      [AGENT_ELEMENT_ATTRIBUTE]: 'task-water-plants',
      [AGENT_ROLE_ATTRIBUTE]: 'checkbox',
      [AGENT_LABEL_ATTRIBUTE]: 'Water plants',
      [AGENT_PAGE_ATTRIBUTE]: 'tasks',
    });
  });

  it('reuses isValidElementHandle rather than a second rule, and refuses the same hostile inputs', () => {
    const hostile = ['a"],script', "a']", 'a\\', 'a b', 'UPPER', '', '-leading', 'a'.repeat(129)];
    for (const handle of hostile) {
      expect(() => agentHandle(handle)).toThrow(/invalid element handle/);
    }
  });

  it('accepts every handle the sample markup publishes', () => {
    for (const handle of ['task-water-plants', 'new-task-input', 'add-task-button', 'board']) {
      expect(() => agentHandle(handle)).not.toThrow();
    }
  });
});
