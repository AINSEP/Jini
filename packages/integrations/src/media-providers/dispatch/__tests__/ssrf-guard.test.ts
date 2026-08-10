import { promises as dnsPromises } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAndFetchExternalAsset, assertExternalAssetUrl, isBlockedExternalApiHostname, isLoopbackApiHost, validateBaseUrlResolved } from '../ssrf-guard.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isLoopbackApiHost', () => {
  it('recognizes localhost (including trailing-dot FQDN form and mixed case)', () => {
    expect(isLoopbackApiHost('localhost')).toBe(true);
    expect(isLoopbackApiHost('LocalHost.')).toBe(true);
  });

  it('recognizes ::1, bracketed or not', () => {
    expect(isLoopbackApiHost('::1')).toBe(true);
    expect(isLoopbackApiHost('[::1]')).toBe(true);
  });

  it('recognizes the 127.0.0.0/8 range and rejects other IPv4 hosts', () => {
    expect(isLoopbackApiHost('127.0.0.1')).toBe(true);
    expect(isLoopbackApiHost('127.255.255.255')).toBe(true);
    expect(isLoopbackApiHost('8.8.8.8')).toBe(false);
  });

  it('recognizes an IPv4-mapped-IPv6 loopback literal (dotted-quad form) and rejects a non-loopback one', () => {
    expect(isLoopbackApiHost('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackApiHost('::ffff:8.8.8.8')).toBe(false);
  });

  it('recognizes an IPv4-mapped-IPv6 loopback literal (hex-group form)', () => {
    // ::ffff:7f00:1 == ::ffff:127.0.0.1 in the alternate hex-group notation.
    expect(isLoopbackApiHost('::ffff:7f00:1')).toBe(true);
  });

  it('rejects a malformed IPv4-mapped-IPv6 literal (wrong hex-group count / non-hex group) and a plain hostname', () => {
    expect(isLoopbackApiHost('::ffff:1:2:3')).toBe(false);
    expect(isLoopbackApiHost('::ffff:zzzz:1')).toBe(false);
    expect(isLoopbackApiHost('example.com')).toBe(false);
  });
});

describe('isBlockedExternalApiHostname', () => {
  it('blocks the unspecified IPv6 address', () => {
    expect(isBlockedExternalApiHostname('::')).toBe(true);
  });

  it('blocks 0.0.0.0/8', () => {
    expect(isBlockedExternalApiHostname('0.1.2.3')).toBe(true);
  });

  it('blocks CGNAT (100.64.0.0/10) at both edges and allows just outside the range', () => {
    expect(isBlockedExternalApiHostname('100.64.0.1')).toBe(true);
    expect(isBlockedExternalApiHostname('100.127.255.255')).toBe(true);
    expect(isBlockedExternalApiHostname('100.63.255.255')).toBe(false);
    expect(isBlockedExternalApiHostname('100.128.0.1')).toBe(false);
  });

  it('blocks link-local (169.254.0.0/16) and allows a neighboring /16', () => {
    expect(isBlockedExternalApiHostname('169.254.0.1')).toBe(true);
    expect(isBlockedExternalApiHostname('169.253.0.1')).toBe(false);
  });

  it('blocks 10.0.0.0/8', () => {
    expect(isBlockedExternalApiHostname('10.1.2.3')).toBe(true);
  });

  it('blocks 192.168.0.0/16 and allows a neighboring /16', () => {
    expect(isBlockedExternalApiHostname('192.168.1.1')).toBe(true);
    expect(isBlockedExternalApiHostname('192.167.1.1')).toBe(false);
  });

  it('blocks 172.16.0.0/12 at both edges and allows just outside the range', () => {
    expect(isBlockedExternalApiHostname('172.16.0.0')).toBe(true);
    expect(isBlockedExternalApiHostname('172.31.255.255')).toBe(true);
    expect(isBlockedExternalApiHostname('172.15.255.255')).toBe(false);
    expect(isBlockedExternalApiHostname('172.32.0.1')).toBe(false);
  });

  it('blocks multicast/reserved (>= 224.0.0.0) at the edge and allows just below it', () => {
    expect(isBlockedExternalApiHostname('224.0.0.1')).toBe(true);
    expect(isBlockedExternalApiHostname('255.255.255.255')).toBe(true);
    expect(isBlockedExternalApiHostname('223.255.255.255')).toBe(false);
  });

  it('allows a public IPv4 host and a non-IPv4 hostname', () => {
    expect(isBlockedExternalApiHostname('8.8.8.8')).toBe(false);
    expect(isBlockedExternalApiHostname('example.com')).toBe(false);
  });

  it('treats a malformed IPv4 octet (non-digit or out-of-range) as not a parseable IPv4 address', () => {
    expect(isBlockedExternalApiHostname('1.2.3.abc')).toBe(false);
    expect(isBlockedExternalApiHostname('1.2.3.999')).toBe(false);
  });

  it('blocks IPv6 unique-local (fc00::/7)', () => {
    expect(isBlockedExternalApiHostname('fc00::1')).toBe(true);
    expect(isBlockedExternalApiHostname('fd12:3456::1')).toBe(true);
  });

  it('blocks IPv6 link-local (fe80::/10) and allows a neighboring prefix', () => {
    expect(isBlockedExternalApiHostname('fe80::1')).toBe(true);
    expect(isBlockedExternalApiHostname('fe70::1')).toBe(false);
  });

  it('blocks an IPv4-mapped-IPv6 blocked address and allows a non-blocked one', () => {
    expect(isBlockedExternalApiHostname('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedExternalApiHostname('::ffff:8.8.8.8')).toBe(false);
  });

  it('normalizes a trailing-dot FQDN before parsing (10.0.0.1. still blocks)', () => {
    expect(isBlockedExternalApiHostname('10.0.0.1.')).toBe(true);
  });

  it('normalizes a bracketed IPv6 literal', () => {
    expect(isBlockedExternalApiHostname('[fc00::1]')).toBe(true);
  });
});

describe('validateBaseUrlResolved', () => {
  it('rejects an unparseable URL', async () => {
    const result = await validateBaseUrlResolved('not a url');
    expect(result).toEqual({ ok: false, error: 'Invalid baseUrl', forbidden: false });
  });

  it('rejects a non-http(s) protocol', async () => {
    const result = await validateBaseUrlResolved('ftp://example.com/file');
    expect(result).toEqual({ ok: false, error: 'Only http/https allowed', forbidden: false });
  });

  it('rejects a hostname that is synchronously blocked, without ever calling lookup', async () => {
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('http://10.0.0.5/asset.png', lookup);
    expect(result).toEqual({ ok: false, error: 'Internal IPs blocked', forbidden: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a loopback hostname without calling lookup', async () => {
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('http://localhost:8080/asset.png', lookup);
    expect(result).toEqual({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a public IPv4-literal hostname without calling lookup', async () => {
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('http://8.8.8.8/asset.png', lookup);
    expect(result).toEqual({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a public bracketed IPv6-literal hostname without calling lookup', async () => {
    // The WHATWG URL parser serializes an IPv6 host with brackets
    // (`.hostname === '[2001:db8::1]'`), so this also exercises
    // looksLikeIpLiteral's bracket-stripping branch.
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('http://[2001:db8::1]/asset.png', lookup);
    expect(result).toEqual({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a DNS name that resolves to a public address', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const result = await validateBaseUrlResolved('http://cdn.example.com/asset.png', lookup);
    expect(result).toEqual({ ok: true });
    expect(lookup).toHaveBeenCalledWith('cdn.example.com');
  });

  it('rejects a DNS name that resolves to a blocked internal address', async () => {
    const lookup = vi.fn(async () => [{ address: '10.0.0.9', family: 4 }]);
    const result = await validateBaseUrlResolved('http://internal.example.com/asset.png', lookup);
    expect(result).toEqual({ ok: false, error: 'Internal IPs blocked', forbidden: true });
  });

  it('skips (does not block on) a resolved loopback address', async () => {
    const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    const result = await validateBaseUrlResolved('http://loopback-alias.example.com/asset.png', lookup);
    expect(result).toEqual({ ok: true });
  });

  it('treats a DNS lookup failure as non-blocking (fetch will surface its own connection error)', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const result = await validateBaseUrlResolved('http://does-not-resolve.example.com/asset.png', lookup);
    expect(result).toEqual({ ok: true });
  });

  it('uses the real node:dns resolver by default', async () => {
    const addresses: LookupAddress[] = [{ address: '203.0.113.10', family: 4 }];
    const lookupSpy = vi.spyOn(dnsPromises, 'lookup').mockImplementationOnce(((_hostname: string, _opts: unknown) => Promise.resolve(addresses)) as typeof dnsPromises.lookup);
    const result = await validateBaseUrlResolved('http://cdn.example.com/asset.png');
    expect(result).toEqual({ ok: true });
    expect(lookupSpy).toHaveBeenCalledWith('cdn.example.com', { all: true, family: 0 });
  });
});

describe('assertExternalAssetUrl', () => {
  it('rejects an empty or non-string url', async () => {
    expect(await assertExternalAssetUrl('')).toEqual({ ok: false, error: 'empty download url' });
    expect(await assertExternalAssetUrl(undefined as unknown as string)).toEqual({ ok: false, error: 'empty download url' });
  });

  it('surfaces a "blocked download url" error for a forbidden host', async () => {
    const result = await assertExternalAssetUrl('http://192.168.1.1/x.png', vi.fn());
    expect(result).toEqual({ ok: false, error: 'blocked download url (Internal IPs blocked)' });
  });

  it('surfaces an "invalid download url" error for an unparseable url', async () => {
    const result = await assertExternalAssetUrl('not a url', vi.fn());
    expect(result).toEqual({ ok: false, error: 'invalid download url: Invalid baseUrl' });
  });

  it('passes through ok:true for a validated url', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const result = await assertExternalAssetUrl('https://cdn.example.com/x.png', lookup);
    expect(result).toEqual({ ok: true });
  });
});

describe('assertAndFetchExternalAsset', () => {
  it('throws instead of fetching when the url is blocked', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(assertAndFetchExternalAsset('http://10.0.0.1/x.png', {}, vi.fn())).rejects.toThrow(/blocked download url/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches with redirect pinned to "error" once validated, overriding a caller-supplied redirect value', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://cdn.example.com/x.png');
      expect(init.redirect).toBe('error');
      expect(init.headers).toEqual({ 'x-test': '1' });
      return new Response(Buffer.from('bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const resp = await assertAndFetchExternalAsset('https://cdn.example.com/x.png', { headers: { 'x-test': '1' }, redirect: 'follow' }, lookup);
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
