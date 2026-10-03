import { describe, expect, it } from 'vitest';
import { formatToolOutputForDisplay } from '../index.js';

/**
 * Tool results travel to the model as compact JSON (`@jini-ai/mcp`'s `okResult`); a person reading
 * one in a tool card gets it re-indented at render time instead.
 */
describe('formatToolOutputForDisplay', () => {
  it('re-indents a compact JSON object or array with two spaces', () => {
    expect(formatToolOutputForDisplay({ text: '{"a":1,"b":{"c":[1,2]}}' })).toBe(JSON.stringify({ a: 1, b: { c: [1, 2] } }, null, 2));
    expect(formatToolOutputForDisplay({ text: ' [1,{"x":"y"}]\n' })).toBe(JSON.stringify([1, { x: 'y' }], null, 2));
  });

  it('returns anything that is not a JSON object or array unchanged', () => {
    for (const text of ['a.txt\nb.txt', 'ok', '42', '"quoted"', 'true', '{not json', '[1,2', '']) {
      expect(formatToolOutputForDisplay({ text: text })).toBe(text);
    }
  });
});
