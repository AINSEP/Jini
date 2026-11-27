import { expect, test, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import type { SenderDomainVerification } from '@jini-ai/core/contracts/mail';
import { mailDnsRecordStatus, readMailDnsStatus, verifyMailDnsStatus } from '../mail-dns-status.js';
import { dnsFixture, hostname, mailRequirement, now, ns1, ns2, siteRequirement } from './site-dns.fixture.js';
import { verifyDomainDns } from '../dns-changes.js';

const verdict = { state: 'verified', domain: hostname, providerId: 'mailer' } as const;

test('shows per-server mail DNS evidence separately from the provider verdict without saving', async () => {
  const f = dnsFixture({ records: { [`${ns1}|${hostname}|MX`]: ['17 mx.mail.test.'],
    [`${ns1}|_dmarc.${hostname}|TXT`]: ['v=DMARC1; p=none'],
  } });
  const mail = vi.fn(async () => ({ ...mailRequirement, domain: 'STUDIO.EXAMPLE.TEST.' }));
  await verifyDomainDns({ hostname, requirements: [siteRequirement] }, f.deps);
  const before = await f.bindings.get({ hostname });
  f.records[`${hostname}|A`] = ['192.0.2.18'];
  const result = await readMailDnsStatus({}, { ...f.deps, mailRequirements: mail, senderDomainVerification: async () => verdict });
  expect(result).toMatchObject({
    state: 'checked', senderDomain: hostname, providerId: 'mailer', providerVerification: verdict, untrusted: true,
    dns: { overall: 'Pending', checkedAt: now, persisted: false, tracking: { status: 'pending', attempt: 0 },
      records: [
        { type: 'A', host: '@', expected: '192.0.2.18', observed: ['192.0.2.18'], status: 'Matches', purpose: 'other' },
        { type: 'MX', host: '@', expected: 'mx.mail.test', observed: ['17 mx.mail.test.'], status: 'Pending', purpose: 'mail',
          priority: 17, ttl: 120, note: 'Inbound verification',
          byNameserver: [{ nameserver: ns2, status: 'Missing', answers: [] }, { nameserver: ns1, status: 'Matches', answers: ['17 mx.mail.test.'] }],
        },
      ] },
  });
  expect(mail.mock.calls).toEqual([[{ workspaceId: 'ws' }]]);
  expect(await f.bindings.get({ hostname })).toEqual(before);
  expect(f.bindings.put).toHaveBeenCalledTimes(1);
});

test('reports no-zone rows as unknown and missing tracking storage as check_failed', async () => {
  const { deps } = dnsFixture({ ns: {} });
  const { bindings: _unused, ...base } = deps;
  const ports = { ...base, mailRequirements: async () => mailRequirement };
  const read = await readMailDnsStatus({}, ports);
  expect(read).toMatchObject({ state: 'checked', dns: {
    overall: 'Unknown', tracking: null, delegation: null, nameservers: [],
    reason: `No DNS zone serving ${hostname} could be found, so its records could not be checked.`,
    records: [{ type: 'MX', name: hostname, expected: 'mx.mail.test', status: 'Unknown', byNameserver: [] }],
    rows: [{ type: 'MX', host: '@', value: 'mx.mail.test', priority: 17 }],
  } });
  expect(await verifyMailDnsStatus({}, ports)).toEqual({
    state: 'check_failed', untrusted: true, senderDomain: hostname, providerId: 'mailer', providerVerification: null,
    message: "this site has no content database to keep the domain's tracking state in.",
  });
});

test('saved mail checks persist only authoritative evidence and return the saved timestamp', async () => {
  const f = dnsFixture({ records: {
    [`${hostname}|MX`]: ['17 mx.mail.test.'],
    [`_dmarc.${hostname}|TXT`]: ['v=DMARC1; p=quarantine'],
  } });
  const result = await verifyMailDnsStatus({}, { ...f.deps, mailRequirements: async () => mailRequirement });
  expect(result).toMatchObject({ state: 'checked', dns: {
    persisted: true, checkedAt: now, overall: 'Matches',
    tracking: { status: 'propagated', attempt: 0, nextCheckAt: null, lastCheckedAt: now, startedAt: now },
    records: [{ type: 'MX', status: 'Matches', purpose: 'mail' }],
  } });
  expect(result.dns?.rows).toBeUndefined();
  expect(await f.bindings.get({ hostname })).toMatchObject({ version: 1, requirements: [mailRequirement], status: 'propagated', lastCheckedAt: now });
});

test('no-record states distinguish missing sender, missing provider, unsupported and provider refusal', async () => {
  const { deps } = dnsFixture();
  const cases: Array<[SenderDomainVerification, string, string | null, string]> = [
    [{ state: 'no_sender', providerId: 'mailer' }, 'no_sender', null, "Set the site's sender address first; its domain is the one that needs mail DNS records."],
    [{ state: 'no_provider', domain: hostname, providerId: null }, 'no_provider', hostname, 'Choose a transactional mail provider first; its records depend on which provider sends.'],
    [{ state: 'unsupported', domain: hostname, providerId: 'mailer' }, 'verification_unavailable', hostname, 'DNS verification is unavailable for this provider: it publishes no domain records to check.'],
    [{ state: 'unknown', domain: hostname, providerId: 'mailer', reason: 'Domain access denied' }, 'requirements_unavailable', hostname, 'Domain access denied'],
  ];
  for (const [provider, state, senderDomain, message] of cases) {
    expect(await readMailDnsStatus({}, { ...deps, senderDomainVerification: async () => provider, mailRequirements: async () => null }))
      .toEqual({ state, senderDomain, message, providerId: provider.providerId, providerVerification: provider, untrusted: true });
  }
});

test('requirement failures retain caller-safe details and hide unexpected errors', async () => {
  const { deps } = dnsFixture();
  const provider = { state: 'unknown', reason: 'Generic provider status', providerId: 'mailer' } as const;
  for (const [error, message] of [
    [new ToolInputError({ message: 'Reconnect mail first' }), 'Reconnect mail first'],
    [new Error('internal account token'), 'The mail provider could not list its required DNS records.'],
  ] as const) {
    expect(await readMailDnsStatus({}, { ...deps, senderDomainVerification: async () => provider, mailRequirements: async () => { throw error; } }))
      .toEqual({ state: 'requirements_failed', senderDomain: null, providerId: 'mailer', providerVerification: provider, untrusted: true, message });
  }
  expect(await verifyMailDnsStatus({}, deps)).toEqual({
    state: 'requirements_unavailable', senderDomain: null, providerId: null, providerVerification: null, untrusted: true,
    message: "This server cannot report its mail provider's DNS records.",
  });
});

test('only pending records become TimedOut; mismatched and unread answers retain their status', () => {
  expect(mailDnsRecordStatus({ record: { state: 'pending', byNameserver: [] }, timedOut: true })).toBe('TimedOut');
  expect(mailDnsRecordStatus({ record: { state: 'mismatch', byNameserver: [] }, timedOut: true })).toBe('Mismatch');
  expect(mailDnsRecordStatus({ record: { state: 'unknown', byNameserver: [] }, timedOut: true })).toBe('Unknown');
});
