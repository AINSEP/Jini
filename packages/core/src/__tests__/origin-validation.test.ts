import { describe, expect, it } from 'vitest';

import {
  allowedBrowserPorts,
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

const CONFIG: OriginValidationEnvConfig = {
  allowedOriginsEnvVar: 'FAKE_ALLOWED_ORIGINS',
  webPortEnvVar: 'FAKE_WEB_PORT',
  bindHostEnvVar: 'FAKE_BIND_HOST',
};

describe('@injini/core — origin-validation — configuredAllowedOrigins/Hosts', () => {
  it('is empty when unset or blank', () => {
    expect(configuredAllowedOrigins(CONFIG, {})).toEqual([]);
    expect(configuredAllowedOrigins(CONFIG, { [CONFIG.allowedOriginsEnvVar]: '   ' })).toEqual([]);
  });

  it('parses and normalizes a comma-separated list of http/https origins', () => {
    const origins = configuredAllowedOrigins(CONFIG, {
      [CONFIG.allowedOriginsEnvVar]: 'https://example.com/, http://other.example:8080',
    });
    expect(origins).toEqual(['https://example.com', 'http://other.example:8080']);
    expect(configuredAllowedHosts(origins)).toEqual(['example.com', 'other.example:8080']);
  });

  it('rejects a non-http(s) origin', () => {
    expect(() =>
      configuredAllowedOrigins(CONFIG, { [CONFIG.allowedOriginsEnvVar]: 'ftp://example.com' }),
    ).toThrow(/only supports http:\/\/ and https:\/\//);
  });
});

describe('@injini/core — origin-validation — allowedBrowserPorts', () => {
  it('includes the primary port only when webPort is unset or equal', () => {
    expect(allowedBrowserPorts(CONFIG, 3000, {})).toEqual([3000]);
    expect(allowedBrowserPorts(CONFIG, 3000, { [CONFIG.webPortEnvVar]: '3000' })).toEqual([3000]);
  });

  it('appends a distinct configured web port', () => {
    expect(allowedBrowserPorts(CONFIG, 3000, { [CONFIG.webPortEnvVar]: '5173' })).toEqual([3000, 5173]);
  });

  it('omits the primary port when falsy', () => {
    expect(allowedBrowserPorts(CONFIG, null, {})).toEqual([]);
    expect(allowedBrowserPorts(CONFIG, null, { [CONFIG.webPortEnvVar]: '5173' })).toEqual([5173]);
  });
});

describe('@injini/core — origin-validation — parseHostHeader', () => {
  it('returns null for a missing or unparseable header', () => {
    expect(parseHostHeader(undefined)).toBeNull();
    expect(parseHostHeader('   ')).toBeNull();
    expect(parseHostHeader('a b')).toBeNull();
  });

  it('takes the first entry of an array header value', () => {
    expect(parseHostHeader(['localhost:3000', 'other:9999'])).toEqual({
      hostname: 'localhost',
      host: 'localhost:3000',
      port: '3000',
    });
  });

  it('treats a null/undefined first array entry as an absent header', () => {
    expect(parseHostHeader([undefined, 'other:9999'])).toBeNull();
  });

  it('defaults the port to 80 when absent', () => {
    expect(parseHostHeader('example.com')).toEqual({ hostname: 'example.com', host: 'example.com', port: '80' });
  });
});

describe('@injini/core — origin-validation — isPrivateIpv4', () => {
  it('accepts the three RFC1918 ranges and link-local', () => {
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.255')).toBe(true);
    expect(isPrivateIpv4('192.168.1.1')).toBe(true);
    expect(isPrivateIpv4('169.254.1.1')).toBe(true);
  });

  it('rejects a public address, malformed shape, and out-of-range octets', () => {
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateIpv4('not.an.ip.addr')).toBe(false);
    expect(isPrivateIpv4('1.2.3')).toBe(false);
    expect(isPrivateIpv4('1.2.3.999')).toBe(false);
    expect(isPrivateIpv4(undefined)).toBe(false);
  });
});

describe('@injini/core — origin-validation — isIpLiteralHostname', () => {
  it('accepts a bracketed literal and a dotted-quad', () => {
    expect(isIpLiteralHostname('[::1]')).toBe(true);
    expect(isIpLiteralHostname('10.0.0.1')).toBe(true);
  });

  it('rejects empty, non-4-part, non-numeric, and out-of-range hostnames', () => {
    expect(isIpLiteralHostname('')).toBe(false);
    expect(isIpLiteralHostname(undefined)).toBe(false);
    expect(isIpLiteralHostname('example.com')).toBe(false);
    expect(isIpLiteralHostname('1.2.3.a')).toBe(false);
    expect(isIpLiteralHostname('1.2.3.999')).toBe(false);
  });
});

describe('@injini/core — origin-validation — isLoopbackOrPrivateLanHost', () => {
  it('recognizes every loopback/unspecified spelling and private ranges, case-insensitively', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '::', 'LOCALHOST', '10.1.2.3']) {
      expect(isLoopbackOrPrivateLanHost(host)).toBe(true);
    }
  });

  it('rejects a public hostname', () => {
    expect(isLoopbackOrPrivateLanHost('example.com')).toBe(false);
  });

  it('rejects a falsy hostname without throwing', () => {
    expect(isLoopbackOrPrivateLanHost(undefined)).toBe(false);
    expect(isLoopbackOrPrivateLanHost('')).toBe(false);
  });
});

describe('@injini/core — origin-validation — isAllowedBrowserHost', () => {
  it('rejects an unparseable host header', () => {
    expect(isAllowedBrowserHost(CONFIG, 'a b', [3000], '127.0.0.1', [])).toBe(false);
  });

  it('accepts an explicit loopback:port match', () => {
    expect(isAllowedBrowserHost(CONFIG, 'localhost:3000', [3000], '127.0.0.1', [])).toBe(true);
  });

  it('accepts an explicit bindHost:port match', () => {
    expect(isAllowedBrowserHost(CONFIG, '192.168.1.5:3000', [3000], '192.168.1.5', [])).toBe(true);
  });

  it('accepts an explicitly allow-listed host', () => {
    // configuredAllowedHosts derives 'proxy.example' (no port) from
    // 'https://proxy.example', so the request's Host header must match that
    // exactly — the ports[] list is irrelevant to this explicit-set match.
    expect(isAllowedBrowserHost(CONFIG, 'proxy.example', [3000], '127.0.0.1', ['https://proxy.example'])).toBe(
      true,
    );
  });

  it('rejects a port outside the allowed set', () => {
    expect(isAllowedBrowserHost(CONFIG, '127.0.0.1:9999', [3000], '127.0.0.1', [])).toBe(false);
  });

  it('accepts a private-LAN hostname on an allowed port that is not one of the explicit entries', () => {
    expect(isAllowedBrowserHost(CONFIG, '10.0.0.7:3000', [3000], '127.0.0.1', [])).toBe(true);
  });

  it('rejects a public hostname even on an allowed port', () => {
    expect(isAllowedBrowserHost(CONFIG, 'evil.example:3000', [3000], '127.0.0.1', [])).toBe(false);
  });
});

describe('@injini/core — origin-validation — isAllowedBrowserOrigin', () => {
  it('accepts an explicitly allow-listed origin string', () => {
    expect(
      isAllowedBrowserOrigin(CONFIG, 'https://proxy.example', 'proxy.example', [3000], '127.0.0.1', [
        'https://proxy.example',
      ]),
    ).toBe(true);
  });

  it('rejects an unparseable origin', () => {
    expect(isAllowedBrowserOrigin(CONFIG, 'not a url', 'localhost:3000', [3000], '127.0.0.1', [])).toBe(false);
  });

  it('rejects a non-http(s) origin protocol', () => {
    expect(isAllowedBrowserOrigin(CONFIG, 'ftp://example.com', 'localhost:3000', [3000], '127.0.0.1', [])).toBe(
      false,
    );
  });

  it('rejects when the host header is unparseable', () => {
    expect(isAllowedBrowserOrigin(CONFIG, 'http://localhost:3000', 'a b', [3000], '127.0.0.1', [])).toBe(false);
  });

  it('accepts an explicit scheme://loopback:port match', () => {
    expect(isAllowedBrowserOrigin(CONFIG, 'http://localhost:3000', 'localhost:3000', [3000], '127.0.0.1', [])).toBe(
      true,
    );
  });

  it('rejects an origin port outside the allowed set', () => {
    expect(
      isAllowedBrowserOrigin(CONFIG, 'http://10.0.0.7:9999', 'localhost:3000', [3000], '127.0.0.1', []),
    ).toBe(false);
  });

  it('rejects when the origin hostname does not match the host header hostname', () => {
    expect(
      isAllowedBrowserOrigin(CONFIG, 'http://10.0.0.7:3000', '10.0.0.8:3000', [3000], '127.0.0.1', []),
    ).toBe(false);
  });

  it('accepts a matching private-LAN hostname/port combination', () => {
    expect(
      isAllowedBrowserOrigin(CONFIG, 'http://10.0.0.7:3000', '10.0.0.7:3000', [3000], '127.0.0.1', []),
    ).toBe(true);
  });

  it('defaults the origin port from the protocol when absent (https -> 443)', () => {
    expect(
      isAllowedBrowserOrigin(CONFIG, 'https://localhost', 'localhost:443', [443], '127.0.0.1', []),
    ).toBe(true);
  });

  it('defaults the origin port from the protocol when absent (http -> 80)', () => {
    expect(isAllowedBrowserOrigin(CONFIG, 'http://localhost', 'localhost:80', [80], '127.0.0.1', [])).toBe(true);
  });
});

describe('@injini/core — origin-validation — isLocalSameOrigin', () => {
  it('allows a same-origin GET with no Origin header when the host is locally served', () => {
    expect(isLocalSameOrigin(CONFIG, { headers: { host: 'localhost:3000' } }, 3000, {})).toBe(true);
  });

  it('allows a missing-Origin request with sec-fetch-site: same-origin against the broader allow-list', () => {
    const req = { headers: { host: 'proxy.example', 'sec-fetch-site': 'same-origin' } };
    expect(
      isLocalSameOrigin(CONFIG, req, 3000, { [CONFIG.allowedOriginsEnvVar]: 'https://proxy.example' }),
    ).toBe(true);
  });

  it('rejects a missing-Origin request whose host is not locally served, even with sec-fetch-site: same-origin', () => {
    const req = { headers: { host: 'evil.example', 'sec-fetch-site': 'same-origin' } };
    expect(isLocalSameOrigin(CONFIG, req, 3000, {})).toBe(false);
  });

  it('rejects a missing-Origin, non-local-host request without the same-origin signal', () => {
    const req = { headers: { host: 'evil.example' } };
    expect(isLocalSameOrigin(CONFIG, req, 3000, {})).toBe(false);
  });

  it('trusts an Origin that exactly matches an explicit allow-list entry, even behind a reverse proxy', () => {
    const req = { headers: { host: 'internal-upstream:3000', origin: 'https://proxy.example' } };
    expect(
      isLocalSameOrigin(CONFIG, req, 3000, { [CONFIG.allowedOriginsEnvVar]: 'https://proxy.example' }),
    ).toBe(true);
  });

  it('rejects an Origin request whose host is not locally served and not allow-listed', () => {
    const req = { headers: { host: 'evil.example', origin: 'https://evil.example' } };
    expect(isLocalSameOrigin(CONFIG, req, 3000, {})).toBe(false);
  });

  it('accepts a same-origin, locally-served request with a matching Origin', () => {
    const req = { headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } };
    expect(isLocalSameOrigin(CONFIG, req, 3000, {})).toBe(true);
  });

  it('rejects a locally-served host with a mismatched, non-allow-listed Origin', () => {
    const req = { headers: { host: 'localhost:3000', origin: 'https://evil.example' } };
    expect(isLocalSameOrigin(CONFIG, req, 3000, {})).toBe(false);
  });

  it('defaults env to process.env when omitted', () => {
    const req = { headers: { host: 'localhost:3000' } };
    expect(isLocalSameOrigin(CONFIG, req, 3000)).toBe(true);
  });

  it('treats a request with no Host header as an empty host, and rejects it', () => {
    expect(isLocalSameOrigin(CONFIG, { headers: {} }, 3000, {})).toBe(false);
  });
});
