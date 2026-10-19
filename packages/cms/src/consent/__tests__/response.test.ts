import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockConsentResponse, captureConsentHtml } from '../express/response.js';

function fakeResponse(type?: string) {
  const headers = new Map<string, unknown>();
  const calls: unknown[][] = [];
  const response = {
    statusCode: 200, statusMessage: '', destroyed: false,
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    setHeader: (name: string, value: unknown) => { headers.set(name.toLowerCase(), value); return response; },
    removeHeader: (name: string) => { headers.delete(name.toLowerCase()); },
    write(...args: unknown[]) { calls.push(['write', ...args]); return true; },
    end(...args: unknown[]) { calls.push(['end', ...args]); return response; },
    writeHead(...args: unknown[]) { calls.push(['writeHead', ...args]); return response; },
    flushHeaders() { calls.push(['flushHeaders']); },
  };
  if (type) headers.set('content-type', type);
  return { response: response as unknown as Response & { destroyed: boolean }, headers, calls };
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const upper = async ({ body }: { body: Buffer }) => Buffer.from(body.toString('utf8').toUpperCase());

afterEach(() => { vi.restoreAllMocks(); });

describe('blockConsentResponse', () => {
  it('appends to an existing policy string or list', () => {
    const single = fakeResponse();
    single.headers.set('content-security-policy', "img-src 'none'");
    blockConsentResponse({ response: single.response });
    expect(single.headers.get('content-security-policy')).toEqual(["img-src 'none'", expect.stringContaining("script-src 'none'")]);
    const list = fakeResponse();
    list.headers.set('content-security-policy', ['a', 'b']);
    blockConsentResponse({ response: list.response });
    expect(list.headers.get('content-security-policy')).toEqual(['a', 'b', expect.stringContaining("script-src 'none'")]);
  });
});

describe('captureConsentHtml', () => {
  it('writeHead records status, reason and object/array headers without flushing', () => {
    const { response, headers, calls } = fakeResponse('text/html');
    captureConsentHtml({ response, transform: upper });
    expect(response.writeHead(201, 'Made', { 'x-a': '1', 'x-skip': undefined })).toBe(response);
    expect(response.statusCode).toBe(201); expect(response.statusMessage).toBe('Made');
    expect(headers.get('x-a')).toBe('1'); expect(headers.has('x-skip')).toBe(false);
    response.writeHead(202, ['x-b', '2', 'x-c', '3']);
    expect(headers.get('x-b')).toBe('2'); expect(headers.get('x-c')).toBe('3');
    response.writeHead(203);
    response.writeHead(204, 'Reason only');
    expect(response.statusCode).toBe(204); expect(response.statusMessage).toBe('Reason only');
    expect(calls).toEqual([]);
  });
  it('flushHeaders waits for HTML but passes through for other types', () => {
    const html = fakeResponse('text/html');
    captureConsentHtml({ response: html.response, transform: upper });
    html.response.flushHeaders();
    expect(html.calls).toEqual([]);
    const json = fakeResponse('application/json');
    captureConsentHtml({ response: json.response, transform: upper });
    json.response.flushHeaders();
    expect(json.calls).toEqual([['flushHeaders']]);
  });
  it('non-HTML writes and ends use the native methods', () => {
    const { response, calls } = fakeResponse('application/json');
    captureConsentHtml({ response, transform: upper });
    expect(response.write('{', 'utf8')).toBe(true);
    response.end('}');
    expect(calls).toEqual([['write', '{', 'utf8', undefined], ['end', '}']]);
    const late = fakeResponse('application/json');
    captureConsentHtml({ response: late.response, transform: upper });
    late.response.end('{}');
    expect(late.calls).toEqual([['end', '{}', undefined, undefined]]);
  });
  it('buffers string, Uint8Array and encoded chunks, acknowledging write callbacks', async () => {
    const { response, calls } = fakeResponse('text/html');
    captureConsentHtml({ response, transform: upper });
    const acks: string[] = [];
    response.write('<p>', () => acks.push('encoding-slot'));
    response.write(new Uint8Array(Buffer.from('a')), 'utf8', () => acks.push('callback-slot'));
    response.write('62', 'hex');
    response.write(Buffer.from('c'));
    response.end('</p>');
    await settle();
    expect(acks).toEqual(['encoding-slot', 'callback-slot']);
    expect(calls).toEqual([['end', Buffer.from('<P>ABC</P>'), undefined]]);
  });
  it('end accepts Uint8Array/encoded chunks and a callback in any slot', async () => {
    for (const [args, body] of [[[new Uint8Array(Buffer.from('<i>'))], '<I>'], [['3c623e', 'hex'], '<B>'], [[null], '']] as const) {
      const { response, calls } = fakeResponse('text/html');
      captureConsentHtml({ response, transform: upper });
      response.end(...(args as unknown as [string]));
      await settle();
      expect(calls).toEqual([['end', Buffer.from(body), undefined]]);
    }
    const done = () => undefined;
    for (const args of [[done], ['<u>', done], ['<u>', 'utf8', done]]) {
      const { response, calls } = fakeResponse('text/html');
      captureConsentHtml({ response, transform: upper });
      response.end(...(args as unknown as [string]));
      await settle();
      expect(calls[0]?.[2]).toBe(done);
    }
  });
  it('a headerless body is HTML only when it starts with a tag', async () => {
    for (const [text, expected] of [['  <p>x', '  <P>X'], ['plain text', 'plain text']] as const) {
      const { response, calls } = fakeResponse();
      captureConsentHtml({ response, transform: upper });
      response.end(text);
      await settle();
      expect(calls).toEqual([['end', Buffer.from(expected), undefined]]);
    }
  });
  it('a destroyed response is neither blocked nor completed; a failed transform reports and serves the original', async () => {
    const destroyed = fakeResponse('text/html');
    const reported: unknown[] = [];
    captureConsentHtml({ response: destroyed.response, transform: async () => { throw new Error('boom'); } }, { reportError: ({ error }) => reported.push(error) });
    destroyed.response.destroyed = true;
    destroyed.response.end('<p>');
    await settle();
    expect(destroyed.calls).toEqual([]); expect(destroyed.headers.has('content-security-policy')).toBe(false); expect(reported).toHaveLength(1);
    const live = fakeResponse('text/html');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    captureConsentHtml({ response: live.response, transform: async () => { throw new Error('boom'); } });
    live.response.end('<p>');
    await settle();
    expect(live.calls).toEqual([['end', Buffer.from('<p>'), undefined]]); expect(live.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(error).toHaveBeenCalledWith('Consent HTML transform failed; optional content is blocked.');
  });
});
