import { expect, test, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { createManualDnsProvider } from '../../manual.js';
import { withMailRequirements, type MailRequirementsPort } from '../mail-requirements.js';
import { dnsFixture, hostname, mailRequirement, siteRequirement } from './site-dns.fixture.js';

const dmarcName = `_dmarc.${hostname}`;
const hint = { purpose: 'mail', domain: hostname, providerId: 'dmarc-hint', records: [{
  type: 'TXT', name: dmarcName, value: 'v=DMARC1; p=none', note: 'DMARC in monitoring mode; tighten the policy once reports look clean.',
}] };
const providerDmarc = { type: 'TXT' as const, name: dmarcName, value: 'v=DMARC1; p=reject' };

function fixture(records: NonNullable<Parameters<typeof dnsFixture>[0]>['records'] = {}, ns?: NonNullable<Parameters<typeof dnsFixture>[0]>['ns']) {
  const f = dnsFixture({ records, ...(ns ? { ns } : {}) });
  const mailRequirements = vi.fn<MailRequirementsPort>().mockResolvedValue({ ...mailRequirement, domain: 'STUDIO.EXAMPLE.TEST.' });
  const ports = { provider: createManualDnsProvider({ resolver: f.resolver }), context: f.deps.context, mailRequirements };
  return { ...f, ports, mailRequirements };
}

test('refreshes stale mail requirements and adds one monitoring hint only when needed', async () => {
  const f = fixture();
  const staleMail = { ...mailRequirement, records: [{ ...mailRequirement.records[0]!, value: 'old.mx.test' }] };
  const staleHint = { ...mailRequirement, providerId: 'dmarc-hint' };
  const requirements = [staleMail, siteRequirement, staleHint];
  const next = await withMailRequirements({ hostname, requirements, errorPrefix: 'dns_plan' }, f.ports);
  expect(next).toEqual([siteRequirement, mailRequirement, hint]);
  expect(await withMailRequirements({ hostname, requirements: next, errorPrefix: 'dns_plan' }, f.ports)).toEqual(next);
  expect(f.mailRequirements.mock.calls).toEqual([[{ workspaceId: 'ws' }], [{ workspaceId: 'ws' }]]);
  expect(requirements).toEqual([staleMail, siteRequirement, staleHint]);
});

test('preserves published DMARC by removing only the provider DMARC request', async () => {
  const f = fixture({ [`${dmarcName}|TXT`]: ['unrelated-verification', ' V=DMARC1; p=quarantine'] });
  f.mailRequirements.mockResolvedValueOnce({ ...mailRequirement, records: [providerDmarc, ...mailRequirement.records] });
  expect(await withMailRequirements({ hostname, requirements: [siteRequirement], errorPrefix: 'dns_verify' }, f.ports)).toEqual([siteRequirement, mailRequirement]);
  f.mailRequirements.mockResolvedValueOnce({ ...mailRequirement, records: [providerDmarc] });
  expect(await withMailRequirements({ hostname, requirements: [siteRequirement], errorPrefix: 'dns_verify' }, f.ports)).toEqual([siteRequirement]);
});

test('does not add a monitoring hint when DMARC is unreadable or requested by the provider', async () => {
  const f = fixture({ [`${dmarcName}|TXT`]: 'timeout' });
  expect(await withMailRequirements({ hostname, requirements: [], errorPrefix: 'dns_plan' }, f.ports)).toEqual([mailRequirement]);
  const noZone = fixture({}, {});
  expect(await withMailRequirements({ hostname, requirements: [], errorPrefix: 'dns_plan' }, noZone.ports)).toEqual([mailRequirement]);
  const readable = fixture();
  const requested = { ...mailRequirement, records: [providerDmarc, ...mailRequirement.records] };
  readable.mailRequirements.mockResolvedValue(requested);
  expect(await withMailRequirements({ hostname, requirements: [], errorPrefix: 'dns_plan' }, readable.ports)).toEqual([requested]);
});

test('refuses unavailable and unrelated sender requirements before reading DNS', async () => {
  const f = fixture();
  const required = { hostname, requirements: [], errorPrefix: 'dns_plan' };
  for (const [port, message] of [
    [undefined, "dns_plan: this site cannot report its mail provider's DNS records."],
    [async () => null, "dns_plan: no mail DNS records are available: choose a transactional mail provider that verifies sending domains (mail_set_provider), save its key, and set the site's sender address (core.mail.senderEmail)."],
    [async () => ({ ...mailRequirement, domain: `not-${hostname}` }), `dns_plan: the sender domain not-${hostname} is outside ${hostname}; plan it with hostname not-${hostname} instead.`],
  ] as const) {
    const { mailRequirements: _unused, ...dns } = f.ports;
    const result = withMailRequirements(required, { ...dns, ...(port ? { mailRequirements: port } : {}) });
    await expect(result).rejects.toBeInstanceOf(ToolInputError);
    await expect(result).rejects.toHaveProperty('message', message);
  }
  expect(f.resolver.queries).toEqual([]);
});
