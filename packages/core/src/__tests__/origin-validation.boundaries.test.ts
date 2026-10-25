import { describe, expect, it, vi } from 'vitest';
import { assertValidAllowedOrigins, configuredAllowedOrigins, isIpLiteralHostname, isLoopbackOrPrivateLanHost, isPrivateIpv4, parseHostHeader } from '../origin-validation.js';

/** L2 §8.9: every private range is pinned by its neighbours (one outside each edge), dotted-quad
 *  grammar is anchored, and blank/padded allow-lists are handled the same by both parsers. */
describe('isPrivateIpv4 range edges', () => {
  it.each(['10.0.0.0', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '169.254.0.1', '169.254.255.255'])('%s is private', (hostname) => {
    expect(isPrivateIpv4({ hostname })).toBe(true);
  });
  it.each(['9.255.255.255', '11.0.0.0', '172.15.255.255', '172.32.0.0', '192.167.255.255', '192.169.0.0', '191.168.0.1', '169.253.0.1', '169.255.0.1', '168.254.0.1', '8.8.8.8', '127.0.0.1'])('%s is NOT private', (hostname) => {
    expect(isPrivateIpv4({ hostname })).toBe(false);
  });
  it.each(['10.0.0', '10.0.0.0.1', '10.0.0.256', '10.0.0.x', ' 10.0.0.1', '10.0.0.1 ', '10.0.0.-1', '10.0.0.1e0', '0x0a.0.0.1', '', null, undefined, 10])('malformed %j is NOT private', (hostname) => {
    expect(isPrivateIpv4({ hostname })).toBe(false);
  });
});

describe('isIpLiteralHostname / isLoopbackOrPrivateLanHost', () => {
  it.each([['1.2.3.4', true], ['[::1]', true], [' [fe80::1] ', true], ['[::1', false], ['::1]', false], ['1.2.3.256', false], ['example.com', false], ['', false], ['   ', false], [null, false]])('ip literal %j → %s', (hostname, expected) => {
    expect(isIpLiteralHostname({ hostname })).toBe(expected);
  });
  it.each([['LOCALHOST', true], ['127.0.0.1', true], ['::1', true], ['[::1]', true], ['0.0.0.0', true], ['::', true], ['192.168.1.1', true], ['127.0.0.2', false], ['localhost.evil.com', false], ['8.8.8.8', false], ['', false]])('loopback/LAN %j → %s', (hostname, expected) => {
    expect(isLoopbackOrPrivateLanHost({ hostname })).toBe(expected);
  });
});

describe('parseHostHeader', () => {
  it.each([
    ['example.com:8080', { hostname: 'example.com', host: 'example.com:8080', port: '8080' }],
    ['  example.com  ', { hostname: 'example.com', host: 'example.com', port: '80' }],
    [['a.test:1', 'b.test:2'], { hostname: 'a.test', host: 'a.test:1', port: '1' }],
  ])('%j → %j', (value, expected) => {
    expect(parseHostHeader({ value })).toEqual(expected);
  });
  it.each(['', '   ', null, undefined, 'bad host:99999', '[::1'])('%j → null', (value) => {
    expect(parseHostHeader({ value })).toBeNull();
  });
});

describe('allow-list splitting', () => {
  const config = { allowedOriginsEnvVar: 'ORIGINS', webPortEnvVar: 'W', bindHostEnvVar: 'B' };
  it.each([undefined, '', '   ', ' , ,, '])('blank list %j yields nothing and boots fine', (raw) => {
    const env = { ORIGINS: raw };
    expect(configuredAllowedOrigins({ config, env })).toEqual([]);
    expect(() => assertValidAllowedOrigins({ config, env })).not.toThrow();
  });
  it('trims each entry, drops a malformed one with a warning naming it, and keeps the rest', () => {
    const warn = vi.fn();
    const env = { ORIGINS: '  https://a.test , ftp://b.test,http://c.test:8080 ' };
    expect(configuredAllowedOrigins({ config, env }, { logger: { warn } })).toEqual(['https://a.test', 'http://c.test:8080']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({ message: '[@jini-ai/core] ignoring malformed ORIGINS entry (must be an http:// or https:// origin): ftp://b.test' });
  });
  it('boot validation names every malformed entry with singular/plural wording', () => {
    expect(() => assertValidAllowedOrigins({ config, env: { ORIGINS: 'ftp://x' } })).toThrow('ORIGINS has 1 invalid entry (must be http:// or https:// origins): ftp://x');
    expect(() => assertValidAllowedOrigins({ config, env: { ORIGINS: 'ftp://x, nope ,https://ok.test' } })).toThrow('ORIGINS has 2 invalid entries (must be http:// or https:// origins): ftp://x, nope');
  });
});
