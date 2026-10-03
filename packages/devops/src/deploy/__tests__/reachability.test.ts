import { lookup } from 'node:dns';
import { createNodeReachabilityPorts } from '../node.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDeploymentUrl, normalizeDeploymentUrl, waitForReachableDeploymentUrl } from '../reachability.js';

const { guard } = createNodeReachabilityPorts({});

/** Read global fetch at call time so existing transport stubs and real DNS tests retain their seams. */
const fetchPort = ({ url }: { url: string }, { init }: { init?: RequestInit } = {}) => fetch(url, init);

function fixedLookup(address: string): typeof lookup {
  return Object.assign((...args: unknown[]): void => {
    const callback = args.at(-1);
    if (typeof callback === 'function') callback(null, address, 4);
  }, { __promisify__: lookup.__promisify__ });
}

function jsonResponse(status: number, headers: Record<string, string> = {}, body = ''): Response {
  return new Response(body, { status, headers });
}

describe('normalizeDeploymentUrl', () => {
  it('prefixes a bare hostname with https://', () => {
    expect(normalizeDeploymentUrl({ url: 'my-site.example.app' })).toBe('https://my-site.example.app');
  });

  it('leaves an already-absolute URL untouched', () => {
    expect(normalizeDeploymentUrl({ url: 'http://my-site.example.app' })).toBe('http://my-site.example.app');
  });

  it('returns an empty string for non-string or empty input', () => {
    expect(normalizeDeploymentUrl({ url: undefined })).toBe('');
    expect(normalizeDeploymentUrl({ url: '   ' })).toBe('');
    expect(normalizeDeploymentUrl({ url: 42 })).toBe('');
  });
});

describe('checkDeploymentUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports reachable:false without a network call when the URL is empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkDeploymentUrl({ url: '', fetch: fetchPort, guard });
    expect(result).toEqual({ reachable: false, statusMessage: 'Deployment URL is empty.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports reachable:true on a 2xx HEAD response without falling back to GET', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard });
    expect(result).toEqual({ reachable: true, statusCode: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('HEAD');
  });

  it('falls back to GET when HEAD returns a client/method error', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(405))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard });
    expect(result).toEqual({ reachable: true, statusCode: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]?.method).toBe('GET');
  });

  it('classifies a 401 as protected when the caller-supplied detector matches', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(401, {}, 'Authentication Required'));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard }, {
      detectProtected: ({ body }) => body.includes('Authentication Required'),
      protectedMessage: 'gated',
    });
    expect(result).toEqual({ reachable: false, status: 'protected', statusCode: 401, statusMessage: 'gated' });
  });

  it('classifies the GET fallback as protected too, after HEAD triggered the fallback with a non-401 client error', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403)) // HEAD: triggers the GET fallback (statusCode >= 400)
      .mockResolvedValueOnce(jsonResponse(401, {}, 'Authentication Required')); // GET: reports protected
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard }, {
      detectProtected: ({ body }) => body.includes('Authentication Required'),
      protectedMessage: 'gated',
    });
    expect(result).toEqual({ reachable: false, status: 'protected', statusCode: 401, statusMessage: 'gated' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns the GET fallback\'s own not-reachable result when HEAD and GET both answer 404', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404)) // HEAD: triggers the GET fallback
      .mockResolvedValueOnce(jsonResponse(404)); // GET: still not there, not protected
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard });
    expect(result).toEqual({ reachable: false, statusCode: 404, statusMessage: 'Public link returned HTTP 404.' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]?.method).toBe('GET');
  });

  it('folds a non-Error rejection into reachable:false with its string form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('socket hang up'));
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard });
    expect(result).toEqual({ reachable: false, statusMessage: 'Public link is not reachable yet: socket hang up' });
  });

  it('folds a network error (e.g. connection refused) into reachable:false with a message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('fetch failed')),
    );
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard });
    expect(result.reachable).toBe(false);
    expect(result.statusMessage).toContain('fetch failed');
  });

  it('folds a non-Error rejection (fetch/dispatcher can reject with any thrown value in JS) into reachable:false via String(err)', async () => {
    // Exercises the `err instanceof Error ? err.message : String(err)` false side: JS's
    // `throw`/`Promise.reject` accept any value, so a misbehaving fetch implementation or
    // dispatcher rejecting with a plain string is real defensive-programming territory, not a
    // hypothetical this test invents out of thin air.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('boom'));
    const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard });
    expect(result.reachable).toBe(false);
    expect(result.statusMessage).toBe('Public link is not reachable yet: boom');
  });

  describe('SEC-003: hostile provider-returned URLs are rejected before any network call', () => {
    it('rejects a literal private/loopback IP address without calling fetch', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const result = await checkDeploymentUrl({ url: 'https://127.0.0.1/steal', fetch: fetchPort, guard });
      expect(result.reachable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects a cloud-metadata-shaped link-local address (169.254.169.254) without calling fetch', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const result = await checkDeploymentUrl({ url: 'https://169.254.169.254/latest/meta-data/', fetch: fetchPort, guard });
      expect(result.reachable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects localhost without calling fetch', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const result = await checkDeploymentUrl({ url: 'https://localhost:9999/', fetch: fetchPort, guard });
      expect(result.reachable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects a plain http:// candidate (deployment providers always serve over https) without calling fetch', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const result = await checkDeploymentUrl({ url: 'http://site.example', fetch: fetchPort, guard });
      expect(result.reachable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects embedded URL credentials without calling fetch', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const result = await checkDeploymentUrl({ url: 'https://user:pass@site.example', fetch: fetchPort, guard });
      expect(result.reachable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('still accepts a genuinely public https URL (the guard is not overly broad)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200));
      vi.stubGlobal('fetch', fetchSpy);
      const result = await checkDeploymentUrl({ url: 'https://site.example', fetch: fetchPort, guard });
      expect(result).toEqual({ reachable: true, statusCode: 200 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('SEC-003: DNS-rebinding-shape — the connection-time lookup guard is actually wired in', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('rejects when the injected lookup resolves the hostname to a private address, using the REAL fetch (not stubbed)', async () => {
      // Deliberately does not stub global fetch: the rejection must come from the real undici
      // Agent's connect-time `lookup` (wired via the injected `lookupImpl`) refusing to connect,
      // not from a mocked network layer — this is what proves the dispatcher is actually
      // attached to the fetch call, mirroring asset-cache's own createValidatingLookup coverage.
      const result = await checkDeploymentUrl({ url: 'https://rebinding-attacker.example', ...createNodeReachabilityPorts({}, { lookupImpl: fixedLookup('169.254.169.254') }) }, { timeoutMs: 2_000 });
      expect(result.reachable).toBe(false);
      expect(result.statusMessage).toContain('Public link is not reachable yet');
    });

    it('a lookup resolving to a public address is allowed through to the real network attempt (which then fails to connect, proving no false-positive rejection)', async () => {
      // 192.0.2.1 is TEST-NET-1 (RFC 5737) — publicly-routable address space reserved for
      // documentation, so it is not classified as private, but nothing listens there, so the
      // real connection attempt itself fails. This proves the guard let a public-looking
      // address through to the actual connect step instead of rejecting it.
      const result = await checkDeploymentUrl({ url: 'https://not-actually-there.example', ...createNodeReachabilityPorts({}, { lookupImpl: fixedLookup('192.0.2.1') }) }, { timeoutMs: 1_000 });
      expect(result.reachable).toBe(false);
      expect(result.statusMessage).not.toContain('private address');
    });
  });
});

describe('waitForReachableDeploymentUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns link-delayed immediately when no candidate URLs are given', async () => {
    const result = await waitForReachableDeploymentUrl({ urls: [], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, { providerLabel: 'Test Provider' });
    expect(result.status).toBe('link-delayed');
    expect(result.url).toBe('');
    expect(result.statusMessage).toContain('Test Provider');
  });

  it('treats a null/undefined urls argument the same as an empty array (defensive against a non-TypeScript or `as any` caller)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await waitForReachableDeploymentUrl({ urls: null as unknown as unknown[], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, { providerLabel: 'Test Provider' });
    expect(result.status).toBe('link-delayed');
    expect(result.url).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to a generic protected message when the caller explicitly passes an empty protectedMessage', async () => {
    // `options.protectedMessage ?? 'default'` in reachability.ts's own protected-response
    // branch only replaces null/undefined, not '' — so a caller-supplied empty string survives
    // all the way to this function's own `result.statusMessage || generic` fallback, which is
    // what this test actually exercises. This package ships no targets of its own, but
    // `protectedMessage` is public API on an exported function, so an external caller doing this is real
    // behavior to cover, not a hypothetical.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {}, 'Authentication Required')));
    const result = await waitForReachableDeploymentUrl({ urls: ['site.example'], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, {
      timeoutMs: 60_000,
      intervalMs: 5_000,
      detectProtected: ({ body }) => body.includes('Authentication Required'),
      protectedMessage: '',
    });
    expect(result.status).toBe('protected');
    expect(result.statusMessage).toBe('Deployment provider is gating this link behind its own auth wall.');
  });

  it('resolves ready as soon as a candidate is reachable, without waiting out the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200)));
    const result = await waitForReachableDeploymentUrl({ urls: ['site.example'], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, { timeoutMs: 60_000, intervalMs: 5_000 });
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://site.example');
    expect(result.reachableAt).toBeTypeOf('number');
  });

  it('waits intervalMs and sweeps again when the first sweep finds nothing reachable', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404)) // sweep 1 HEAD
      .mockResolvedValueOnce(jsonResponse(404)) // sweep 1 GET
      .mockResolvedValueOnce(jsonResponse(200)); // sweep 2 HEAD
    vi.stubGlobal('fetch', fetchSpy);
    const result = await waitForReachableDeploymentUrl({ urls: ['site.example'], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, { timeoutMs: 60_000, intervalMs: 1 });
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://site.example');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('short-circuits to protected as soon as any candidate reports the auth wall', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {}, 'Authentication Required')));
    const result = await waitForReachableDeploymentUrl({ urls: ['site.example'], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, {
      timeoutMs: 60_000,
      intervalMs: 5_000,
      detectProtected: ({ body }) => body.includes('Authentication Required'),
    });
    expect(result.status).toBe('protected');
  });

  it('falls back to a generic link-delayed message when the timeout budget is already spent before a single sweep runs', async () => {
    // A negative timeoutMs makes `Date.now() - startedAt <= timeoutMs` false on the very first
    // check, so the while loop's body — which is the only place `lastMessage` is ever assigned —
    // never executes even once. That's the one real way `lastMessage` can still be '' when the
    // function falls through to its final return, exercising the `lastMessage || generic` fallback.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await waitForReachableDeploymentUrl({ urls: ['site.example'], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, { timeoutMs: -1, providerLabel: 'Test Provider' });
    expect(result.status).toBe('link-delayed');
    expect(result.url).toBe('https://site.example');
    expect(result.statusMessage).toBe('Test Provider returned a deployment URL, but it is not reachable yet.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports link-delayed once the timeout budget elapses with no reachable/protected candidate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await waitForReachableDeploymentUrl({ urls: ['site.example'], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, { timeoutMs: 20, intervalMs: 10 });
    expect(result.status).toBe('link-delayed');
    expect(result.url).toBe('https://site.example');
  });

  it('de-duplicates candidate URLs so a repeated alias is not probed twice per sweep', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal('fetch', fetchSpy);
    await waitForReachableDeploymentUrl({ urls: ['site.example', 'https://site.example', 'site.example'], fetch: fetchPort, guard, now: () => Date.now(), sleep: async ({ ms }) => { await new Promise((resolve) => setTimeout(resolve, ms)); } }, {
      timeoutMs: 1_000,
      intervalMs: 100,
    });
    // Only one distinct candidate after normalization+dedup; the first sweep hits it once (HEAD) then resolves.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
