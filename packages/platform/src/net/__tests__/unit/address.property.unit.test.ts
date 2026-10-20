import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classifyIpAddress, isPrivateAddress } from '../../address.js';
import { classifyAddressLiteral, isBlockedExternalApiHostname, isLoopbackApiHost } from '../../endpoint-policy.js';
import type { AddressClass } from '../../endpoint-policy.js';

const seed = Number(process.env.FC_SEED ?? 20261020);
const options = { seed, numRuns: 150 };
const octet = fc.integer({ min: 0, max: 255 });
const ipv4 = fc.tuple(octet, octet, octet, octet).map(bytes => bytes.join('.'));
const embedded = (ip: string): string[] => [`::ffff:${ip}`, `::ffff:0:${ip}`, `64:ff9b::${ip}`];
const canonical = (ip: string): string => new URL(`https://[${ip}]/`).hostname.slice(1, -1);

beforeAll(() => console.info(`[fast-check platform/address] seed=${seed}, numRuns=${options.numRuns}`));

describe('address classification properties', () => {
  it('expanded, padded, uppercase and URL-canonical IPv6 spellings agree', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 65535 })), { minLength: 8, maxLength: 8 }), groups => {
      const expanded = groups.map(group => group.toString(16).padStart(4, '0')).join(':');
      const expected = classifyAddressLiteral({ address: expanded });
      expect(expected).not.toBeNull();
      for (const address of [expanded, expanded.toUpperCase(), canonical(expanded)]) {
        expect(classifyIpAddress({ ip: address })).toBe(expected);
        expect(classifyAddressLiteral({ address })).toBe(expected);
      }
    }), options);
  });

  it('mapped, translated and NAT64 dotted/hex tails retain the IPv4 classification', () => {
    fc.assert(fc.property(ipv4, ip => {
      const expected = classifyIpAddress({ ip });
      for (const address of embedded(ip).flatMap(address => [address, canonical(address)])) {
        expect(classifyIpAddress({ ip: address })).toBe(expected);
        expect(classifyAddressLiteral({ address })).toBe(expected);
      }
    }), options);
  });

  // Expectations come from network ranges, not another call to the classifier under test.
  const blockedRanges: [AddressClass, fc.Arbitrary<[number, number, number, number]>][] = [
    ['private', fc.tuple(fc.constant(10), octet, octet, octet)],
    ['private', fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), octet, octet)],
    ['private', fc.tuple(fc.constant(192), fc.constant(168), octet, octet)],
    ['private', fc.tuple(fc.constant(100), fc.integer({ min: 64, max: 127 }), octet, octet)],
    ['loopback', fc.tuple(fc.constant(127), octet, octet, octet)],
    ['link-local', fc.tuple(fc.constant(169), fc.constant(254), octet, octet)],
  ];
  it.each(blockedRanges)('refuses %s IPv4 ranges and every embedded spelling (%#)', (expected, bytes) => {
    fc.assert(fc.property(bytes, parts => {
      const ip = parts.join('.');
      const [a, b, c, d] = parts;
      const sixToFour = `2002:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}::1`;
      const variants = [...embedded(ip), `::${ip}`, sixToFour];
      for (const address of [ip, ...variants.flatMap(address => [address, canonical(address)])]) {
        expect(classifyIpAddress({ ip: address })).toBe(expected);
        expect(classifyAddressLiteral({ address })).toBe(expected);
        expect(isPrivateAddress({ address })).toBe(true);
        // Browser-configured local servers deliberately retain a loopback exception.
        const hostname = address.includes(':') ? `[${address}]` : address;
        expect(isLoopbackApiHost({ hostname })).toBe(expected === 'loopback');
        expect(isBlockedExternalApiHostname({ hostname })).toBe(expected !== 'loopback');
      }
    }), options);
  });

  it('refuses native ULA/link-local, local-use NAT64 and Teredo regardless of tail', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 65535 }), { minLength: 7, maxLength: 7 }), tail => {
      for (const address of [
        `fc${(tail[0]! & 255).toString(16).padStart(2, '0')}:${tail.slice(1).map(n => n.toString(16)).join(':')}:1`,
        `fe${(128 + (tail[0]! & 63)).toString(16)}:${tail.slice(1).map(n => n.toString(16)).join(':')}:1`,
        `64:ff9b:1:${tail.slice(0, 5).map(n => n.toString(16)).join(':')}`,
        `2001:0:${tail.slice(0, 6).map(n => n.toString(16)).join(':')}`,
        '::1',
      ]) {
        expect(isPrivateAddress({ address })).toBe(true);
        expect(classifyAddressLiteral({ address })).not.toBeNull();
        expect(classifyAddressLiteral({ address })).not.toBe('public');
        expect(classifyIpAddress({ ip: canonical(address) })).toBe(classifyAddressLiteral({ address }));
      }
    }), options);
  });

  it('continues to allow public IPv4 peers and their embedded forms', () => {
    fc.assert(fc.property(octet, octet, (a, b) => {
      const ip = `8.8.${a}.${b}`;
      for (const address of [ip, ...embedded(ip)]) {
        expect(classifyIpAddress({ ip: address })).toBe('public');
        expect(isPrivateAddress({ address })).toBe(false);
      }
    }), options);
  });
});
