import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { localOriginFromHeader, validateLocalDaemonRequest } from '../local-daemon-request.js';

describe('local origin characterization before complexity refactor', () => {
  it.each([
    undefined, null, 42, {}, '', '   ', 'null', 'http://localhost,http://localhost',
    '::::', 'ftp://localhost', 'ws://localhost',
    'http://localhost/path', 'http://localhost/?query=1', 'http://localhost/#fragment',
    'http://user@localhost', 'http://:password@localhost', 'http://user:password@localhost',
    'http://example.com', 'http://localhost.evil.example', 'http://[::ffff:127.0.0.1]',
  ])('rejects invalid or non-loopback origin %j', (value) => {
    expect(localOriginFromHeader({ value })).toBeNull();
  });

  it.each([
    ['  HTTP://LOCALHOST:80  ', 'http://localhost'],
    ['https://localhost:443/', 'https://localhost'],
    ['https://localhost:4173', 'https://localhost:4173'],
    ['http://127.5.6.7:4173/', 'http://127.5.6.7:4173'],
    ['http://[0:0:0:0:0:0:0:1]:4173/', 'http://[::1]:4173'],
  ])('returns the canonical loopback origin for %s', (value, expected) => {
    expect(localOriginFromHeader({ value })).toBe(expected);
  });

  it.each(['http://localhost?', 'http://localhost#'])('accepts empty URL delimiters in %s (reported, not fixed)', (value) => {
    expect(localOriginFromHeader({ value })).toBe('http://localhost');
  });
});

function request({ peer = '127.0.0.1', host = 'localhost:4173' }: {
  readonly peer?: string;
  readonly host?: string;
}, { origin }: { readonly origin?: string | undefined } = {}) {
  const headers: Record<string, string | undefined> = { host, origin };
  const get = vi.fn((name: string) => headers[name]);
  const req = { socket: { remoteAddress: peer }, get } as unknown as Request;
  return { req, get };
}

describe('local request validation characterization before removing repeated origin parsing', () => {
  it.each([
    [undefined, null],
    ['https://LOCALHOST:443/', 'https://localhost'],
  ] as const)('accepts origin %j and returns its canonical value', (origin, expected) => {
    const f = request({}, { origin });
    expect(validateLocalDaemonRequest({ req: f.req })).toEqual({ ok: true, origin: expected });
    expect(f.get.mock.calls).toEqual([['host'], ['origin']]);
  });

  it.each(['', 'null', '::::', 'http://example.com', 'http://localhost/private'])('rejects a present invalid origin %s', (origin) => {
    const f = request({}, { origin });
    expect(validateLocalDaemonRequest({ req: f.req })).toEqual({
      ok: false, message: 'request origin must be a loopback daemon origin', details: { header: 'origin' },
    });
    expect(f.get.mock.calls).toEqual([['host'], ['origin']]);
  });

  it('rejects a remote peer before reading any headers', () => {
    const f = request({ peer: '10.0.0.1' }, { origin: 'http://example.com' });
    expect(validateLocalDaemonRequest({ req: f.req })).toEqual({
      ok: false, message: 'request peer must be a loopback address', details: { peer: 'remoteAddress' },
    });
    expect(f.get).not.toHaveBeenCalled();
  });

  it.each(['::::', 'example.com'])('rejects invalid or non-loopback Host %s before reading Origin', (host) => {
    const f = request({ host }, { origin: 'http://localhost' });
    expect(validateLocalDaemonRequest({ req: f.req })).toEqual({
      ok: false, message: 'request host must be a loopback daemon address', details: { header: 'host' },
    });
    expect(f.get.mock.calls).toEqual([['host']]);
  });
});
