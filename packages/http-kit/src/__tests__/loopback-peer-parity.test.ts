import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isLoopbackPeerAddress } from '@jini-ai/core/net';

/** The decision http-kit's own gates used before core owned it: Node's `net.isIP` as the IPv4 test. */
function viaNodeIsIp(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return false;
  if (normalized.startsWith('::ffff:')) return viaNodeIsIp(normalized.slice('::ffff:'.length));
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (isIP(normalized) === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}

// Core cannot import `node:net`, so it carries a strict dotted-quad regex; this proves the two agree on a wide vector table.
describe('core isLoopbackPeerAddress agrees with the net.isIP-based decision', () => {
  const vectors = [
    '127.0.0.1', '127.255.255.254', '127.0.0.2', '10.0.0.5', '1.127.0.0', '128.0.0.1', '::1', '0:0:0:0:0:0:0:1', '[::1]', '::ffff:127.0.0.1',
    '::FFFF:127.0.0.9', ' 127.0.0.1 ', '[::1', '::1]', '127.0.0.1.evil.com', '127.0.0.1x', 'x127.0.0.1', '127.1', '::2', '::', '::ffff:10.0.0.1',
    '::ffff:', 'localhost', '', '   ', '[]', '0127.0.0.1', '127.000.000.001', '127.0.0.256', '127.0.0.01', '256.0.0.1', '127.0.0.1\n', '1270.0.0.1',
    '0x7f.0.0.1', '2130706433', '127.0.0.1:80', '::ffff:127.0.0.256', 'fe80::1', '::ffff:0127.0.0.1',
    undefined, null, 127, ['127.0.0.1'],
  ];
  it.each(vectors.map((address) => [JSON.stringify(address), address] as const))('%s', (_label, address) => {
    expect(isLoopbackPeerAddress({ address })).toBe(viaNodeIsIp(address));
  });
});
