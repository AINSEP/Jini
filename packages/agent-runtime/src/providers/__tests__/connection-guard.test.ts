import * as http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultDnsLookup,
  isBlockedExternalApiHostname,
  isLoopbackApiHost,
  pinnedFetch,
  redactSecrets,
  validateBaseUrl,
  validateBaseUrlResolved,
  type DnsLookupAddress,
} from '../connection-guard.js';

describe('isLoopbackApiHost', () => {
  it('recognizes localhost and ::1', () => {
    expect(isLoopbackApiHost('localhost')).toBe(true);
    expect(isLoopbackApiHost('::1')).toBe(true);
    expect(isLoopbackApiHost('[::1]')).toBe(true);
  });

  it('recognizes 127.0.0.0/8', () => {
    expect(isLoopbackApiHost('127.0.0.1')).toBe(true);
    expect(isLoopbackApiHost('127.255.255.255')).toBe(true);
  });

  it('is case-insensitive and strips a trailing dot (FQDN form)', () => {
    expect(isLoopbackApiHost('LOCALHOST.')).toBe(true);
    expect(isLoopbackApiHost('127.0.0.1.')).toBe(true);
  });

  it('recognizes IPv4-mapped IPv6 loopback (dotted and hex forms)', () => {
    expect(isLoopbackApiHost('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackApiHost('::ffff:7f00:1')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackApiHost('example.com')).toBe(false);
    expect(isLoopbackApiHost('10.0.0.1')).toBe(false);
    expect(isLoopbackApiHost('::ffff:10.0.0.1')).toBe(false);
  });

  it('rejects a malformed IPv4-mapped hex form', () => {
    expect(isLoopbackApiHost('::ffff:zzzz:1')).toBe(false);
    expect(isLoopbackApiHost('::ffff:1:2:3')).toBe(false);
  });

  it('treats an out-of-range IPv4 octet as not a valid IPv4 address at all', () => {
    expect(isLoopbackApiHost('999.0.0.1')).toBe(false);
  });
});

describe('isBlockedExternalApiHostname', () => {
  it('blocks the unspecified IPv6 address', () => {
    expect(isBlockedExternalApiHostname('::')).toBe(true);
  });

  it('blocks RFC1918 / link-local / CGNAT / multicast IPv4 ranges', () => {
    expect(isBlockedExternalApiHostname('0.0.0.0')).toBe(true);
    expect(isBlockedExternalApiHostname('100.64.0.1')).toBe(true);
    expect(isBlockedExternalApiHostname('100.127.255.255')).toBe(true);
    expect(isBlockedExternalApiHostname('169.254.1.1')).toBe(true);
    expect(isBlockedExternalApiHostname('10.1.2.3')).toBe(true);
    expect(isBlockedExternalApiHostname('192.168.1.1')).toBe(true);
    expect(isBlockedExternalApiHostname('172.16.0.1')).toBe(true);
    expect(isBlockedExternalApiHostname('172.31.255.255')).toBe(true);
    expect(isBlockedExternalApiHostname('224.0.0.1')).toBe(true);
  });

  it('does not block a normal public IPv4 address', () => {
    expect(isBlockedExternalApiHostname('8.8.8.8')).toBe(false);
    expect(isBlockedExternalApiHostname('172.32.0.1')).toBe(false);
    expect(isBlockedExternalApiHostname('100.63.0.1')).toBe(false);
    expect(isBlockedExternalApiHostname('100.128.0.1')).toBe(false);
  });

  it('blocks unique-local and link-local IPv6', () => {
    expect(isBlockedExternalApiHostname('fc00::1')).toBe(true);
    expect(isBlockedExternalApiHostname('fd12::1')).toBe(true);
    expect(isBlockedExternalApiHostname('fe80::1')).toBe(true);
    expect(isBlockedExternalApiHostname('fe90::1')).toBe(true);
    expect(isBlockedExternalApiHostname('fea0::1')).toBe(true);
    expect(isBlockedExternalApiHostname('feb0::1')).toBe(true);
  });

  it('does not block a normal public IPv6 address', () => {
    expect(isBlockedExternalApiHostname('2001:4860:4860::8888')).toBe(false);
  });

  it('blocks an IPv4-mapped blocked address', () => {
    expect(isBlockedExternalApiHostname('::ffff:10.0.0.1')).toBe(true);
  });

  it('does not block a hostname that is not a recognizable IP literal', () => {
    expect(isBlockedExternalApiHostname('example.com')).toBe(false);
  });
});

describe('validateBaseUrl', () => {
  it('accepts a normal https url', () => {
    const result = validateBaseUrl('https://api.openai.com/v1');
    expect(result.error).toBeUndefined();
    expect(result.parsed?.hostname).toBe('api.openai.com');
  });

  it('rejects an unparseable url', () => {
    expect(validateBaseUrl('not a url').error).toBe('Invalid baseUrl');
  });

  it('rejects a non-http(s) scheme', () => {
    expect(validateBaseUrl('ftp://example.com').error).toBe('Only http/https allowed');
  });

  it('rejects a blocked internal hostname as forbidden', () => {
    const result = validateBaseUrl('http://10.0.0.5/v1');
    expect(result.error).toBe('Internal IPs blocked');
    expect(result.forbidden).toBe(true);
  });

  it('allows a loopback hostname through even though it would otherwise match no block rule', () => {
    const result = validateBaseUrl('http://127.0.0.1:11434/v1');
    expect(result.error).toBeUndefined();
  });

  it('strips trailing slashes before parsing', () => {
    const result = validateBaseUrl('https://api.openai.com/v1///');
    expect(result.parsed?.toString()).toBe('https://api.openai.com/v1');
  });
});

describe('validateBaseUrlResolved', () => {
  it('short-circuits on a sync validation failure without calling lookup', async () => {
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('not a url', lookup);
    expect(result.error).toBe('Invalid baseUrl');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips DNS resolution for a loopback hostname', async () => {
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('http://localhost:11434', lookup);
    expect(result.error).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips DNS resolution for a literal IP hostname (IPv4)', async () => {
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('https://8.8.8.8/v1', lookup);
    expect(result.error).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips DNS resolution for a literal IPv6 hostname', async () => {
    const lookup = vi.fn();
    const result = await validateBaseUrlResolved('https://[2001:4860:4860::8888]/v1', lookup);
    expect(result.error).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves a public hostname and passes when every address is public', async () => {
    const lookup = vi.fn(async (): Promise<DnsLookupAddress[]> => [{ address: '8.8.8.8', family: 4 }]);
    const result = await validateBaseUrlResolved('https://api.example.com/v1', lookup);
    expect(result.error).toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('api.example.com');
  });

  it('rejects a public hostname that resolves to a blocked address', async () => {
    const lookup = vi.fn(async (): Promise<DnsLookupAddress[]> => [{ address: '10.0.0.5', family: 4 }]);
    const result = await validateBaseUrlResolved('https://internal.example.com/v1', lookup);
    expect(result.error).toBe('Internal IPs blocked');
    expect(result.forbidden).toBe(true);
  });

  it('treats a loopback-resolved address as allowed', async () => {
    const lookup = vi.fn(async (): Promise<DnsLookupAddress[]> => [{ address: '127.0.0.1', family: 4 }]);
    const result = await validateBaseUrlResolved('https://foo.localhost/v1', lookup);
    expect(result.error).toBeUndefined();
  });

  it('does not treat a DNS lookup failure as a security signal', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const result = await validateBaseUrlResolved('https://unresolvable.example.com/v1', lookup);
    expect(result.error).toBeUndefined();
    expect(result.pinnedAddress).toBeUndefined();
  });

  // `pinnedAddress` is the address `pinnedFetch` dials directly, instead of the transport
  // re-resolving DNS independently when it connects — see `pinnedFetch`'s own tests below for the
  // rebinding scenario this exists to close.
  describe('pinnedAddress', () => {
    it('is set to the first resolved address when DNS resolution actually happens', async () => {
      const lookup = vi.fn(async (): Promise<DnsLookupAddress[]> => [
        { address: '203.0.113.10', family: 4 },
        { address: '203.0.113.11', family: 4 },
      ]);
      const result = await validateBaseUrlResolved('https://api.example.com/v1', lookup);
      expect(result.error).toBeUndefined();
      expect(result.pinnedAddress).toEqual({ address: '203.0.113.10', family: 4 });
    });

    it('is unset for a loopback-literal hostname, which skips DNS resolution entirely', async () => {
      const lookup = vi.fn();
      const result = await validateBaseUrlResolved('http://localhost:11434', lookup);
      expect(result.error).toBeUndefined();
      expect(result.pinnedAddress).toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('is unset for an IP-literal hostname, which skips DNS resolution entirely', async () => {
      const lookup = vi.fn();
      const result = await validateBaseUrlResolved('https://8.8.8.8/v1', lookup);
      expect(result.error).toBeUndefined();
      expect(result.pinnedAddress).toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('is unset when the resolved address is blocked (the request never gets a pin because it never gets a pass)', async () => {
      const lookup = vi.fn(async (): Promise<DnsLookupAddress[]> => [{ address: '10.0.0.5', family: 4 }]);
      const result = await validateBaseUrlResolved('https://internal.example.com/v1', lookup);
      expect(result.error).toBe('Internal IPs blocked');
      expect(result.pinnedAddress).toBeUndefined();
    });
  });
});

describe('pinnedFetch', () => {
  // THE rebinding proof, done against real infrastructure rather than a mocked transport (ESM
  // built-ins like `node:http` reject `vi.spyOn` — "Cannot redefine property" — and a mock would
  // invite the objection that the mock, not `pinnedFetch`, is what behaved). `example.com` is a
  // real, publicly resolvable domain that is certainly NOT this test's loopback server. `pinned`
  // points at that server instead. `validateBaseUrlResolved` validates one address and hands it to
  // `pinnedFetch` as `pinnedAddress`; the TOCTOU this closes is a transport that re-resolves the
  // hostname ITSELF when it dials — a second, independent DNS lookup a rebinding attacker can
  // answer differently from the first. If the request reaches THIS server, `pinnedFetch` never
  // consulted DNS for `example.com` at all — a real second resolution would have gone anywhere but
  // here. The Host header the server actually receives is asserted too: still `example.com`, not
  // the pinned IP — the "pin, not a redirect to a different origin" half of the same claim.
  it('dials the pinned address directly, never the real DNS answer for the URL\'s own hostname — closing the rebinding TOCTOU', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ host: req.headers.host, method: req.method, path: req.url }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    const { port } = address;

    try {
      const response = await pinnedFetch(
        `http://example.com:${port}/v1/chat`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"hi":1}' },
        { address: '127.0.0.1', family: 4 },
      );
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      const parsed = JSON.parse(await response.text());
      expect(parsed).toEqual({ host: `example.com:${port}`, method: 'POST', path: '/v1/chat' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // The other side of the same contract: when `validateBaseUrlResolved` never ran a lookup (the
  // loopback-literal / IP-literal skip — see its doc), `pinnedAddress` is `undefined` and
  // `pinnedFetch` must still work as a normal, unpinned request rather than erroring or hanging.
  it('when pinnedAddress is undefined, connects normally with no lookup override', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ host: req.headers.host }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    const { port } = address;

    try {
      const response = await pinnedFetch(`http://127.0.0.1:${port}/v1`, { method: 'POST', headers: {}, body: '{}' }, undefined);
      expect(response.ok).toBe(true);
      const parsed = JSON.parse(await response.text());
      expect(parsed).toEqual({ host: `127.0.0.1:${port}` });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // `fetch` transparently decompresses; `http(s).request` does not. Nothing downstream of
  // `pinnedFetch` decompresses either, so a compressed body would be parsed as UTF-8 SSE and
  // produce silent garbage — an "empty stream" or a JSON error nowhere near the cause. Asserted
  // as a hard rejection because failing loudly is the whole point.
  it('rejects a compressed response rather than handing back bytes nothing will decompress', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-encoding', 'gzip');
      res.end(Buffer.from([0x1f, 0x8b, 0x08, 0x00])); // gzip magic; never decoded
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    const { port } = address;

    try {
      await expect(
        pinnedFetch(`http://127.0.0.1:${port}/v1`, { method: 'POST', headers: {}, body: '{}' }, undefined),
      ).rejects.toThrow(/content-encoding "gzip"/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('asks for identity encoding, so a well-behaved server never compresses in the first place', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ acceptEncoding: req.headers['accept-encoding'] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    const { port } = address;

    try {
      const response = await pinnedFetch(`http://127.0.0.1:${port}/v1`, { method: 'POST', headers: {}, body: '{}' }, undefined);
      expect(JSON.parse(await response.text())).toEqual({ acceptEncoding: 'identity' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('drains the body and reports ok:false for a non-2xx response', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = 503;
      res.end('upstream unavailable');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    const { port } = address;

    try {
      const response = await pinnedFetch(
        `http://svc.invalid:${port}/v1`,
        { method: 'POST', headers: {}, body: '{}' },
        { address: '127.0.0.1', family: 4 },
      );
      expect(response.ok).toBe(false);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('upstream unavailable');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('exposes the response body as an async-iterable of chunks, for SSE/NDJSON stream decoding', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.write('data: chunk-one\n\n');
      res.end('data: chunk-two\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    const { port } = address;

    try {
      const response = await pinnedFetch(
        `http://svc.invalid:${port}/v1`,
        { method: 'POST', headers: {}, body: '{}' },
        { address: '127.0.0.1', family: 4 },
      );
      expect(response.body).not.toBeNull();
      const decoder = new TextDecoder();
      let collected = '';
      for await (const piece of response.body!) {
        collected += decoder.decode(piece as Uint8Array, { stream: true });
      }
      expect(collected).toBe('data: chunk-one\n\ndata: chunk-two\n\n');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('destroys the request when the signal aborts', async () => {
    const server = http.createServer((_req, res) => {
      // Deliberately never responds — the abort has to be what ends the request.
      void res;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    const { port } = address;
    const controller = new AbortController();

    try {
      const pending = pinnedFetch(
        `http://svc.invalid:${port}/v1`,
        { method: 'POST', headers: {}, body: '{}', signal: controller.signal },
        { address: '127.0.0.1', family: 4 },
      );
      controller.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('defaultDnsLookup', () => {
  it('resolves loopback for localhost via the real node:dns module', async () => {
    const addresses = await defaultDnsLookup('localhost');
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.every((a) => typeof a.address === 'string' && typeof a.family === 'number')).toBe(true);
  });
});

describe('redactSecrets', () => {
  it('returns an empty string for non-string/empty input', () => {
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(undefined as unknown as string)).toBe('');
  });

  it('redacts a Bearer token', () => {
    expect(redactSecrets('Authorization: Bearer sk-abc123.def')).toBe('Authorization: Bearer [REDACTED]');
  });

  it('redacts x-api-key / api-key / x-goog-api-key style headers', () => {
    expect(redactSecrets('x-api-key: secret123')).toBe('x-api-key: [REDACTED]');
    expect(redactSecrets('api-key=secret123')).toBe('api-key: [REDACTED]');
    expect(redactSecrets('x-goog-api-key: secret123')).toBe('x-goog-api-key: [REDACTED]');
  });

  it('redacts a ?key= query value', () => {
    expect(redactSecrets('https://example.com?key=abc123&other=1')).toBe(
      'https://example.com?key=[REDACTED]&other=1',
    );
  });

  it('redacts every occurrence of an exact secret, escaping regex metacharacters', () => {
    expect(redactSecrets('key is a.b+c and again a.b+c', ['a.b+c'])).toBe(
      'key is [REDACTED] and again [REDACTED]',
    );
  });

  it('ignores blank/undefined/null entries in exactSecrets', () => {
    expect(redactSecrets('hello world', [undefined, null, ''])).toBe('hello world');
  });
});
