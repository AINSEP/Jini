import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  allowedBrowserPorts,
  assertValidAllowedOrigins,
  configuredAllowedHosts,
  configuredAllowedOrigins,
  isAllowedBrowserHost,
  isAllowedBrowserOrigin,
  isIpLiteralHostname,
  isLocalSameOrigin,
  isLoopbackOrPrivateLanHost,
  isPrivateIpv4,
  parseHostHeader,
  type OriginValidationEnvConfig,
} from '../origin-validation.js';

const LOGGER = { warn: ({ message }: { message: string }) => console.warn(message) };

const CONFIG: OriginValidationEnvConfig = {
  allowedOriginsEnvVar: 'FAKE_ALLOWED_ORIGINS',
  webPortEnvVar: 'FAKE_WEB_PORT',
  bindHostEnvVar: 'FAKE_BIND_HOST',
};

// PARITY: preserves HTTP transport's lenient request parsing and strict boot validation.
it('keeps the same-origin hot path available while boot validation names malformed entries', () => {
  const env = { [CONFIG.allowedOriginsEnvVar]: 'not-a-url, https://proxy.example' };
  const warn = vi.fn();
  expect(isLocalSameOrigin({ config: CONFIG, env, port: 3000,
    req: { headers: { host: 'upstream.invalid:80', origin: 'https://proxy.example' } },
  }, { logger: { warn } })).toBe(true);
  expect(warn).toHaveBeenCalledOnce();
  expect(() => assertValidAllowedOrigins({ config: CONFIG, env })).toThrow(/not-a-url/);
});

// PARITY: the canonical core parser uses only its injected diagnostic sink.
it('drops malformed entries without ambient logging when no logger is injected', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect(configuredAllowedOrigins({ config: CONFIG,
      env: { [CONFIG.allowedOriginsEnvVar]: 'not-a-url, https://proxy.example' },
    })).toEqual(['https://proxy.example']);
    expect(warn).not.toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});

describe('@jini-ai/core — origin-validation — configuredAllowedOrigins/Hosts', () => {
  it('is empty when unset or blank', () => {
    expect(configuredAllowedOrigins({ config: CONFIG, env: {} }, { logger: LOGGER })).toEqual([]);
    expect(configuredAllowedOrigins({ config: CONFIG, env: { [CONFIG.allowedOriginsEnvVar]: '   ' } }, { logger: LOGGER })).toEqual([]);
  });

  it('parses and normalizes a comma-separated list of http/https origins', () => {
    const origins = configuredAllowedOrigins({ config: CONFIG, env: {
      [CONFIG.allowedOriginsEnvVar]: 'https://example.com/, http://other.example:8080',
    } }, { logger: LOGGER });
    expect(origins).toEqual(['https://example.com', 'http://other.example:8080']);
    expect(configuredAllowedHosts({ origins })).toEqual(['example.com', 'other.example:8080']);
  });

  describe('given a malformed entry', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    // PARITY: preserves the former HTTP transport regression guard: this function used to throw
    // synchronously from inside `isLocalSameOrigin`, which every same-origin decision calls fresh
    // — see `assertValidAllowedOrigins` below for where that throw now belongs instead.
    it('drops a non-http(s) origin instead of throwing, and logs why', () => {
      expect(configuredAllowedOrigins({ config: CONFIG, env: { [CONFIG.allowedOriginsEnvVar]: 'ftp://example.com' } }, { logger: LOGGER })).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ftp://example.com'));
    });
  });
});

describe('@jini-ai/core — origin-validation — assertValidAllowedOrigins', () => {
  it('does not throw when unset, blank, or entirely valid', () => {
    expect(() => assertValidAllowedOrigins({ config: CONFIG, env: {} })).not.toThrow();
    expect(() =>
      assertValidAllowedOrigins({ config: CONFIG, env: { [CONFIG.allowedOriginsEnvVar]: 'https://example.com' } }),
    ).not.toThrow();
  });

  it('throws, naming the invalid entry and the configured env var, on a non-http(s) origin', () => {
    expect(() =>
      assertValidAllowedOrigins({ config: CONFIG, env: { [CONFIG.allowedOriginsEnvVar]: 'ftp://example.com' } }),
    ).toThrowError(/FAKE_ALLOWED_ORIGINS has 1 invalid entry.*ftp:\/\/example\.com/);
  });
});

describe('@jini-ai/core — origin-validation — allowedBrowserPorts', () => {
  it('includes the primary port only when webPort is unset or equal', () => {
    expect(allowedBrowserPorts({ config: CONFIG, port: 3000, env: {} })).toEqual([3000]);
    expect(allowedBrowserPorts({ config: CONFIG, port: 3000, env: { [CONFIG.webPortEnvVar]: '3000' } })).toEqual([3000]);
  });

  it('appends a distinct configured web port', () => {
    expect(allowedBrowserPorts({ config: CONFIG, port: 3000, env: { [CONFIG.webPortEnvVar]: '5173' } })).toEqual([3000, 5173]);
  });

  it('omits the primary port when falsy', () => {
    expect(allowedBrowserPorts({ config: CONFIG, port: null, env: {} })).toEqual([]);
    expect(allowedBrowserPorts({ config: CONFIG, port: null, env: { [CONFIG.webPortEnvVar]: '5173' } })).toEqual([5173]);
  });
});

describe('@jini-ai/core — origin-validation — parseHostHeader', () => {
  it('returns null for a missing or unparseable header', () => {
    expect(parseHostHeader({ value: undefined })).toBeNull();
    expect(parseHostHeader({ value: '   ' })).toBeNull();
    expect(parseHostHeader({ value: 'a b' })).toBeNull();
  });

  it('takes the first entry of an array header value', () => {
    expect(parseHostHeader({ value: ['localhost:3000', 'other:9999'] })).toEqual({
      hostname: 'localhost',
      host: 'localhost:3000',
      port: '3000',
    });
  });

  it('treats a null/undefined first array entry as an absent header', () => {
    expect(parseHostHeader({ value: [undefined, 'other:9999'] })).toBeNull();
  });

  it('defaults the port to 80 when absent', () => {
    expect(parseHostHeader({ value: 'example.com' })).toEqual({ hostname: 'example.com', host: 'example.com', port: '80' });
  });
});

describe('@jini-ai/core — origin-validation — isPrivateIpv4', () => {
  it('accepts the three RFC1918 ranges and link-local', () => {
    expect(isPrivateIpv4({ hostname: '10.0.0.1' })).toBe(true);
    expect(isPrivateIpv4({ hostname: '172.16.0.1' })).toBe(true);
    expect(isPrivateIpv4({ hostname: '172.31.255.255' })).toBe(true);
    expect(isPrivateIpv4({ hostname: '192.168.1.1' })).toBe(true);
    expect(isPrivateIpv4({ hostname: '169.254.1.1' })).toBe(true);
  });

  it('rejects a public address, malformed shape, and out-of-range octets', () => {
    expect(isPrivateIpv4({ hostname: '8.8.8.8' })).toBe(false);
    expect(isPrivateIpv4({ hostname: '172.32.0.1' })).toBe(false);
    expect(isPrivateIpv4({ hostname: 'not.an.ip.addr' })).toBe(false);
    expect(isPrivateIpv4({ hostname: '1.2.3' })).toBe(false);
    expect(isPrivateIpv4({ hostname: '1.2.3.999' })).toBe(false);
    expect(isPrivateIpv4({ hostname: undefined })).toBe(false);
  });
});

describe('@jini-ai/core — origin-validation — isIpLiteralHostname', () => {
  it('accepts a bracketed literal and a dotted-quad', () => {
    expect(isIpLiteralHostname({ hostname: '[::1]' })).toBe(true);
    expect(isIpLiteralHostname({ hostname: '10.0.0.1' })).toBe(true);
  });

  it('rejects empty, non-4-part, non-numeric, and out-of-range hostnames', () => {
    expect(isIpLiteralHostname({ hostname: '' })).toBe(false);
    expect(isIpLiteralHostname({ hostname: undefined })).toBe(false);
    expect(isIpLiteralHostname({ hostname: 'example.com' })).toBe(false);
    expect(isIpLiteralHostname({ hostname: '1.2.3.a' })).toBe(false);
    expect(isIpLiteralHostname({ hostname: '1.2.3.999' })).toBe(false);
  });
});

describe('@jini-ai/core — origin-validation — isLoopbackOrPrivateLanHost', () => {
  it('recognizes every loopback/unspecified spelling and private ranges, case-insensitively', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '::', 'LOCALHOST', '10.1.2.3']) {
      expect(isLoopbackOrPrivateLanHost({ hostname: host })).toBe(true);
    }
  });

  it('rejects a public hostname', () => {
    expect(isLoopbackOrPrivateLanHost({ hostname: 'example.com' })).toBe(false);
  });

  it('rejects a falsy hostname without throwing', () => {
    expect(isLoopbackOrPrivateLanHost({ hostname: undefined })).toBe(false);
    expect(isLoopbackOrPrivateLanHost({ hostname: '' })).toBe(false);
  });
});

describe('@jini-ai/core — origin-validation — isAllowedBrowserHost', () => {
  it('rejects an unparseable host header', () => {
    expect(isAllowedBrowserHost({ config: CONFIG, hostHeader: 'a b', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(false);
  });

  it('accepts an explicit loopback:port match', () => {
    expect(isAllowedBrowserHost({ config: CONFIG, hostHeader: 'localhost:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(true);
  });

  it('accepts an explicit bindHost:port match', () => {
    expect(isAllowedBrowserHost({ config: CONFIG, hostHeader: '192.168.1.5:3000', ports: [3000], bindHost: '192.168.1.5', extraAllowedOrigins: [] })).toBe(true);
  });

  it('accepts an explicitly allow-listed host', () => {
    // configuredAllowedHosts derives 'proxy.example' (no port) from
    // 'https://proxy.example', so the request's Host header must match that
    // exactly — the ports[] list is irrelevant to this explicit-set match.
    expect(isAllowedBrowserHost({ config: CONFIG, hostHeader: 'proxy.example', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: ['https://proxy.example'] })).toBe(
      true,
    );
  });

  it('rejects a port outside the allowed set', () => {
    expect(isAllowedBrowserHost({ config: CONFIG, hostHeader: '127.0.0.1:9999', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(false);
  });

  it('accepts a private-LAN hostname on an allowed port that is not one of the explicit entries', () => {
    expect(isAllowedBrowserHost({ config: CONFIG, hostHeader: '10.0.0.7:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(true);
  });

  it('rejects a public hostname even on an allowed port', () => {
    expect(isAllowedBrowserHost({ config: CONFIG, hostHeader: 'evil.example:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(false);
  });
});

describe('@jini-ai/core — origin-validation — isAllowedBrowserOrigin', () => {
  it('accepts an explicitly allow-listed origin string', () => {
    expect(
      isAllowedBrowserOrigin({ config: CONFIG, origin: 'https://proxy.example', hostHeader: 'proxy.example', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [
        'https://proxy.example',
      ] }),
    ).toBe(true);
  });

  it('rejects an unparseable origin', () => {
    expect(isAllowedBrowserOrigin({ config: CONFIG, origin: 'not a url', hostHeader: 'localhost:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(false);
  });

  it('rejects a non-http(s) origin protocol', () => {
    expect(isAllowedBrowserOrigin({ config: CONFIG, origin: 'ftp://example.com', hostHeader: 'localhost:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(
      false,
    );
  });

  it('rejects when the host header is unparseable', () => {
    expect(isAllowedBrowserOrigin({ config: CONFIG, origin: 'http://localhost:3000', hostHeader: 'a b', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(false);
  });

  it('accepts an explicit scheme://loopback:port match', () => {
    expect(isAllowedBrowserOrigin({ config: CONFIG, origin: 'http://localhost:3000', hostHeader: 'localhost:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(
      true,
    );
  });

  it('rejects an origin port outside the allowed set', () => {
    expect(
      isAllowedBrowserOrigin({ config: CONFIG, origin: 'http://10.0.0.7:9999', hostHeader: 'localhost:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] }),
    ).toBe(false);
  });

  it('rejects when the origin hostname does not match the host header hostname', () => {
    expect(
      isAllowedBrowserOrigin({ config: CONFIG, origin: 'http://10.0.0.7:3000', hostHeader: '10.0.0.8:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] }),
    ).toBe(false);
  });

  it('accepts a matching private-LAN hostname/port combination', () => {
    expect(
      isAllowedBrowserOrigin({ config: CONFIG, origin: 'http://10.0.0.7:3000', hostHeader: '10.0.0.7:3000', ports: [3000], bindHost: '127.0.0.1', extraAllowedOrigins: [] }),
    ).toBe(true);
  });

  it('defaults the origin port from the protocol when absent (https -> 443)', () => {
    expect(
      isAllowedBrowserOrigin({ config: CONFIG, origin: 'https://localhost', hostHeader: 'localhost:443', ports: [443], bindHost: '127.0.0.1', extraAllowedOrigins: [] }),
    ).toBe(true);
  });

  it('defaults the origin port from the protocol when absent (http -> 80)', () => {
    expect(isAllowedBrowserOrigin({ config: CONFIG, origin: 'http://localhost', hostHeader: 'localhost:80', ports: [80], bindHost: '127.0.0.1', extraAllowedOrigins: [] })).toBe(true);
  });
});

describe('@jini-ai/core — origin-validation — isLocalSameOrigin', () => {
  it('allows a same-origin GET with no Origin header when the host is locally served', () => {
    expect(isLocalSameOrigin({ config: CONFIG, req: { headers: { host: 'localhost:3000' } }, port: 3000, env: {} }, { logger: LOGGER })).toBe(true);
  });

  it('allows a missing-Origin request with sec-fetch-site: same-origin against the broader allow-list', () => {
    const req = { headers: { host: 'proxy.example', 'sec-fetch-site': 'same-origin' } };
    expect(
      isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: { [CONFIG.allowedOriginsEnvVar]: 'https://proxy.example' } }, { logger: LOGGER }),
    ).toBe(true);
  });

  it('rejects a missing-Origin request whose host is not locally served, even with sec-fetch-site: same-origin', () => {
    const req = { headers: { host: 'evil.example', 'sec-fetch-site': 'same-origin' } };
    expect(isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: {} }, { logger: LOGGER })).toBe(false);
  });

  it('rejects a missing-Origin, non-local-host request without the same-origin signal', () => {
    const req = { headers: { host: 'evil.example' } };
    expect(isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: {} }, { logger: LOGGER })).toBe(false);
  });

  it('trusts an Origin that exactly matches an explicit allow-list entry, even behind a reverse proxy', () => {
    const req = { headers: { host: 'internal-upstream:3000', origin: 'https://proxy.example' } };
    expect(
      isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: { [CONFIG.allowedOriginsEnvVar]: 'https://proxy.example' } }, { logger: LOGGER }),
    ).toBe(true);
  });

  it('rejects an Origin request whose host is not locally served and not allow-listed', () => {
    const req = { headers: { host: 'evil.example', origin: 'https://evil.example' } };
    expect(isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: {} }, { logger: LOGGER })).toBe(false);
  });

  it('accepts a same-origin, locally-served request with a matching Origin', () => {
    const req = { headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } };
    expect(isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: {} }, { logger: LOGGER })).toBe(true);
  });

  it('rejects a locally-served host with a mismatched, non-allow-listed Origin', () => {
    const req = { headers: { host: 'localhost:3000', origin: 'https://evil.example' } };
    expect(isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: {} }, { logger: LOGGER })).toBe(false);
  });

  it('uses an explicitly empty environment when no overrides are configured', () => {
    const req = { headers: { host: 'localhost:3000' } };
    expect(isLocalSameOrigin({ config: CONFIG, req, port: 3000, env: {} }, { logger: LOGGER })).toBe(true);
  });

  it('treats a request with no Host header as an empty host, and rejects it', () => {
    expect(isLocalSameOrigin({ config: CONFIG, req: { headers: {} }, port: 3000, env: {} }, { logger: LOGGER })).toBe(false);
  });
});
