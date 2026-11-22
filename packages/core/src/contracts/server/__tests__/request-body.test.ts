import { describe, expect, it } from 'vitest';
import { readBodyBytes, readJsonBody } from '../request-body.js';


function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://local/x', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}


describe('readJsonBody / readBodyBytes', () => {
  it('parses an object, and gives {} for no body, empty body and non-JSON content types (express.json parity)', async () => {
    expect(await readJsonBody({ request: jsonRequest('{"via":"x"}') })).toEqual({ ok: true, value: { via: 'x' } });
    expect(await readJsonBody({ request: jsonRequest('  ') })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody({ request: new Request('http://l/', { method: 'POST', body: 'a=1', headers: { 'content-type': 'text/plain' } }) })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody({ request: new Request('http://l/') })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody({ request: jsonRequest('[1]', { 'content-type': 'application/vnd.x+json' }) })).toEqual({ ok: true, value: [1] });
  });

  it('refuses invalid JSON and bare primitives with a 400 in plain words', async () => {
    for (const body of ['{bad', '"str"', '42']) {
      const result = await readJsonBody({ request: jsonRequest(body) });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ code: 'BAD_REQUEST', message: 'The request body is not valid JSON. Send a JSON object or array.' });
    }
  });

  it('refuses a body over maxBytes by declared length and by streamed length', async () => {
    const declared = await readJsonBody({ request: jsonRequest('{"a":1}', { 'content-length': '999' }) }, { maxBytes: 10 });
    expect(!declared.ok && declared.error.code).toBe('PAYLOAD_TOO_LARGE');
    const streamed = await readBodyBytes({ request: new Request('http://l/', { method: 'POST', body: 'x'.repeat(11) }) }, { maxBytes: 10 });
    expect(!streamed.ok && streamed.error.message).toBe('The request body is larger than the 10 bytes this address accepts. Send less data.');
    const exact = await readBodyBytes({ request: new Request('http://l/', { method: 'POST', body: 'x'.repeat(10) }) }, { maxBytes: 10 });
    expect(exact.ok && exact.value.byteLength).toBe(10);
  });
});


describe('content-encoding and exact limits', () => {
  it('refuses a compressed body with 415, whatever the case', async () => {
    for (const encoding of ['gzip', 'GZIP', 'br']) {
      const result = await readJsonBody({ request: jsonRequest('{}', { 'content-encoding': encoding }) });
      expect(result.ok ? undefined : result.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });
  it('refuses a compressed or oversized body whatever its content type', async () => {
    const text = (body: string, headers: Record<string, string> = {}) =>
      new Request('http://local/x', { method: 'POST', body, headers: { 'content-type': 'text/plain', ...headers } });
    const compressed = await readJsonBody({ request: text('{}', { 'content-encoding': 'gzip' }) });
    expect(compressed.ok ? undefined : compressed.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const streamed = await readJsonBody({ request: text('x'.repeat(8)) }, { maxBytes: 7 });
    expect(streamed.ok ? undefined : streamed.error.code).toBe('PAYLOAD_TOO_LARGE');
    const declared = await readJsonBody({ request: text('x', { 'content-length': '8' }) }, { maxBytes: 7 });
    expect(declared.ok ? undefined : declared.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await readJsonBody({ request: text('x'.repeat(7)) }, { maxBytes: 7 })).toEqual({ ok: true, value: {} });
  });
  it('reads an identity-encoded body', async () => {
    const result = await readJsonBody({ request: jsonRequest('{"a":1}', { 'content-encoding': 'identity' }) });
    expect(result.ok ? result.value : undefined).toEqual({ a: 1 });
  });
  it('accepts a body at maxBytes and refuses one byte more with 413', async () => {
    const at = await readBodyBytes({ request: jsonRequest('{"a":1}') }, { maxBytes: 7 });
    expect(at.ok).toBe(true);
    const over = await readBodyBytes({ request: jsonRequest('{"a":12}') }, { maxBytes: 7 });
    expect(over.ok ? undefined : over.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
