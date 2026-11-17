import { describe, expect, it } from 'vitest';
import { isLoopbackPeerAddress } from '../index.js';

describe('isLoopbackPeerAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '127.0.0.2', '::1', '0:0:0:0:0:0:0:1', '[::1]', '::ffff:127.0.0.1', '::FFFF:127.0.0.9',
    ' 127.0.0.1 ', '[::1', '::1]',
  ])('trusts %j', (address) => {
    expect(isLoopbackPeerAddress({ address })).toBe(true);
  });
  it.each([
    '10.0.0.127', '1.127.0.0', '128.0.0.1', '126.255.255.255', '127.0.0.1.evil.com', '127.0.0.1x', 'x127.0.0.1', '127.1',
    '::2', '::', '::ffff:10.0.0.1', '::ffff:', 'localhost', '', '   ', '[]', '12[7.0.0.1', '::]1', '[[::1]]', '0.0.0.0',
  ])('refuses look-alike %j', (address) => {
    expect(isLoopbackPeerAddress({ address })).toBe(false);
  });
  it.each([undefined, null, 127, ['127.0.0.1'], { address: '127.0.0.1' }])('refuses non-string %j', (address) => {
    expect(isLoopbackPeerAddress({ address })).toBe(false);
  });
});

describe('isLoopbackPeerAddress: the bare and mapped forms', () => {
  it('accepts a bare IPv4 loopback address, its IPv4-mapped IPv6 form, and IPv6 loopback bracketed or not', () => {
    for (const address of ['127.0.0.1', '::ffff:127.0.0.1', '::1', '[::1]']) expect(isLoopbackPeerAddress({ address })).toBe(true);
  });
  it('rejects non-loopback IPv4 and IPv6 addresses and a value that is not an address', () => {
    for (const address of ['10.0.0.5', 'fe80::1', 'not-an-ip', undefined, '']) expect(isLoopbackPeerAddress({ address })).toBe(false);
  });
  it('rejects leading-zero octets, which the runtime does not read as IPv4 either', () => {
    expect(isLoopbackPeerAddress({ address: '0127.0.0.1' })).toBe(false);
    expect(isLoopbackPeerAddress({ address: '127.000.000.001' })).toBe(false);
  });
});
