import { describe, expect, it } from 'vitest';
import { canonicalizeToolInputKeys, normalizeToolInput } from '../tool-input-normalization.js';

/** s5: agreeing aliases must reach the handler; disagreements must still fail closed. */
describe('tool-input alias agreement', () => {
  const schema = { type: 'object', additionalProperties: false, properties: {
    find: { type: 'string', aliases: ['kind'] },
    limit: { type: 'integer', aliases: ['count'] },
  } };
  const registration = { descriptor: { id: 'content_post_preview', inputSchema: schema } };

  it.each([{ find: 'page', kind: 'page' }, { kind: 'page', find: 'page' }])('coalesces agreeing canonical and declared alias names: %j', async input => {
    const copy = { ...input };
    expect((await normalizeToolInput({ input, registration })).input).toEqual({ find: 'page' });
    expect(canonicalizeToolInputKeys({ input, schema }).input).toEqual({ find: 'page' });
    expect(input).toEqual(copy);
  });

  it('compares values after schema coercion, including singleton string arrays', async () => {
    expect((await normalizeToolInput({ input: { limit: 3, count: '3', find: ['page'], kind: 'page' }, registration })).input)
      .toEqual({ limit: 3, find: 'page' });
  });

  it.each([{ find: 'one', kind: 'two' }, { kind: 'two', find: 'one' }])('retains conflict errors without disclosing values: %j', async input => {
    await expect(normalizeToolInput({ input, registration })).rejects.toThrow("Send only 'find'");
    expect(() => canonicalizeToolInputKeys({ input, schema })).toThrow("Send only 'find'");
  });
});
