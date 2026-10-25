import { describe, expect, it } from 'vitest';
import { decodeRunContextRef, encodeRunContextRef } from '../run-context.js';

/** `toEqual` ignores `undefined`-valued keys; these pin that absent fields stay ABSENT (no `prompt: undefined`). */
describe('decodeRunContextRef omits absent fields', () => {
  it('history-only payload has no prompt key', () => {
    const decoded = decodeRunContextRef({ contextRef: encodeRunContextRef({ payload: { history: ["a"] } }) });
    expect(decoded).toStrictEqual({ history: ['a'] });
    expect(Object.keys(decoded ?? {})).toEqual(['history']);
  });
  it('prompt-only payload has no history key', () => {
    const decoded = decodeRunContextRef({ contextRef: encodeRunContextRef({ payload: { prompt: "p" } }) });
    expect(Object.keys(decoded ?? {})).toEqual(['prompt']);
  });
});
