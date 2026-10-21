import { expect, test } from 'vitest';
import * as node from '../index.js';

test('the ./dns/node entry exposes the resolver, the UDP exchange and the wire codec', () => {
  expect(Object.keys(node).sort()).toEqual([
    'AUTHORITATIVE_DNS_TIMEOUT_MS', 'DNS_RCODE_NXDOMAIN', 'DNS_TYPE_NS', 'createNodeAuthoritativeDnsResolver', 'createUdpDnsExchange', 'decodeNsReply', 'encodeNsQuery',
  ]);
});
