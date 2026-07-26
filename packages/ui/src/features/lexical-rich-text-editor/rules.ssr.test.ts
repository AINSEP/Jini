// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readCaretRect } from './rules.js';

describe('readCaretRect (no DOM globals)', () => {
  it('returns null when window is genuinely undefined', () => {
    expect(typeof window).toBe('undefined');
    expect(readCaretRect(null)).toBeNull();
  });
});
