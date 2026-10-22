import { describe, expect, it, vi } from 'vitest';
import { createHttpTransport, type AdminFetch } from '../transport/http.js';

describe('HTTP header merging', () => {
  const callForms: Array<[string, () => HeadersInit]> = [
    ['Headers', () => new Headers({ 'content-type': 'text/plain', authorization: 'Bearer call', 'X-Trace': 'call' })],
    ['tuples', () => [['content-type', 'text/plain'], ['authorization', 'Bearer call'], ['X-Trace', 'call']]],
    ['record', () => ({ 'content-type': 'text/plain', authorization: 'Bearer call', 'X-Trace': 'call' })],
  ];

  it.each(callForms)('merges %s over base headers case-insensitively without mutating inputs', async (_name, createHeaders) => {
    const baseHeaders = { 'Content-Type': 'application/xml', Authorization: 'Bearer base', 'X-Base': 'base' };
    const headers = createHeaders();
    const before = Array.from(new Headers(headers).entries());
    const fetch = vi.fn<AdminFetch>(async () => new Response('{}'));
    await createHttpTransport({ baseUrl: '/fixture', fetch }, { headers: baseHeaders })
      .request({ path: '/records' }, { headers });
    expect(fetch).toHaveBeenCalledOnce();
    const sent = new Headers(fetch.mock.calls[0]![1]!.headers);
    expect(Array.from(sent.entries())).toEqual([
      ['authorization', 'Bearer call'], ['content-type', 'text/plain'], ['x-base', 'base'], ['x-trace', 'call'],
    ]);
    expect(Array.from(new Headers(headers).entries())).toEqual(before);
    expect(baseHeaders).toEqual({ 'Content-Type': 'application/xml', Authorization: 'Bearer base', 'X-Base': 'base' });
  });

  it('retains JSON and transport headers when a tuple call adds an unrelated header', async () => {
    const fetch = vi.fn<AdminFetch>(async () => new Response('{}'));
    await createHttpTransport({ baseUrl: '', fetch }, { headers: { Authorization: 'Bearer base' } })
      .request({ path: '/records' }, { headers: [['If-Match', 'revision-2']] });
    const sent = new Headers(fetch.mock.calls[0]![1]!.headers);
    expect(Array.from(sent.entries())).toEqual([
      ['authorization', 'Bearer base'], ['content-type', 'application/json'], ['if-match', 'revision-2'],
    ]);
  });
});
