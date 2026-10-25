import { describe, expect, it } from 'vitest';
import { delegatedResultMarker, readDelegatedResult } from '../delegated-result.js';

/** One clause broken per case (TEST-ANTIPATTERNS AP3/AP8/AP9): every guard in the parser gets its own refusal. */
describe('readDelegatedResult hostile inputs', () => {
  const text = (value: string) => ({ type: 'text', text: value });
  const wire = (marker: unknown) => text(JSON.stringify({ jiniDelegatedResult: marker }));
  const padTo = (length: number, json: string) => text(json + ' '.repeat(length - json.length));
  const valid = JSON.stringify({ jiniDelegatedResult: { version: 1, toolUseId: 'B' } });
  const tail = { type: 'image', data: 'X' };

  it.each([
    ['null block', null],
    ['array block', [valid]],
    ['string block', valid],
    ['non-text type carrying valid json', { type: 'image', text: valid }],
    ['non-string text', { type: 'text', text: 7 }],
    ['text over 1024 chars', padTo(1025, valid)],
    ['top-level array json', text(JSON.stringify([{ jiniDelegatedResult: { version: 1, toolUseId: 'B' } }]))],
    ['top-level null json', text('null')],
    ['extra top-level key', text(JSON.stringify({ jiniDelegatedResult: { version: 1, toolUseId: 'B' }, x: 1 }))],
    ['marker is null', wire(null)],
    ['marker is array', wire(['1', 'B'])],
    ['marker missing version', wire({ toolUseId: 'B', other: 1 })],
    ['marker version as string', wire({ version: '1', toolUseId: 'B' })],
    ['marker with one key', wire({ version: 1 })],
    ['array toolUseId', wire({ version: 1, toolUseId: ['B'] })],
    ['numeric toolUseId', wire({ version: 1, toolUseId: 5 })],
    ['toolUseId over 256 chars', wire({ version: 1, toolUseId: 'x'.repeat(257) })],
  ])('refuses %s', (_label, first) => {
    expect(readDelegatedResult({ content: [first, tail] })).toBeUndefined();
  });

  it('accepts the boundary sizes: 1024-char text and 256-char toolUseId', () => {
    expect(readDelegatedResult({ content: [padTo(1024, valid), tail] })).toEqual({ marker: { version: 1, toolUseId: 'B' }, content: [tail] });
    const longId = 'y'.repeat(256);
    expect(readDelegatedResult({ content: [wire({ version: 1, toolUseId: longId })] })).toEqual({ marker: { version: 1, toolUseId: longId }, content: [] });
  });

  it('only a LEADING marker counts, and any later marker anywhere makes it ambiguous', () => {
    const marker = delegatedResultMarker({ toolUseId: 'B' });
    expect(readDelegatedResult({ content: [tail, marker] })).toBeUndefined();
    expect(readDelegatedResult({ content: [marker, tail, text('note'), delegatedResultMarker({ toolUseId: 'C' })] })).toBeUndefined();
    expect(readDelegatedResult({ content: [marker, text('note'), tail, text('{"jiniDelegatedResult":1}')] })).toEqual({ marker: { version: 1, toolUseId: 'B' }, content: [text('note'), tail, text('{"jiniDelegatedResult":1}')] });
  });

  it.each([undefined, null, {}, 'x', 0])('refuses non-array content %j', (content) => {
    expect(readDelegatedResult({ content })).toBeUndefined();
  });
});
