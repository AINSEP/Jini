import { describe, expect, it } from 'vitest';
import { isLoopbackApiHost, isBlockedExternalApiHostname } from '../address.js';
describe('isLoopbackApiHost', () => {
  // PARITY: copied literal-host policy vector.
  it('recognizes localhost and ::1', () => {
    expect(isLoopbackApiHost({ hostname: 'localhost' })).toBe(true);
    expect(isLoopbackApiHost({ hostname: '::1' })).toBe(true);
    expect(isLoopbackApiHost({ hostname: '[::1]' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('recognizes 127.0.0.0/8', () => {
    expect(isLoopbackApiHost({ hostname: '127.0.0.1' })).toBe(true);
    expect(isLoopbackApiHost({ hostname: '127.255.255.255' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('is case-insensitive and strips a trailing dot (FQDN form)', () => {
    expect(isLoopbackApiHost({ hostname: 'LOCALHOST.' })).toBe(true);
    expect(isLoopbackApiHost({ hostname: '127.0.0.1.' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('recognizes IPv4-mapped IPv6 loopback (dotted and hex forms)', () => {
    expect(isLoopbackApiHost({ hostname: '::ffff:127.0.0.1' })).toBe(true);
    expect(isLoopbackApiHost({ hostname: '::ffff:7f00:1' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackApiHost({ hostname: 'example.com' })).toBe(false);
    expect(isLoopbackApiHost({ hostname: '10.0.0.1' })).toBe(false);
    expect(isLoopbackApiHost({ hostname: '::ffff:10.0.0.1' })).toBe(false);
  });

  // PARITY: copied literal-host policy vector.

  it('rejects a malformed IPv4-mapped hex form', () => {
    expect(isLoopbackApiHost({ hostname: '::ffff:zzzz:1' })).toBe(false);
    expect(isLoopbackApiHost({ hostname: '::ffff:1:2:3' })).toBe(false);
  });

  // PARITY: copied literal-host policy vector.

  it('treats an out-of-range IPv4 octet as not a valid IPv4 address at all', () => {
    expect(isLoopbackApiHost({ hostname: '999.0.0.1' })).toBe(false);
  });
});

describe('isBlockedExternalApiHostname', () => {
  // PARITY: copied literal-host policy vector.
  it('blocks the unspecified IPv6 address', () => {
    expect(isBlockedExternalApiHostname({ hostname: '::' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('blocks RFC1918 / link-local / CGNAT / multicast IPv4 ranges', () => {
    expect(isBlockedExternalApiHostname({ hostname: '0.0.0.0' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '100.64.0.1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '100.127.255.255' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '169.254.1.1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '10.1.2.3' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '192.168.1.1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '172.16.0.1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '172.31.255.255' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: '224.0.0.1' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('does not block a normal public IPv4 address', () => {
    expect(isBlockedExternalApiHostname({ hostname: '8.8.8.8' })).toBe(false);
    expect(isBlockedExternalApiHostname({ hostname: '172.32.0.1' })).toBe(false);
    expect(isBlockedExternalApiHostname({ hostname: '100.63.0.1' })).toBe(false);
    expect(isBlockedExternalApiHostname({ hostname: '100.128.0.1' })).toBe(false);
  });

  // PARITY: copied literal-host policy vector.

  it('blocks unique-local and link-local IPv6', () => {
    expect(isBlockedExternalApiHostname({ hostname: 'fc00::1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: 'fd12::1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: 'fe80::1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: 'fe90::1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: 'fea0::1' })).toBe(true);
    expect(isBlockedExternalApiHostname({ hostname: 'feb0::1' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('does not block a normal public IPv6 address', () => {
    expect(isBlockedExternalApiHostname({ hostname: '2001:4860:4860::8888' })).toBe(false);
  });

  // PARITY: copied literal-host policy vector.

  it('blocks an IPv4-mapped blocked address', () => {
    expect(isBlockedExternalApiHostname({ hostname: '::ffff:10.0.0.1' })).toBe(true);
  });

  // PARITY: copied literal-host policy vector.

  it('does not block a hostname that is not a recognizable IP literal', () => {
    expect(isBlockedExternalApiHostname({ hostname: 'example.com' })).toBe(false);
  });
});

