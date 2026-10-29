import { describe, expect, it } from 'vitest';
import { trimChars, trimCharsEnd, trimCharsStart } from '../index.js';

// Each helper must agree with the regex spelling it replaces, on every shape of input.
const SAMPLES = ['', '/', '///', 'a', '/a', 'a/', '//a//', 'a//b', '/a/b/', 'a/b//c///', '-_-', 'x-_'];

describe('trimChars helpers', () => {
  it.each(SAMPLES)('trimCharsEnd matches /\\/+$/ on %j', text => {
    expect(trimCharsEnd({ text, chars: '/' })).toBe(text.replace(/\/+$/, ''));
  });

  it.each(SAMPLES)('trimCharsStart matches /^\\/+/ on %j', text => {
    expect(trimCharsStart({ text, chars: '/' })).toBe(text.replace(/^\/+/, ''));
  });

  it.each(SAMPLES)('trimChars matches /^\\/+|\\/+$/g on %j', text => {
    expect(trimChars({ text, chars: '/' })).toBe(text.replace(/^\/+|\/+$/g, ''));
  });

  it('treats chars as a set', () => {
    expect(trimChars({ text: '-_a-b_-', chars: '-_' })).toBe('a-b');
    expect(trimCharsEnd({ text: 'name. . ', chars: '. ' })).toBe('name');
  });

  it('stays fast on a long run that does not reach the end', () => {
    const text = `${'/'.repeat(200_000)}x`;
    expect(trimCharsEnd({ text, chars: '/' })).toBe(text);
  });
});
