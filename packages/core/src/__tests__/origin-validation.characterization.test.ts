import { describe, expect, it, vi } from 'vitest';

import {
  assertValidAllowedOrigins,
  configuredAllowedOrigins,
  isAllowedBrowserHost,
  isAllowedBrowserOrigin,
  isIpLiteralHostname,
  isLocalSameOrigin,
  isPrivateIpv4,
  type OriginValidationEnvConfig,
} from '../origin-validation.js';

// Characterization pins for the SEC refactor of origin-validation.ts: every decision the
// refactor touches is pinned, and a generated truth table (snapshot recorded on the pre-refactor
// code) proves the restructured gate decides identically over IPv4/IPv6/hostname edge cases,
// ports, schemes and malformed values.

const CONFIG: OriginValidationEnvConfig = {
  allowedOriginsEnvVar: 'FAKE_ALLOWED_ORIGINS',
  webPortEnvVar: 'FAKE_WEB_PORT',
  bindHostEnvVar: 'FAKE_BIND_HOST',
};

const HOSTNAMES: unknown[] = [
  undefined, null, '', ' ', 0, 10, '10.0.0.1', ' 10.0.0.1', '10.0.0.1 ', '010.0.0.1', '10.0.0', '10.0.0.1.1',
  '10.0.0.256', '10.0.0.-1', '10.0.0.1e0', '1e1.0.0.1', '99999999999999999999.0.0.1', '10..0.1',
  '172.15.255.255', '172.16.0.0', '172.31.255.255', '172.32.0.0', '192.167.1.1', '192.168.0.1', '192.169.0.1',
  '169.254.0.1', '169.253.0.1', '169.255.0.1', '11.0.0.1', '127.0.0.1', '0.0.0.0', '255.255.255.255',
  'localhost', 'LOCALHOST', '::1', '[::1]', '::', '[::]', '[fe80::1]', '[', ']', '[]', 'example.com', 'a.b.c.d',
];

const HOST_HEADERS: unknown[] = [
  undefined, '', 'localhost:3000', '127.0.0.1:3000', '[::1]:3000', '0.0.0.0:3000', '192.168.1.5:3000',
  '192.168.1.5:4000', '192.168.1.5', 'example.com:3000', 'proxy.example', '10.1.2.3:443', 'bad host:3000',
  ['localhost:3000', 'evil.example:3000'], [null], 'LOCALHOST:3000', 'localhost:5173',
];

const ORIGINS: unknown[] = [
  undefined, '', 'null', 'http://localhost:3000', 'https://localhost:3000', 'http://127.0.0.1:3000/',
  'http://[::1]:3000', 'http://192.168.1.5:3000', 'http://192.168.1.5', 'https://10.1.2.3', 'http://10.1.2.3:443',
  'https://proxy.example', 'http://example.com:3000', 'ftp://localhost:3000', 'file:///etc', 'not a url',
  'http://evil@localhost:3000', 'http://localhost:5173', 'http://0.0.0.0:3000', 'HTTP://LOCALHOST:3000',
];

const ENVS: Array<Record<string, string | undefined>> = [
  {},
  { FAKE_WEB_PORT: '5173', FAKE_BIND_HOST: '0.0.0.0' },
  { FAKE_ALLOWED_ORIGINS: 'https://proxy.example, http://10.1.2.3:443, bad-entry, http://192.168.1.5' },
  { FAKE_ALLOWED_ORIGINS: 'http://example.com:3000', FAKE_WEB_PORT: '3000', FAKE_BIND_HOST: 'example.com' },
];

const PORTS: Array<number | string | null | undefined> = [3000, '443', null, 80];
const FETCH_SITES: unknown[] = [undefined, 'same-origin', 'cross-site', ['same-origin']];

const bit = (value: boolean): string => (value ? '1' : '0');

describe('@jini-ai/core — origin-validation — characterization truth table', () => {
  it('pins isPrivateIpv4 and isIpLiteralHostname over generated hostnames', () => {
    const table = HOSTNAMES.map((hostname) =>
      `${JSON.stringify(hostname)} private=${bit(isPrivateIpv4({ hostname }))} literal=${bit(isIpLiteralHostname({ hostname }))}`);
    expect(table).toMatchSnapshot();
  });

  it('pins isAllowedBrowserHost and isAllowedBrowserOrigin over generated host/origin/port combinations', () => {
    const portSets = [[3000], [3000, 5173], [], [443, 80]];
    const extras = [[], ['https://proxy.example', 'http://192.168.1.5']];
    const table: string[] = [];
    for (const ports of portSets) {
      for (const extraAllowedOrigins of extras) {
        for (const bindHost of ['127.0.0.1', '0.0.0.0', 'example.com']) {
          const hostBits = HOST_HEADERS.map((hostHeader) =>
            bit(isAllowedBrowserHost({ config: CONFIG, hostHeader, ports, bindHost, extraAllowedOrigins }))).join('');
          const originRows = HOST_HEADERS.map((hostHeader) => ORIGINS.map((origin) =>
            bit(isAllowedBrowserOrigin({ config: CONFIG, origin, hostHeader, ports, bindHost, extraAllowedOrigins }))).join(''));
          table.push(`ports=${ports.join(',')} extra=${extraAllowedOrigins.length} bind=${bindHost} host=${hostBits} origin=${originRows.join('|')}`);
        }
      }
    }
    expect(table).toMatchSnapshot();
  });

  it('pins isLocalSameOrigin over generated requests, environments and ports', () => {
    const logger = { warn: vi.fn() };
    const table: string[] = [];
    for (const env of ENVS) {
      for (const port of PORTS) {
        for (const fetchSite of FETCH_SITES) {
          const rows = HOST_HEADERS.map((host) => ORIGINS.map((origin) =>
            bit(isLocalSameOrigin({ config: CONFIG, env, port,
              req: { headers: { host, origin, 'sec-fetch-site': fetchSite } } }, { logger }))).join(''));
          table.push(`env=${JSON.stringify(env)} port=${String(port)} site=${JSON.stringify(fetchSite)} ${rows.join('|')}`);
        }
      }
    }
    expect(table).toMatchSnapshot();
  });

  it('treats a request with no headers object as cross-origin', () => {
    expect(isLocalSameOrigin({ config: CONFIG, env: {}, port: 3000, req: {} })).toBe(false);
  });
});

describe('@jini-ai/core — origin-validation — characterization pins', () => {
  it('names a single invalid entry with the singular noun', () => {
    expect(() => assertValidAllowedOrigins({ config: CONFIG, env: { FAKE_ALLOWED_ORIGINS: 'ftp://x, https://ok.example' } }))
      .toThrow('FAKE_ALLOWED_ORIGINS has 1 invalid entry (must be http:// or https:// origins): ftp://x');
  });

  it('names several invalid entries with the plural noun', () => {
    expect(() => assertValidAllowedOrigins({ config: CONFIG, env: { FAKE_ALLOWED_ORIGINS: 'ftp://x, nope' } }))
      .toThrow('FAKE_ALLOWED_ORIGINS has 2 invalid entries (must be http:// or https:// origins): ftp://x, nope');
  });

  it('accepts the 172.16/12 lower and upper bounds and rejects just outside them', () => {
    expect(['172.15.255.255', '172.16.0.0', '172.31.255.255', '172.32.0.0'].map((hostname) => isPrivateIpv4({ hostname })))
      .toEqual([false, true, true, false]);
  });

  it('does not trim before classifying a private IPv4 but does trim before classifying an IP literal', () => {
    expect(isPrivateIpv4({ hostname: ' 10.0.0.1' })).toBe(false);
    expect(isIpLiteralHostname({ hostname: ' 10.0.0.1 ' })).toBe(true);
  });

  it('echoes a malformed allow-list entry verbatim, credentials included, in the warning (reported, not fixed)', () => {
    // A credential typed into the allow-list without a scheme separator (`user:pass@host`)
    // parses as a `user:` URL, is rejected, and is echoed whole into logs and boot errors.
    const entry = ['user', 'hunter2-not-real'].join(':') + '@proxy.example';
    const warn = vi.fn();
    configuredAllowedOrigins({ config: CONFIG, env: { FAKE_ALLOWED_ORIGINS: entry } }, { logger: { warn } });
    expect(warn).toHaveBeenCalledWith({ message: expect.stringContaining(entry) });
  });
});
