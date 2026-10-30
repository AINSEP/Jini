import { describe, expect, it } from 'vitest';
import { captureLineTail } from '../index.js';

const SAMPLES = ['', ' ', '  ', 'a', ' a', '   a b  ', '\ta', ' \n', '\n ', ' \nx', 'x\ny', ' \u2028', '\u2028 ', ' \u00a0', 'a\r'];

describe('captureLineTail', () => {
  it.each(SAMPLES)('matches \\s*(.+)$ on %j', rest => {
    expect(captureLineTail({ rest })).toBe(/^\s*(.+)$/.exec(rest)?.[1] ?? null);
  });

  it.each(SAMPLES)('matches \\s+(.+)$ on %j', rest => {
    expect(captureLineTail({ rest }, { minWhitespace: 1 })).toBe(/^\s+(.+)$/.exec(rest)?.[1] ?? null);
  });

  it('stays fast on a long whitespace run', () => {
    const rest = `${' '.repeat(200_000)}\n`;
    expect(captureLineTail({ rest })).toBeNull();
  });
});
