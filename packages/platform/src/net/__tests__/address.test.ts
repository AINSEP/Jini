import { describe, expect, it } from 'vitest';
import { isPrivateAddress, expandIpv6 } from '../address.js';
// PARITY: the cache's strict IP and parser vectors follow their canonical implementation.
describe('isPrivateAddress', () => {
  // PARITY: retained behavior against the canonical shared implementation.
  it('flags loopback / private / link-local / CGNAT / multicast', () => {
    for (const addr of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12::3',
      'ff02::1',
      'fe80::1', // link-local low end
      'fe90::1', // link-local — was missed by an exact fe80 match
      'febf::1', // link-local high end (fe80::/10)
      '::ffff:127.0.0.1',
      '::ffff:7f00:1', // hex IPv4-mapped 127.0.0.1 (Node normalizes brackets to this)
      '::ffff:0a00:1', // hex IPv4-mapped 10.0.0.1
      '::ffff:a9fe:a9fe', // hex IPv4-mapped 169.254.169.254 (metadata)
      'fe80:0:0:0:0:0:0:1', // link-local, fully expanded — no "::" compression
      'not-an-ip',
    ]) {
      expect(isPrivateAddress({ address: addr })).toBe(true);
    }
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('allows ordinary public addresses', () => {
    for (const addr of [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '2606:4700:4700:0:0:0:0:1111', // same address, fully expanded — no "::" compression
      '::ffff:5db8:d822', // hex IPv4-mapped 93.184.216.34 (public)
    ]) {
      expect(isPrivateAddress({ address: addr })).toBe(false);
    }
  });
});

describe('expandIpv6 (direct — the classifier and guarded client gate calls behind net.isIP(addr) === 6, which already fully validates syntax, so these parse-failure guards are unreachable through that path; exercised directly against the exported function instead)', () => {
  // PARITY: retained behavior against the canonical shared implementation.
  it('rejects an input with no colon at all', () => {
    expect(expandIpv6({ address: 'not-ipv6-shaped' })).toBeNull();
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('rejects an embedded IPv4 tail with an out-of-range octet', () => {
    // net.isIP() would refuse "::999.1.1.1" outright (verified empirically:
    // isIP('::999.1.1.1') === 0), so this can only be reached by calling
    // expandIpv6 directly, bypassing that gate.
    expect(expandIpv6({ address: '::999.1.1.1' })).toBeNull();
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('rejects more than one "::" compression', () => {
    expect(expandIpv6({ address: '1::2::3' })).toBeNull();
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('rejects a group with invalid hex characters', () => {
    expect(expandIpv6({ address: 'gggg::1' })).toBeNull();
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('rejects a group with more than 4 hex digits', () => {
    expect(expandIpv6({ address: '12345::1' })).toBeNull();
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('rejects compression that leaves no room to fill (too many explicit groups)', () => {
    expect(expandIpv6({ address: '1:2:3:4::5:6:7:8' })).toBeNull();
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('rejects an uncompressed address with the wrong total group count', () => {
    expect(expandIpv6({ address: '1:2:3' })).toBeNull();
  });

  // PARITY: retained behavior against the canonical shared implementation.

  it('parses a valid address with an embedded IPv4 tail', () => {
    expect(expandIpv6({ address: '::ffff:127.0.0.1' })).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });
});


// PARITY: compatible IPv6 addresses must receive the same strict SSRF verdict as embedded IPv4.
it.each(['::127.0.0.1', '::7f00:1', '::10.0.0.1', '::a00:1', '::169.254.169.254'])('blocks compatible address %s', address => {
  expect(isPrivateAddress({ address })).toBe(true);
});
// PARITY: widening the parser must not reject compatible public addresses.
it.each(['::8.8.8.8', '::808:808'])('allows compatible public address %s', address => {
  expect(isPrivateAddress({ address })).toBe(false);
});
