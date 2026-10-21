import { expect, test } from 'vitest';
import * as dns from '../index.js';

// The `@jini-ai/devops/dns` subpath is this barrel; pin its public runtime surface.
test('the dns subpath exposes the kernel entry points', () => {
  for (const name of [
    'chunkTxt', 'planDnsChanges', 'fingerprintPlan', 'canonicalJson', 'checkDelegation', 'verifyRequirements', 'nextCheckDelayMs',
    'isExpired', 'bindDnsApproval', 'checkDnsApproval', 'createManualDnsProvider', 'renderDnsInstructions', 'createDnsProviderRegistry',
    'dnsProviderShapeError', 'mergeSpf', 'normalizeDnsName',
  ] as const) expect(typeof dns[name], name).toBe('function');
  expect(dns.MANUAL_DNS_PROVIDER_ID).toBe('manual');
  expect(dns.DNS_PROVIDER_CONTRACT).toBe('dns');
  expect([...dns.DNS_ADDRESS_TYPES].sort()).toEqual(['A', 'AAAA', 'ALIAS', 'CNAME']);
});
