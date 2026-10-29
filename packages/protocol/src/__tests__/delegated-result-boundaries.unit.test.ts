import { expect, it } from 'vitest';
import { delegatedResultMarker, readDelegatedResult } from '../delegated-result.js';

const text = (value: unknown) => ({ type: 'text', text: JSON.stringify(value) });

it.each([
  null, [], { type: 'image', text: '{}' }, { type: 'text', text: 1 },
  { type: 'text', text: ' '.repeat(1025) }, text(null), text([]), text({}),
  text({ jiniDelegatedResult: null }), text({ jiniDelegatedResult: [] }),
  text({ jiniDelegatedResult: { version: 1, toolUseId: 'call' }, extra: true }),
  text({ jiniDelegatedResult: { version: 1, toolUseId: 7 } }),
  text({ jiniDelegatedResult: { version: 1, toolUseId: 'x'.repeat(257) } }),
].map(block => ({ block })))('rejects an invalid leading marker: $block', ({ block }) => {
  expect(readDelegatedResult({ content: [block, { type: 'text', text: 'ordinary result' }] })).toBeUndefined();
});

it('accepts the maximum marker id, preserving malformed ordinary trailing blocks', () => {
  const toolUseId = 'x'.repeat(256);
  const tail = [null, text({ jiniDelegatedResult: { version: 2, toolUseId: 'future' } }), { type: 'text', text: '{' }];
  expect(readDelegatedResult({ content: [delegatedResultMarker({ toolUseId }), ...tail] }))
    .toEqual({ marker: { version: 1, toolUseId }, content: tail });
});
