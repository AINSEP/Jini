import { promises as dnsPromises } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBlockedExternalApiHostname, isLoopbackApiHost } from "@jini-ai/platform/net";
import { assertAndFetchExternalAsset, assertExternalAssetUrl, validateBaseUrlResolved } from '../ssrf-guard.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isLoopbackApiHost', () => {
    it('recognizes localhost (including trailing-dot FQDN form and mixed case)', () => {
        expect(isLoopbackApiHost({ hostname: 'localhost' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: 'LocalHost.' })).toBe(true);
    });
    it('recognizes ::1, bracketed or not', () => {
        expect(isLoopbackApiHost({ hostname: '::1' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '[::1]' })).toBe(true);
    });
    it('recognizes the 127.0.0.0/8 range and rejects other IPv4 hosts', () => {
        expect(isLoopbackApiHost({ hostname: '127.0.0.1' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '127.255.255.255' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '8.8.8.8' })).toBe(false);
    });
    it('recognizes an IPv4-mapped-IPv6 loopback literal (dotted-quad form) and rejects a non-loopback one', () => {
        expect(isLoopbackApiHost({ hostname: '::ffff:127.0.0.1' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '::ffff:8.8.8.8' })).toBe(false);
    });
    it('recognizes an IPv4-mapped-IPv6 loopback literal (hex-group form)', () => {
        // ::ffff:7f00:1 == ::ffff:127.0.0.1 in the alternate hex-group notation.
        expect(isLoopbackApiHost({ hostname: '::ffff:7f00:1' })).toBe(true);
    });
    it('rejects a malformed IPv4-mapped-IPv6 literal (wrong hex-group count / non-hex group) and a plain hostname', () => {
        expect(isLoopbackApiHost({ hostname: '::ffff:1:2:3' })).toBe(false);
        expect(isLoopbackApiHost({ hostname: '::ffff:zzzz:1' })).toBe(false);
        expect(isLoopbackApiHost({ hostname: 'example.com' })).toBe(false);
    });
});

describe('isBlockedExternalApiHostname', () => {
    it('blocks the unspecified IPv6 address', () => {
        expect(isBlockedExternalApiHostname({ hostname: '::' })).toBe(true);
    });
    it('blocks 0.0.0.0/8', () => {
        expect(isBlockedExternalApiHostname({ hostname: '0.1.2.3' })).toBe(true);
    });
    it('blocks CGNAT (100.64.0.0/10) at both edges and allows just outside the range', () => {
        expect(isBlockedExternalApiHostname({ hostname: '100.64.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '100.127.255.255' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '100.63.255.255' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: '100.128.0.1' })).toBe(false);
    });
    it('blocks link-local (169.254.0.0/16) and allows a neighboring /16', () => {
        expect(isBlockedExternalApiHostname({ hostname: '169.254.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '169.253.0.1' })).toBe(false);
    });
    it('blocks 10.0.0.0/8', () => {
        expect(isBlockedExternalApiHostname({ hostname: '10.1.2.3' })).toBe(true);
    });
    it('blocks 192.168.0.0/16 and allows a neighboring /16', () => {
        expect(isBlockedExternalApiHostname({ hostname: '192.168.1.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '192.167.1.1' })).toBe(false);
    });
    it('blocks 172.16.0.0/12 at both edges and allows just outside the range', () => {
        expect(isBlockedExternalApiHostname({ hostname: '172.16.0.0' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '172.31.255.255' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '172.15.255.255' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: '172.32.0.1' })).toBe(false);
    });
    it('blocks multicast/reserved (>= 224.0.0.0) at the edge and allows just below it', () => {
        expect(isBlockedExternalApiHostname({ hostname: '224.0.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '255.255.255.255' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '223.255.255.255' })).toBe(false);
    });
    it('allows a public IPv4 host and a non-IPv4 hostname', () => {
        expect(isBlockedExternalApiHostname({ hostname: '8.8.8.8' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: 'example.com' })).toBe(false);
    });
    it('treats a malformed IPv4 octet (non-digit or out-of-range) as not a parseable IPv4 address', () => {
        expect(isBlockedExternalApiHostname({ hostname: '1.2.3.abc' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: '1.2.3.999' })).toBe(false);
    });
    it('blocks IPv6 unique-local (fc00::/7)', () => {
        expect(isBlockedExternalApiHostname({ hostname: 'fc00::1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: 'fd12:3456::1' })).toBe(true);
    });
    it('blocks IPv6 link-local (fe80::/10) and allows a neighboring prefix', () => {
        expect(isBlockedExternalApiHostname({ hostname: 'fe80::1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: 'fe70::1' })).toBe(false);
    });
    it('blocks an IPv4-mapped-IPv6 blocked address and allows a non-blocked one', () => {
        expect(isBlockedExternalApiHostname({ hostname: '::ffff:10.0.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '::ffff:8.8.8.8' })).toBe(false);
    });
    it('normalizes a trailing-dot FQDN before parsing (10.0.0.1. still blocks)', () => {
        expect(isBlockedExternalApiHostname({ hostname: '10.0.0.1.' })).toBe(true);
    });
    it('normalizes a bracketed IPv6 literal', () => {
        expect(isBlockedExternalApiHostname({ hostname: '[fc00::1]' })).toBe(true);
    });
});

describe('validateBaseUrlResolved', () => {
    it('rejects an unparseable URL', async () => {
        const result = await validateBaseUrlResolved({ baseUrl: 'not a url' });
        expect(result).toEqual({ ok: false, error: 'Invalid baseUrl', forbidden: false });
    });
    it('rejects a non-http(s) protocol', async () => {
        const result = await validateBaseUrlResolved({ baseUrl: 'ftp://example.com/file' });
        expect(result).toEqual({ ok: false, error: 'Only http/https allowed', forbidden: false });
    });
    it('rejects a hostname that is synchronously blocked, without ever calling lookup', async () => {
        const lookup = vi.fn();
        const result = await validateBaseUrlResolved({ baseUrl: 'http://10.0.0.5/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: false, error: 'Internal IPs blocked', forbidden: true });
        expect(lookup).not.toHaveBeenCalled();
    });
    it('rejects a loopback hostname without calling lookup', async () => {
        const lookup = vi.fn();
        const result = await validateBaseUrlResolved({ baseUrl: 'http://localhost:8080/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: false, error: 'Internal IPs blocked', forbidden: true });
        expect(lookup).not.toHaveBeenCalled();
    });
    it('accepts a public IPv4-literal hostname without calling lookup', async () => {
        const lookup = vi.fn();
        const result = await validateBaseUrlResolved({ baseUrl: 'http://8.8.8.8/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: true });
        expect(lookup).not.toHaveBeenCalled();
    });
    it('accepts a public bracketed IPv6-literal hostname without calling lookup', async () => {
        // The WHATWG URL parser serializes an IPv6 host with brackets
        // (`.hostname === '[2001:db8::1]'`), so this also exercises
        // looksLikeIpLiteral's bracket-stripping branch.
        const lookup = vi.fn();
        const result = await validateBaseUrlResolved({ baseUrl: 'http://[2001:db8::1]/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: true });
        expect(lookup).not.toHaveBeenCalled();
    });
    it('accepts a DNS name that resolves to a public address', async () => {
        const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
        const result = await validateBaseUrlResolved({ baseUrl: 'http://cdn.example.com/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: true });
        expect(lookup).toHaveBeenCalledWith({ hostname: 'cdn.example.com' });
    });
    it('rejects a DNS name that resolves to a blocked internal address', async () => {
        const lookup = vi.fn(async () => [{ address: '10.0.0.9', family: 4 }]);
        const result = await validateBaseUrlResolved({ baseUrl: 'http://internal.example.com/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: false, error: 'Internal IPs blocked', forbidden: true });
    });
    it('rejects a resolved loopback address', async () => {
        const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
        const result = await validateBaseUrlResolved({ baseUrl: 'http://loopback-alias.example.com/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: false, error: 'Internal IPs blocked', forbidden: true });
    });
    it('fails closed on a DNS lookup failure', async () => {
        const lookup = vi.fn(async () => {
            throw new Error('ENOTFOUND');
        });
        const result = await validateBaseUrlResolved({ baseUrl: 'http://does-not-resolve.example.com/asset.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: false, error: 'DNS resolution failed', forbidden: true });
    });
    it('uses the real node:dns resolver by default', async () => {
        const addresses: LookupAddress[] = [{ address: '203.0.113.10', family: 4 }];
        const lookupSpy = vi.spyOn(dnsPromises, 'lookup').mockImplementationOnce(((_hostname: string, _opts: unknown) => Promise.resolve(addresses)) as typeof dnsPromises.lookup);
        const result = await validateBaseUrlResolved({ baseUrl: 'http://cdn.example.com/asset.png' });
        expect(result).toEqual({ ok: true });
        expect(lookupSpy).toHaveBeenCalledWith('cdn.example.com', { all: true, family: 0 });
    });
});

describe('assertExternalAssetUrl', () => {
    it('rejects an empty or non-string url', async () => {
        expect(await assertExternalAssetUrl({ rawUrl: '' })).toEqual({ ok: false, error: 'empty download url' });
        expect(await assertExternalAssetUrl({ rawUrl: undefined as unknown as string })).toEqual({ ok: false, error: 'empty download url' });
    });
    it('surfaces a "blocked download url" error for a forbidden host', async () => {
        const result = await assertExternalAssetUrl({ rawUrl: 'http://192.168.1.1/x.png' }, { lookup: vi.fn() });
        expect(result).toEqual({ ok: false, error: 'blocked download url (Internal IPs blocked)' });
    });
    it('surfaces an "invalid download url" error for an unparseable url', async () => {
        const result = await assertExternalAssetUrl({ rawUrl: 'not a url' }, { lookup: vi.fn() });
        expect(result).toEqual({ ok: false, error: 'invalid download url: Invalid baseUrl' });
    });
    it('passes through ok:true for a validated url', async () => {
        const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
        const result = await assertExternalAssetUrl({ rawUrl: 'https://cdn.example.com/x.png' }, { lookup: lookup });
        expect(result).toEqual({ ok: true });
    });
});

describe('assertAndFetchExternalAsset', () => {
    it('throws instead of fetching when the url is blocked', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(assertAndFetchExternalAsset({ url: 'http://10.0.0.1/x.png' }, { init: {}, lookup: vi.fn() })).rejects.toThrow(/blocked download url/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('fetches with redirect pinned to "error" once validated, overriding a caller-supplied redirect value', async () => {
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            expect(url).toBe('https://cdn.example.com/x.png');
            expect(init.redirect).toBe('error');
            expect(init.headers).toEqual(expect.objectContaining({ 'x-test': '1' }));
            return new Response(Buffer.from('bytes'), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
        const resp = await assertAndFetchExternalAsset({ url: 'https://cdn.example.com/x.png' }, { init: { headers: { 'x-test': '1' }, redirect: 'follow' }, lookup: lookup });
        expect(resp.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('./outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});
