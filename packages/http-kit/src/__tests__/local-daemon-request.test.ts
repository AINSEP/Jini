import { describe, expect, it, vi } from 'vitest';
import {
  isLoopbackHostname,
  isLoopbackPeerAddress,
  localOriginFromHeader,
  normalizeLocalAuthority,
  requireLocalDaemonRequest,
  validateLocalDaemonRequest,
} from '../local-daemon-request.js';

describe('normalizeLocalAuthority', () => {
  it('parses a bare hostname', () => {
    expect(normalizeLocalAuthority('localhost')).toEqual({ hostname: 'localhost', port: '' });
  });

  it('parses a hostname:port pair', () => {
    expect(normalizeLocalAuthority('127.0.0.1:4173')).toEqual({ hostname: '127.0.0.1', port: '4173' });
  });

  it('lower-cases the hostname and strips a trailing dot', () => {
    expect(normalizeLocalAuthority('LocalHost.')).toEqual({ hostname: 'localhost', port: '' });
  });

  it.each([undefined, null, 42, {}])('returns null for a non-string value (%p)', (value) => {
    expect(normalizeLocalAuthority(value)).toBeNull();
  });

  it('returns null for an empty or whitespace-only string', () => {
    expect(normalizeLocalAuthority('')).toBeNull();
    expect(normalizeLocalAuthority('   ')).toBeNull();
  });

  it('returns null when the value contains whitespace, "@", or a comma', () => {
    expect(normalizeLocalAuthority('a b')).toBeNull();
    expect(normalizeLocalAuthority('user@host')).toBeNull();
    expect(normalizeLocalAuthority('a,b')).toBeNull();
  });

  it('returns null for an unparseable authority', () => {
    expect(normalizeLocalAuthority('::::')).toBeNull();
  });

  it('returns null when the hostname is empty after stripping a lone trailing dot', () => {
    expect(normalizeLocalAuthority('.')).toBeNull();
  });

  it('returns null when the authority carries userinfo', () => {
    expect(normalizeLocalAuthority('user:pass@host')).toBeNull();
  });

  it('returns null when the authority resolves to a non-root path', () => {
    expect(normalizeLocalAuthority('host/path')).toBeNull();
  });
});

describe('isLoopbackHostname', () => {
  it('accepts localhost', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('LOCALHOST')).toBe(true);
  });

  it('accepts IPv6 loopback in bracketed and unbracketed forms', () => {
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('accepts the 127.0.0.0/8 IPv4 range', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('127.5.6.7')).toBe(true);
  });

  it('rejects a non-loopback IPv4 address', () => {
    expect(isLoopbackHostname('8.8.8.8')).toBe(false);
  });

  it('rejects a public hostname', () => {
    expect(isLoopbackHostname('example.com')).toBe(false);
  });

  it('rejects a falsy/empty hostname', () => {
    expect(isLoopbackHostname(undefined)).toBe(false);
    expect(isLoopbackHostname('')).toBe(false);
  });
});

describe('isLoopbackPeerAddress', () => {
  it('accepts a bare IPv4 loopback address', () => {
    expect(isLoopbackPeerAddress('127.0.0.1')).toBe(true);
  });

  it('accepts an IPv4-mapped IPv6 loopback address', () => {
    expect(isLoopbackPeerAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('accepts IPv6 loopback in bracketed and unbracketed forms', () => {
    expect(isLoopbackPeerAddress('::1')).toBe(true);
    expect(isLoopbackPeerAddress('[::1]')).toBe(true);
  });

  it('rejects a non-loopback IPv4 address', () => {
    expect(isLoopbackPeerAddress('10.0.0.5')).toBe(false);
  });

  it('rejects a non-loopback IPv6 address', () => {
    expect(isLoopbackPeerAddress('fe80::1')).toBe(false);
  });

  it('rejects a value that is not an IP address at all', () => {
    expect(isLoopbackPeerAddress('not-an-ip')).toBe(false);
  });

  it('rejects a non-string / empty value', () => {
    expect(isLoopbackPeerAddress(undefined)).toBe(false);
    expect(isLoopbackPeerAddress('')).toBe(false);
  });
});

describe('localOriginFromHeader', () => {
  it('parses a valid loopback origin', () => {
    expect(localOriginFromHeader('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
  });

  it('accepts https', () => {
    expect(localOriginFromHeader('https://localhost:4173')).toBe('https://localhost:4173');
  });

  it('returns null for a non-string / empty / literal "null" value', () => {
    expect(localOriginFromHeader(undefined)).toBeNull();
    expect(localOriginFromHeader('')).toBeNull();
    expect(localOriginFromHeader('null')).toBeNull();
  });

  it('returns null for a comma-separated (multi-value) header', () => {
    expect(localOriginFromHeader('http://a, http://b')).toBeNull();
  });

  it('returns null for a non-http(s) scheme', () => {
    expect(localOriginFromHeader('ftp://127.0.0.1')).toBeNull();
  });

  it('returns null when the origin carries a path, query, hash, or userinfo', () => {
    expect(localOriginFromHeader('http://127.0.0.1/path')).toBeNull();
    expect(localOriginFromHeader('http://127.0.0.1/?q=1')).toBeNull();
    expect(localOriginFromHeader('http://user:pass@127.0.0.1')).toBeNull();
  });

  it('returns null for a non-loopback host', () => {
    expect(localOriginFromHeader('http://evil.example.com')).toBeNull();
  });

  it('returns null for an unparseable value', () => {
    expect(localOriginFromHeader('::::')).toBeNull();
  });
});

function makeRequest(opts: { remoteAddress?: string; host?: string; origin?: string }) {
  return {
    socket: { remoteAddress: opts.remoteAddress },
    get: (name: string) => {
      const key = name.toLowerCase();
      if (key === 'host') return opts.host;
      if (key === 'origin') return opts.origin;
      return undefined;
    },
  } as any;
}

describe('validateLocalDaemonRequest', () => {
  it('accepts a loopback peer + loopback host + no Origin header', () => {
    const req = makeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:4173' });
    expect(validateLocalDaemonRequest(req)).toEqual({ ok: true, origin: null });
  });

  it('accepts a loopback peer + loopback host + a matching loopback Origin', () => {
    const req = makeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' });
    expect(validateLocalDaemonRequest(req)).toEqual({ ok: true, origin: 'http://127.0.0.1:4173' });
  });

  it('rejects a non-loopback peer address', () => {
    const req = makeRequest({ remoteAddress: '10.0.0.5', host: '127.0.0.1:4173' });
    expect(validateLocalDaemonRequest(req)).toEqual({
      ok: false,
      message: 'request peer must be a loopback address',
      details: { peer: 'remoteAddress' },
    });
  });

  it('rejects a non-loopback Host header', () => {
    const req = makeRequest({ remoteAddress: '127.0.0.1', host: 'evil.example.com' });
    expect(validateLocalDaemonRequest(req)).toEqual({
      ok: false,
      message: 'request host must be a loopback daemon address',
      details: { header: 'host' },
    });
  });

  it('rejects an unparseable Host header', () => {
    const req = makeRequest({ remoteAddress: '127.0.0.1' });
    expect(validateLocalDaemonRequest(req)).toMatchObject({ ok: false, details: { header: 'host' } });
  });

  it('rejects a non-loopback Origin header', () => {
    const req = makeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:4173', origin: 'http://evil.example.com' });
    expect(validateLocalDaemonRequest(req)).toEqual({
      ok: false,
      message: 'request origin must be a loopback daemon origin',
      details: { header: 'origin' },
    });
  });
});

describe('requireLocalDaemonRequest', () => {
  function makeRes() {
    return {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  }

  it('rejects a non-loopback request with 403 and does not call next()', () => {
    const req = makeRequest({ remoteAddress: '10.0.0.5', host: '127.0.0.1:4173' });
    const res = makeRes();
    const next = vi.fn();

    requireLocalDaemonRequest(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'FORBIDDEN', message: 'request peer must be a loopback address', details: { peer: 'remoteAddress' } },
    });
  });

  it('sets CORS headers scoped to the validated Origin and calls next() on a valid request', () => {
    const req = makeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' });
    const res = makeRes();
    const next = vi.fn();

    requireLocalDaemonRequest(req, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://127.0.0.1:4173');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Max-Age', '600');
    expect(next).toHaveBeenCalledOnce();
  });

  it('omits Access-Control-Allow-Origin when the request carried no Origin header, but still calls next()', () => {
    const req = makeRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:4173' });
    const res = makeRes();
    const next = vi.fn();

    requireLocalDaemonRequest(req, res as any, next);

    expect(res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything());
    expect(next).toHaveBeenCalledOnce();
  });
});
