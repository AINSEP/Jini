import { expect, it } from 'vitest';
import { querySuffix } from '../query-suffix.js';

it('adds a question mark before a non-empty query string', () => {
  expect(querySuffix({ query: 'a=1&b=2' })).toBe('?a=1&b=2');
});

it('adds nothing for an empty query string', () => {
  expect(querySuffix({ query: '' })).toBe('');
});
