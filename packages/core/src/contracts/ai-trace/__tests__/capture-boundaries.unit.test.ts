import { expect, it } from 'vitest';
import { captureText, stringifyForCapture } from '../capture.js';

it('preserves ordinary full text and distinguishes absent content from an empty string', () => {
  expect(captureText({ text: null }, { mode: 'full' })).toBeNull();
  expect(captureText({ text: undefined }, { mode: 'full' })).toBeNull();
  expect(captureText({ text: '' }, { mode: 'full' })).toEqual({ chars: 0, text: '' });
  expect(captureText({ text: 'hello' }, { mode: 'full', maxChars: 5 })).toEqual({ chars: 5, text: 'hello' });
});

it('serializes values for capture and falls back to their string representation when JSON fails', () => {
  expect(stringifyForCapture({ value: undefined })).toBeNull();
  expect(stringifyForCapture({ value: null })).toBeNull();
  expect(stringifyForCapture({ value: 'plain' })).toBe('plain');
  expect(stringifyForCapture({ value: { name: 'file', count: 2 } })).toBe('{"name":"file","count":2}');
  expect(stringifyForCapture({ value: 12n })).toBe('12');
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  expect(stringifyForCapture({ value: { cyclic, toString: () => 'unserializable tool result' } }))
    .toBe('unserializable tool result');
});
