import { describe, expect, it } from 'vitest';
import {
  allowedBrowserPorts,
  configuredAllowedOrigins,
  isAllowedBrowserOrigin,
  isIpLiteralHostname,
  isLocalSameOrigin,
  isLoopbackOrPrivateLanHost,
  isPrivateIpv4,
  parseHostHeader,
} from '../origin-validation.js';

const PORT = 7456;

describe('isPrivateIpv4', () => {
  it.each(['10.0.5.12', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.10.20'])(
    'classifies %s as private',
    (host) => {
      expect(isPrivateIpv4(host)).toBe(true);
    },
  );

  it.each(['172.15.255.255', '172.32.0.1', '8.8.8.8', '192.168.1.256', 'not-an-ip', '1.2.3.x'])(
    'classifies %s as not private',
    (host) => {
      expect(isPrivateIpv4(host)).toBe(false);
    },
  );

  it('treats a falsy hostname as not private', () => {
    expect(isPrivateIpv4(undefined)).toBe(false);
    expect(isPrivateIpv4(null)).toBe(false);
    expect(isPrivateIpv4('')).toBe(false);
  });

  it('classifies a 4-part host with a non-numeric octet as not private', () => {
    expect(isPrivateIpv4('1.2.3.abc')).toBe(false);
  });
});

describe('isIpLiteralHostname', () => {
  it('accepts a bracketed IPv6 literal', () => {
    expect(isIpLiteralHostname('[::1]')).toBe(true);
  });

  it('accepts a dotted-quad IPv4 literal', () => {
    expect(isIpLiteralHostname('192.168.1.1')).toBe(true);
    expect(isIpLiteralHostname('127.0.0.1')).toBe(true);
  });

  it('rejects a hostname', () => {
    expect(isIpLiteralHostname('example.com')).toBe(false);
  });

  it('rejects an IPv4-shaped string with an out-of-range octet', () => {
    expect(isIpLiteralHostname('192.168.1.999')).toBe(false);
    expect(isIpLiteralHostname('1.2.3.999')).toBe(false);
  });

  it('rejects an IPv4-shaped string with a non-digit part', () => {
    expect(isIpLiteralHostname('192.168.1.x')).toBe(false);
    expect(isIpLiteralHostname('example.com.not.numeric')).toBe(false);
  });

  it('rejects a falsy/empty hostname', () => {
    expect(isIpLiteralHostname(undefined)).toBe(false);
    expect(isIpLiteralHostname('')).toBe(false);
  });
});

describe('parseHostHeader', () => {
  it('parses a plain string host header', () => {
    expect(parseHostHeader('example.com:8080')).toEqual({
      hostname: 'example.com',
      host: 'example.com:8080',
      port: '8080',
    });
  });

  it('takes the first element when the header arrives as an array (duplicate-header case)', () => {
    expect(parseHostHeader(['example.com:9999', 'other.example'])).toEqual({
      hostname: 'example.com',
      host: 'example.com:9999',
      port: '9999',
    });
  });

  it('returns null for an empty array (no header value at all)', () => {
    expect(parseHostHeader([])).toBeNull();
  });

  it('returns null for a missing/null header value', () => {
    expect(parseHostHeader(undefined)).toBeNull();
    expect(parseHostHeader(null)).toBeNull();
  });

  it('returns null (malformed-input category) rather than throwing when the header cannot form a valid URL', () => {
    expect(parseHostHeader('[')).toBeNull();
  });
});

describe('isLoopbackOrPrivateLanHost', () => {
  it('accepts loopback and unspecified hosts', () => {
    expect(isLoopbackOrPrivateLanHost('localhost')).toBe(true);
    expect(isLoopbackOrPrivateLanHost('127.0.0.1')).toBe(true);
    expect(isLoopbackOrPrivateLanHost('::1')).toBe(true);
    expect(isLoopbackOrPrivateLanHost('0.0.0.0')).toBe(true);
  });

  it('rejects a missing hostname', () => {
    expect(isLoopbackOrPrivateLanHost(undefined)).toBe(false);
  });

  it('rejects a public host', () => {
    expect(isLoopbackOrPrivateLanHost('evil.com')).toBe(false);
  });

  it('rejects a falsy hostname', () => {
    expect(isLoopbackOrPrivateLanHost(undefined)).toBe(false);
  });
});

describe('configuredAllowedOrigins', () => {
  it('returns [] when JINI_ALLOWED_ORIGINS is unset or blank', () => {
    expect(configuredAllowedOrigins({})).toEqual([]);
    expect(configuredAllowedOrigins({ JINI_ALLOWED_ORIGINS: '  ' })).toEqual([]);
  });

  it('parses a comma-separated, whitespace-trimmed list', () => {
    expect(
      configuredAllowedOrigins({
        JINI_ALLOWED_ORIGINS: ' https://a.example.com , http://b.example.com:8080 ',
      }),
    ).toEqual(['https://a.example.com', 'http://b.example.com:8080']);
  });

  it('rejects a non-http(s) origin', () => {
    expect(() =>
      configuredAllowedOrigins({ JINI_ALLOWED_ORIGINS: 'ftp://example.com' }),
    ).toThrowError('JINI_ALLOWED_ORIGINS only supports http:// and https:// origins');
  });
});

describe('parseHostHeader', () => {
  it('parses a plain hostname:port value', () => {
    expect(parseHostHeader('127.0.0.1:7456')).toEqual({ hostname: '127.0.0.1', host: '127.0.0.1:7456', port: '7456' });
  });

  it('defaults port to "80" when the header carries none', () => {
    expect(parseHostHeader('localhost')).toEqual({ hostname: 'localhost', host: 'localhost', port: '80' });
  });

  it('reads the first element when the header arrives as an array (multi-value header)', () => {
    expect(parseHostHeader(['a.example.com', 'b.example.com'])).toEqual({
      hostname: 'a.example.com',
      host: 'a.example.com',
      port: '80',
    });
  });

  it('returns null for an empty array header (no first element)', () => {
    expect(parseHostHeader([])).toBeNull();
  });

  it('returns null for a missing/undefined header', () => {
    expect(parseHostHeader(undefined)).toBeNull();
  });

  it('returns null when the value cannot be parsed as a URL authority', () => {
    expect(parseHostHeader('[')).toBeNull();
  });
});

describe('allowedBrowserPorts', () => {
  it('includes the primary port and JINI_WEB_PORT when distinct', () => {
    expect(allowedBrowserPorts(PORT, { JINI_WEB_PORT: '9000' })).toEqual([PORT, 9000]);
  });

  it('dedupes when JINI_WEB_PORT equals the primary port', () => {
    expect(allowedBrowserPorts(PORT, { JINI_WEB_PORT: String(PORT) })).toEqual([PORT]);
  });

  it('omits a falsy primary port', () => {
    expect(allowedBrowserPorts(0, {})).toEqual([]);
  });
});

describe('isAllowedBrowserOrigin', () => {
  it('allows a loopback origin matching the request host and an allowed port', () => {
    expect(
      isAllowedBrowserOrigin(
        `http://127.0.0.1:${PORT}`,
        `127.0.0.1:${PORT}`,
        [PORT],
        '127.0.0.1',
        [],
      ),
    ).toBe(true);
  });

  it('allows a private-LAN origin when host matches', () => {
    const lanHost = `192.168.18.16:${PORT}`;
    expect(isAllowedBrowserOrigin(`http://${lanHost}`, lanHost, [PORT], '127.0.0.1', [])).toBe(
      true,
    );
  });

  it('rejects when the request Host differs from the origin hostname', () => {
    expect(
      isAllowedBrowserOrigin(
        `http://192.168.18.16:${PORT}`,
        `192.168.18.17:${PORT}`,
        [PORT],
        '127.0.0.1',
        [],
      ),
    ).toBe(false);
  });

  it('rejects an unparseable origin', () => {
    expect(isAllowedBrowserOrigin('not a url', `127.0.0.1:${PORT}`, [PORT], '127.0.0.1', [])).toBe(
      false,
    );
  });

  it('rejects a public origin not on the allow-list', () => {
    expect(
      isAllowedBrowserOrigin('http://evil.com', `127.0.0.1:${PORT}`, [PORT], '127.0.0.1', []),
    ).toBe(false);
  });

  it('allows an explicitly allow-listed origin outright', () => {
    expect(
      isAllowedBrowserOrigin('https://deploy.example.com', 'anything', [PORT], '127.0.0.1', [
        'https://deploy.example.com',
      ]),
    ).toBe(true);
  });

  it('rejects a non-http(s) origin scheme', () => {
    expect(isAllowedBrowserOrigin(`ftp://127.0.0.1:${PORT}`, `127.0.0.1:${PORT}`, [PORT], '127.0.0.1', [])).toBe(
      false,
    );
  });

  it('rejects when the request Host header cannot be parsed at all', () => {
    expect(isAllowedBrowserOrigin(`http://127.0.0.1:${PORT}`, '[', [PORT], '127.0.0.1', [])).toBe(
      false,
    );
  });

  it('rejects when the Host header is missing/unparseable', () => {
    expect(isAllowedBrowserOrigin(`http://127.0.0.1:${PORT}`, undefined, [PORT], '127.0.0.1', [])).toBe(false);
  });

  it('defaults an origin with no explicit port to 80 for http', () => {
    expect(isAllowedBrowserOrigin('http://127.0.0.1', '127.0.0.1:80', [80], '127.0.0.1', [])).toBe(
      true,
    );
  });

  it('defaults an origin with no explicit port to 443 for https', () => {
    expect(
      isAllowedBrowserOrigin('https://127.0.0.1', '127.0.0.1:443', [443], '127.0.0.1', []),
    ).toBe(true);
  });
});

describe('isLocalSameOrigin', () => {
  it('is fail-closed when the request carries no headers object at all', () => {
    expect(isLocalSameOrigin({}, PORT, {})).toBe(false);
  });

  it('allows a request with no Origin header when the Host is loopback', () => {
    const req = { headers: { host: `127.0.0.1:${PORT}` } };
    expect(isLocalSameOrigin(req, PORT, {})).toBe(true);
  });

  it('allows a matching same-origin request', () => {
    const req = { headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` } };
    expect(isLocalSameOrigin(req, PORT, {})).toBe(true);
  });

  it('blocks a cross-origin request from an external domain', () => {
    const req = { headers: { host: `127.0.0.1:${PORT}`, origin: 'http://evil.com' } };
    expect(isLocalSameOrigin(req, PORT, {})).toBe(false);
  });

  it('blocks a cross-origin request from another local port', () => {
    const req = { headers: { host: `127.0.0.1:${PORT}`, origin: 'http://127.0.0.1:9999' } };
    expect(isLocalSameOrigin(req, PORT, {})).toBe(false);
  });

  it('is fail-closed when the port is not yet resolved (falsy port)', () => {
    const req = { headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` } };
    expect(isLocalSameOrigin(req, 0, {})).toBe(false);
  });

  it('is fail-closed when the request carries no Host header at all', () => {
    const req = { headers: {} };
    expect(isLocalSameOrigin(req, PORT, {})).toBe(false);
  });

  // Regression coverage for the reverse-proxy escape hatch: the Host header a
  // proxied server sees is the proxy's upstream address, not the browser-visible
  // origin, so the Origin header must be trusted when it exactly matches an
  // explicit JINI_ALLOWED_ORIGINS entry.
  describe('JINI_ALLOWED_ORIGINS bypass for reverse-proxy deployments', () => {
    const ALLOWED = 'http://192.168.8.168:7457';
    const env = { JINI_ALLOWED_ORIGINS: ALLOWED, JINI_BIND_HOST: '0.0.0.0' };

    it('accepts a request whose Origin matches the allow-list even when Host is the proxy upstream', () => {
      const req = { headers: { host: '172.18.0.5:7457', origin: ALLOWED } };
      expect(isLocalSameOrigin(req, 7457, env)).toBe(true);
    });

    it('still rejects an Origin not on the allow-list', () => {
      const req = { headers: { host: '172.18.0.5:7457', origin: 'http://evil.example.com' } };
      expect(isLocalSameOrigin(req, 7457, env)).toBe(false);
    });

    it('requires an exact match (no trailing-slash coercion)', () => {
      const req = { headers: { host: '172.18.0.5:7457', origin: `${ALLOWED}/` } };
      expect(isLocalSameOrigin(req, 7457, env)).toBe(false);
    });
  });

  // Firefox and Chrome omit the Origin header on same-origin GET requests per the
  // Fetch spec; Sec-Fetch-Site is set by the user agent and cannot be forged from
  // JavaScript, so it is the trustworthy signal for extending the allow-list check
  // to a no-Origin request.
  describe('Sec-Fetch-Site fallback for no-Origin same-origin GETs', () => {
    const ALLOWED = 'https://nas.example.ts.net';
    const env = { JINI_ALLOWED_ORIGINS: ALLOWED, JINI_BIND_HOST: '127.0.0.1' };

    it('accepts a no-Origin request whose Host matches the allow-list when Sec-Fetch-Site is same-origin', () => {
      const req = { headers: { host: 'nas.example.ts.net', 'sec-fetch-site': 'same-origin' } };
      expect(isLocalSameOrigin(req, 7456, env)).toBe(true);
    });

    it('rejects when Sec-Fetch-Site is cross-site', () => {
      const req = { headers: { host: 'nas.example.ts.net', 'sec-fetch-site': 'cross-site' } };
      expect(isLocalSameOrigin(req, 7456, env)).toBe(false);
    });

    it('rejects when Sec-Fetch-Site is absent (non-browser / older client)', () => {
      const req = { headers: { host: 'nas.example.ts.net' } };
      expect(isLocalSameOrigin(req, 7456, env)).toBe(false);
    });

    it('does not trust Host alone even with Sec-Fetch-Site: same-origin (Host is forgeable)', () => {
      const req = { headers: { host: 'evil.example.com', 'sec-fetch-site': 'same-origin' } };
      expect(isLocalSameOrigin(req, 7456, env)).toBe(false);
    });
  });
});
