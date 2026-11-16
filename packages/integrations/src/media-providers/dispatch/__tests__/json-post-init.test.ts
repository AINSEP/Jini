import { describe, expect, it } from 'vitest';
import { jsonPostInit } from '../openai-compatible.js';

describe('jsonPostInit', () => {
  it('builds a JSON POST with no authorization header when called without options', () => {
    expect(jsonPostInit({ ctx: {}, body: { a: 1 } })).toEqual({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  });

  it('adds bearer auth, lets explicit headers override the content type, and keeps the caller request init underneath', () => {
    const dispatcher = { tag: 'd' };
    const init = jsonPostInit({ ctx: { requestInit: { dispatcher, method: 'GET' } as RequestInit }, body: [1] }, { apiKey: 'k-1', headers: { 'content-type': 'application/x-custom', 'x-extra': 'y' } });
    expect(init).toEqual({
      dispatcher, method: 'POST', body: '[1]',
      headers: { authorization: 'Bearer k-1', 'content-type': 'application/x-custom', 'x-extra': 'y' },
    });
  });
});
