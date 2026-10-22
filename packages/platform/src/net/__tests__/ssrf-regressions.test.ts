import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../address.js';
import { isBlockedExternalApiHostname, isLoopbackApiHost } from '../endpoint-policy.js';
import { classifyAddress } from '../../http/guarded/client.js';

const EMBEDDED = [
  ['0.0.0.2', 'reserved'],
  ['10.0.0.1', 'private'],
  ['100.64.0.1', 'private'],
  ['127.0.0.1', 'loopback'],
  ['169.254.169.254', 'link-local'],
  ['224.0.0.1', 'reserved'],
  ['8.8.8.8', 'public'],
] as const;

describe.each(['::ffff:', '::ffff:0:', '::', '64:ff9b::'])('embedded IPv4 prefix %s', prefix => {
  it.each(EMBEDDED)('classifies %s as %s before and after URL normalization', (ipv4, addressClass) => {
    const literal = `${prefix}${ipv4}`;
    const canonical = new URL(`https://[${literal}]/`).hostname.slice(1, -1);
    for (const address of [literal, canonical]) {
      expect(classifyAddress({ ip: address })).toBe(addressClass);
      expect(isPrivateAddress({ address })).toBe(addressClass !== 'public');
      // Configured local model endpoints deliberately retain the loopback exception.
      expect(isBlockedExternalApiHostname({ hostname: address })).toBe(addressClass !== 'public' && addressClass !== 'loopback');
      expect(isLoopbackApiHost({ hostname: address })).toBe(addressClass === 'loopback');
    }
  });
});

it.each([
  ['::ffff:0:a00:1', 'private'],
  ['0:0:0:0:0:ffff:a00:1', 'private'],
  ['0:0:0:0:ffff:0:a00:1', 'private'],
  ['0064:ff9b:0:0:0:0:a00:1', 'private'],
  ['64:ff9b::808:808', 'public'],
  ['64:ff9b:0:1::a00:1', 'public'], // outside the /96 translation prefix
  ['::a00:1', 'private'],
  ['::2', 'reserved'],
  ['::0.0.0.2', 'reserved'],
  ['ff00::', 'reserved'],
  ['ff02::1', 'reserved'],
  ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
  ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'public'],
  ['2002:a00:1::', 'private'], // 6to4 tunnel to 10.0.0.1
  ['2002:a9fe:a9fe::1', 'link-local'], // 6to4 tunnel to cloud metadata
  ['2002:808:808::1', 'public'],
  ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'reserved'], // Teredo
  ['2001:4860:4860::8888', 'public'], // outside Teredo 2001::/32
  ['64:ff9b:1::a00:1', 'reserved'], // local-use NAT64
  ['2002:A9FE:A9FE::%eth0', 'link-local'], // uppercase hex and a zone id still classify by bytes
] as const)('classifies IPv6 literal %s as %s across both policies', (address, addressClass) => {
  expect(classifyAddress({ ip: address })).toBe(addressClass);
  expect(isPrivateAddress({ address })).toBe(addressClass !== 'public');
  expect(isBlockedExternalApiHostname({ hostname: `[${address}]` })).toBe(addressClass !== 'public');
});
