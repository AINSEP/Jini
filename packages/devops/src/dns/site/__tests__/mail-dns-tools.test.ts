import { expect, test } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { buildMailDnsRegistrations } from '../mail-dns-tools.js';
import { dnsFixture, hostname, mailRequirement, runTool } from './site-dns.fixture.js';

test('mail status exposes the provider verdict while authorized verify starts tracking', async () => {
  const f = dnsFixture();
  const verdict = { state: 'pending', domain: hostname, providerId: 'mailer' } as const;
  const regs = buildMailDnsRegistrations({ ...f.deps, mailRequirements: async () => mailRequirement, senderDomainVerification: async () => verdict });
  expect(regs.map(({ descriptor }) => [descriptor.id, descriptor.inputSchema])).toEqual([
    ['mail_dns_status', { type: 'object', additionalProperties: false, properties: {} }],
    ['mail_dns_verify', { type: 'object', additionalProperties: false, properties: {} }],
  ]);
  expect(await runTool(regs, 'mail_dns_status', {})).toMatchObject({
    state: 'checked', providerVerification: verdict, dns: { hostname, persisted: false, tracking: null },
  });
  expect(await f.bindings.get({ hostname })).toBeNull();
  expect(await runTool(regs, 'mail_dns_verify', {})).toMatchObject({
    state: 'checked', providerVerification: verdict, dns: { hostname, persisted: true, tracking: { status: 'pending' } },
  });
  expect(await f.bindings.get({ hostname })).toMatchObject({ status: 'pending', requirements: [mailRequirement, { providerId: 'dmarc-hint' }] });
  expect(f.authorize.mock.calls).toEqual(['deployments.read', 'deployments.publish'].map(permission => [
    { permission, principalId: 'operator', workspaceId: 'ws', entityType: 'domain-dns' },
  ]));
});

test('mail tools reject non-object input and deny tracking without write permission', async () => {
  const f = dnsFixture();
  const regs = buildMailDnsRegistrations(f.deps);
  for (const id of ['mail_dns_status', 'mail_dns_verify']) {
    const result = runTool(regs, id, null);
    await expect(result).rejects.toBeInstanceOf(ToolInputError);
    await expect(result).rejects.toHaveProperty('message', 'input must be an object');
  }
  expect(f.authorize.mock.calls).toEqual([]);
  f.authorize.mockResolvedValueOnce({ allowed: false, reason: 'missing grant' });
  await expect(runTool(regs, 'mail_dns_verify', {})).rejects.toMatchObject({
    message: "principal 'operator' is not authorized for 'deployments.publish' (missing grant)",
  });
  expect(f.resolver.queries).toEqual([]);
  expect(f.bindings.put.mock.calls).toEqual([]);
});
