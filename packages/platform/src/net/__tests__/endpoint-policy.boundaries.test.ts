import { describe, expect, it } from 'vitest';
import { isBlockedExternalApiHostname, isLoopbackApiHost } from '../endpoint-policy.js';

// Pins edges of the browser-safe literal policy not already covered by the
// contract table, retaining dc606bf5's canonical-byte classification.

const BLOCKED: ReadonlyArray<readonly [string, boolean]> = [
  ['1.0.0.0', false], ['9.255.255.255', false], ['11.0.0.0', false],
  ['100.0.0.1', false], ['169.0.0.1', false], ['172.0.0.1', false], ['192.0.0.1', false],
  ['127.0.0.1', false], ['00010.0.0.1', false], ['10.0.0.01', true], ['10.-1.0.1', false],
  ['fbff::1', false], ['fc00::1', true], ['FDFF::1', true], ['fe00::1', false],
  ['fe80::1%eth0', true], ['fe8::1', false], ['fc0::1', false],
  ['[[::ffff:a00:1]]', false], ['::FFFF:10.0.0.1', true], ['::ffff:0:0', true],
  ['::ffff:ac1f:ffff', true], ['::ffff:ac20:0', false], ['::ffff:a00', true], ['::ffff:', false],
  ['::ffff:1.2.3', false],
];

const LOOPBACK: ReadonlyArray<readonly [string, boolean]> = [
  ['127.0.0.1.', true], ['128.0.0.1', false], ['126.255.255.255', false],
  ['::ffff:7fff:ffff', true], ['::ffff:8000:0', false], ['::ffff:7e00:0', false],
  ['LocalHost', true], ['[localhost]', true], ['0:0:0:0:0:0:0:1', true],
];

describe('endpoint-policy boundary pins', () => {
  it.each(BLOCKED)('classifies %j as blocked=%s', (hostname, expected) => {
    expect(isBlockedExternalApiHostname({ hostname })).toBe(expected);
  });
  it.each(LOOPBACK)('classifies %j as loopback=%s', (hostname, expected) => {
    expect(isLoopbackApiHost({ hostname })).toBe(expected);
  });
  // Expanded mapped, compatible and multicast literals share the same byte
  // classification as the strict Node adapter, without doing DNS here.
  it.each(['0:0:0:0:0:ffff:a00:1', '::a00:1', '::10.0.0.1', 'ff02::1'])(
    'blocks non-public IPv6 literal %j regardless of spelling',
    hostname => {
      expect(isBlockedExternalApiHostname({ hostname })).toBe(true);
    },
  );
});
