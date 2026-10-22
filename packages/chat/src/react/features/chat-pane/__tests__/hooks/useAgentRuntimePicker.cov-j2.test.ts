import { describe, expect, it } from 'vitest';

import { resolvePopoverKeyAction } from '../../hooks/useAgentRuntimePicker.hooks.js';

describe('resolvePopoverKeyAction', () => {
  it('leaves arrow, Home and End keys to a focused native select instead of roving focus', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(resolvePopoverKeyAction({ key, shiftKey: false, isButtonTarget: false, currentIndex: 1, count: 4 })).toBeNull();
    }
  });

  it('roves focus for the same keys when a button has focus', () => {
    expect(resolvePopoverKeyAction({ key: 'ArrowDown', shiftKey: false, isButtonTarget: true, currentIndex: 1, count: 4 })).toBe(2);
    expect(resolvePopoverKeyAction({ key: 'End', shiftKey: false, isButtonTarget: true, currentIndex: 1, count: 4 })).toBe(3);
  });

  it('still wraps Tab from a native select, which never falls through to roving', () => {
    expect(resolvePopoverKeyAction({ key: 'Tab', shiftKey: false, isButtonTarget: false, currentIndex: 3, count: 4 })).toBe(0);
    expect(resolvePopoverKeyAction({ key: 'Tab', shiftKey: true, isButtonTarget: false, currentIndex: 0, count: 4 })).toBe(3);
  });
});
