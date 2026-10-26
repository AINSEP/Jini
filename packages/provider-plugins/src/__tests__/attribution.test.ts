/** The neutral attribution input every provider plugin reads (`attribution`). */
import { expect, it } from 'vitest';
import { attributionOf } from '../attribution.js';

it('absent attribution is empty; a full one is copied', () => {
  expect(attributionOf(undefined)).toEqual({ attributes: {}, groups: {}, tags: [] });
  expect(attributionOf({})).toEqual({ attributes: {}, groups: {}, tags: [] });
  expect(attributionOf({ attributes: { 'site.id': 's-1' }, groups: { site: 's-1' }, tags: ['site:blog'] }))
    .toEqual({ attributes: { 'site.id': 's-1' }, groups: { site: 's-1' }, tags: ['site:blog'] });
});

it.each([
  [null, 'attribution must be an object'], [[], 'attribution must be an object'], ['x', 'attribution must be an object'],
  [{ attributes: { a: 1 } }, 'attribution.attributes must be an object of strings'], [{ attributes: ['a'] }, 'attribution.attributes must be an object of strings'],
  [{ groups: null }, 'attribution.groups must be an object of strings'], [{ tags: 'a' }, 'attribution.tags must be a list of strings'], [{ tags: [1] }, 'attribution.tags must be a list of strings'],
])('malformed attribution %j is refused', (value, message) => {
  expect(() => attributionOf(value)).toThrow(new TypeError(message));
});
