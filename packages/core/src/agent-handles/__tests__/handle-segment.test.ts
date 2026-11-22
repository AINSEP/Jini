import { expect, it } from 'vitest';
import { agentHandle, agentHandleSegment, isValidElementHandle } from '../index.js';

it('preserves short valid ids and fingerprints exact opaque ids without selector punctuation', () => {
  const cases = [
    ['row-1', 'row-1'],
    ['vault:["publish_credential_sets","e6b6ec84-1234-4567-89ab-0123456789ab"]:0', 'h-c776c79ac3a9600f'],
    ['a:b', 'h-e661911904a01160'],
    ['a[b]', 'h-35c113837df063f8'],
    ['a"b', 'h-e646a119048964d8'],
    ['', 'h-cbf29ce484222325'],
    ['h-cbf29ce484222325', 'h-534ca2bf772519b8'],
    ['é😀', 'h-d7bced195d50c881'],
    ['row' + 'x'.repeat(200), 'h-977e892e0fec647b'],
  ] as const;
  for (const [value, expected] of cases) {
    expect(agentHandleSegment({ value })).toBe(expected);
    expect(isValidElementHandle({ handle: expected })).toBe(true);
    expect(agentHandle({ handle: `security-access-tokens-row-publish-github-pages-${expected}` })).toEqual({
      'data-agent-element': `security-access-tokens-row-publish-github-pages-${expected}`,
    });
  }
  expect(new Set(cases.map(([value]) => agentHandleSegment({ value }))).size).toBe(cases.length);
});

it('bounds independently rendered segments and keeps the same id stable across reordered lists', () => {
  const ids = ['a:b', 'a[b]', 'a"b'];
  expect([...ids].reverse().map(value => agentHandleSegment({ value })).reverse()).toEqual([
    'h-e661911904a01160', 'h-35c113837df063f8', 'h-e646a119048964d8',
  ]);
  expect(agentHandleSegment({ value: 'a'.repeat(40) })).toBe('a'.repeat(40));
  expect(agentHandleSegment({ value: 'a'.repeat(41) })).toHaveLength(18);
});
