import { describe, expect, it } from 'vitest';
import { classifyAddressLiteral, expandIpv6 } from '../endpoint-policy.js';

// F1 fix wave (Stryker L1 §4 net/endpoint-policy.ts:68 `fill<1`, :78 dotted-tail regex anchors,
// :83 octet validation): each case breaks exactly one rule of the IPv6/embedded-IPv4 grammar.
describe('expandIpv6 — grammar edges', () => {
  it.each<[string, number[] | null]>([
    // `::` standing for exactly ONE zero group is legal (fill === 1).
    ['1:2:3::5:6:7:8', [1, 2, 3, 0, 5, 6, 7, 8]],
    ['::2:3:4:5:6:7:8', [0, 2, 3, 4, 5, 6, 7, 8]],
    ['1:2:3:4:5:6:7::', [1, 2, 3, 4, 5, 6, 7, 0]],
    // `::` with eight explicit groups leaves nothing to fill (fill === 0) → invalid.
    ['1:2:3:4::5:6:7:8', null],
    ['1::2::3', null],
    ['1:2:3:4:5:6:7', null],
    ['1:2:3:4:5:6:7:8:9', null],
    ['12345::1', null],
    ['g::1', null],
    // embedded dotted IPv4 tail
    ['::ffff:1.2.3.4', [0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]],
    ['::ffff:255.255.255.255', [0, 0, 0, 0, 0, 0xffff, 0xffff, 0xffff]],
    ['::ffff:1.2.3.256', null],
    ['::ffff:256.1.1.1', null],
    ['::ffff:1.2.3.4.5', null],
    ['::ffff:1.2.3.4x', null],
    ['::ffff:x1.2.3.4', null],
    ['::ffff:1.2.3', null],
    ['::ffff:1.2.3.1234', null],
    // zone id is ignored; case is folded
    ['FE80::1%eth0', [0xfe80, 0, 0, 0, 0, 0, 0, 1]],
    ['no-colon', null],
  ])('%s → %j', (address, expected) => {
    expect(expandIpv6({ address })).toEqual(expected);
  });
});

describe('classifyAddressLiteral — embedded IPv4 cannot be smuggled past the classifier', () => {
  it.each<[string, string | null]>([
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:169.254.169.254', 'link-local'],
    ['::ffff:8.8.8.8', 'public'],
    ['::ffff:127.0.0.1.5', null],
    ['::ffff:127.0.0.256', null],
  ])('%s → %s', (address, expected) => {
    expect(classifyAddressLiteral({ address })).toBe(expected);
  });
});
