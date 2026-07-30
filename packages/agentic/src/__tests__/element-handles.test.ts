import { describe, expect, it } from 'vitest';

import { AGENT_ELEMENT_ATTRIBUTE, isValidElementHandle, resolveHandleSelector } from '../index.js';

describe('element handles', () => {
  it('accepts the handles the sample markup publishes', () => {
    for (const handle of ['task-water-plants', 'new-task-input', 'add-task-button', 'board']) {
      expect(isValidElementHandle(handle)).toBe(true);
      expect(resolveHandleSelector(handle)).toBe(`[${AGENT_ELEMENT_ATTRIBUTE}="${handle}"]`);
    }
  });

  it('refuses anything that could escape the attribute selector', () => {
    const hostile = [
      'a"],script',          // closes the attribute and appends a second selector
      "a']",
      'a\\',
      'a b',
      'a>b',
      'a:hover',
      '*',
      '',
      '-leading',
      'trailing-',
      'double--hyphen',
      'UPPER',
      'a'.repeat(129),
    ];
    for (const handle of hostile) {
      expect(isValidElementHandle(handle)).toBe(false);
      expect(() => resolveHandleSelector(handle)).toThrow(/invalid element handle/);
    }
  });
});
