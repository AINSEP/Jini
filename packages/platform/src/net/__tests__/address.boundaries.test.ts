import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../address.js';

// Pins the first/last address inside, and the neighbour just outside, every
// range the strict SSRF classifier refuses, plus each IPv6 spelling it must
// canonicalize, including the canonical-byte SSRF fixes from dc606bf5.

const IPV4: ReadonlyArray<readonly [string, boolean]> = [
  ['0.0.0.0', true], ['0.255.255.255', true], ['1.0.0.0', false],
  ['9.255.255.255', false], ['10.0.0.0', true], ['10.255.255.255', true], ['11.0.0.0', false],
  ['100.63.255.255', false], ['100.64.0.0', true], ['100.127.255.255', true], ['100.128.0.0', false],
  ['126.255.255.255', false], ['127.0.0.0', true], ['127.255.255.255', true], ['128.0.0.0', false],
  ['169.253.255.255', false], ['169.254.0.0', true], ['169.254.255.255', true], ['169.255.0.0', false],
  ['172.15.255.255', false], ['172.16.0.0', true], ['172.31.255.255', true], ['172.32.0.0', false],
  ['192.167.255.255', false], ['192.168.0.0', true], ['192.168.255.255', true], ['192.169.0.0', false],
  ['223.255.255.255', false], ['224.0.0.0', true], ['255.255.255.255', true],
  ['100.0.0.1', false], ['169.0.0.1', false], ['172.0.0.1', false], ['192.0.0.1', false],
];

const IPV6: ReadonlyArray<readonly [string, boolean]> = [
  ['::', true], ['0:0:0:0:0:0:0:0', true], ['::1', true], ['0:0:0:0:0:0:0:1', true],
  ['::2', true], ['::ffff', true],
  ['fe7f:ffff::1', false], ['fe80::', true], ['febf:ffff::1', true], ['fec0::1', false],
  ['fbff:ffff::1', false], ['fc00::', true], ['fdff:ffff::1', true], ['fe00::1', false],
  ['feff::1', false], ['ff00::', true], ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
  ['FE80::1', true], ['FD12::3', true],
  ['fe80::1%eth0', true], ['2606:4700::1111%eth0', false],
];

const MAPPED: ReadonlyArray<readonly [string, boolean]> = [
  ['::ffff:0.0.0.0', true], ['::ffff:0:0', true], ['::ffff:255.255.255.255', true], ['::ffff:ffff:ffff', true],
  ['::ffff:9.255.255.255', false], ['::ffff:10.0.0.0', true], ['::ffff:11.0.0.0', false],
  ['::ffff:172.15.255.255', false], ['::ffff:ac10:0', true], ['::ffff:ac1f:ffff', true], ['::ffff:ac20:0', false],
  ['::FFFF:7F00:1', true], ['::ffff:127.0.0.1%1', true],
  ['0:0:0:0:0:ffff:a00:1', true], ['0:0:0:0:0:ffff:808:808', false],
  // IPv4-compatible (::/96 minus :: and ::1) — classified by the embedded v4.
  ['::1:0', true], ['::100:0', false], ['::a00:0', true], ['::223.255.255.255', false], ['::e000:0', true],
  ['0:0:0:0:0:0:a00:1', true],
];

const NOT_LITERAL = ['', '[::1]', 'localhost', '010.0.0.1', '1.2.3', '1.2.3.256', '1::2::3'];

describe('isPrivateAddress boundary pins', () => {
  it.each(IPV4)('classifies IPv4 %s as private=%s', (address, expected) => {
    expect(isPrivateAddress({ address })).toBe(expected);
  });
  it.each(IPV6)('classifies IPv6 %s as private=%s', (address, expected) => {
    expect(isPrivateAddress({ address })).toBe(expected);
  });
  it.each(MAPPED)('classifies embedded-IPv4 %s as private=%s', (address, expected) => {
    expect(isPrivateAddress({ address })).toBe(expected);
  });
  it.each(NOT_LITERAL)('refuses non-literal %j (caller must resolve first)', address => {
    expect(isPrivateAddress({ address })).toBe(true);
  });
  // IPv4-translated and well-known NAT64 /96 prefixes inherit their embedded
  // IPv4 range; changing the spelling cannot bypass the strict SSRF check.
  it.each(['::ffff:0:a00:1', '64:ff9b::a00:1', '64:ff9b::7f00:1'])(
    'refuses translated/NAT64 %s carrying non-public IPv4',
    address => {
      expect(isPrivateAddress({ address })).toBe(true);
    },
  );
});
