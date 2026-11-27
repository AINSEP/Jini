import { expect, test, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { DomainDnsInputError } from '@jini-ai/core/net/public-dns-vocabulary';
import { buildDomainDnsRegistrations, toolInputPublicNames, type DomainDnsToolDeps } from '../tools.js';
import { dnsFixture, hostname, runTool } from './site-dns.fixture.js';

import { publicNames } from './site-dns.fixture.js';

test('both public-name readers preserve validation causes but do not reclassify infrastructure errors', () => {
  const badName = new DomainDnsInputError({ message: 'DNS owner cannot be a URL' });
  const offline = new Error('validator offline');
  const names = toolInputPublicNames({ validators: {
    readPublicDomain: () => { throw offline; },
    readPublicDnsName: () => { throw badName; },
  } });
  const input = { value: 'https://studio.example.test', errorPrefix: 'dns_plan' };
  expect(() => names.readPublicDnsName(input)).toThrowError(ToolInputError);
  expect(() => names.readPublicDnsName(input)).toThrowError(expect.objectContaining({ message: badName.message, cause: badName }));
  expect(() => names.readPublicDomain(input)).toThrowError(offline);
});

function fixture() {
  const f = dnsFixture();
  const lookup = vi.fn<ReturnType<DomainDnsToolDeps['createChecks']>['lookupDns']>().mockResolvedValue({ name: hostname, queries: [{ type: 'MX', records: [] }] });
  const compare = vi.fn<ReturnType<DomainDnsToolDeps['createChecks']>['checkDns']>().mockResolvedValue({ status: 'unknown', expectedHost: null });
  const tls = vi.fn<ReturnType<DomainDnsToolDeps['createChecks']>['tlsStatus']>().mockResolvedValue({ domain: hostname, status: 'verified', httpStatus: 404 });
  const createChecks: DomainDnsToolDeps['createChecks'] = ({ authorize }) => ({
    async lookupDns(required, options) { await authorize({ operation: 'lookup-dns' }); return lookup(required, options); },
    async checkDns(required, options) { await authorize({ operation: 'check-dns' }); return compare(required, options); },
    async tlsStatus(required) { await authorize({ operation: 'tls-status' }); return tls(required); },
  });
  return { ...f, lookup, compare, tls, regs: buildDomainDnsRegistrations({ ...f.deps, createChecks, publicNames }) };
}

test('lookup, TLS and DNS comparison forward their own options and permission scopes', async () => {
  const f = fixture();
  expect(await runTool(f.regs, 'domain_lookup_dns', { domain: hostname, types: ['MX'] })).toEqual({ name: hostname, queries: [{ type: 'MX', records: [] }] });
  expect(await runTool(f.regs, 'domain_tls_status', { domain: hostname })).toEqual({ domain: hostname, status: 'verified', httpStatus: 404 });
  expect(await runTool(f.regs, 'domain_check_dns', { domain: hostname, expectedHost: 'current.example.test' })).toEqual({
    status: 'unknown', expectedHost: null, reason: 'No independent hosting hostname is saved. Connect a publish destination or publish the site first.',
  });
  expect(f.lookup.mock.calls).toEqual([[{ domain: hostname }, { types: ['MX'] }]]);
  expect(f.tls.mock.calls).toEqual([[{ domain: hostname }]]);
  expect(f.compare.mock.calls).toEqual([[{ domain: hostname }, { expectedHost: 'current.example.test' }]]);
  expect(f.authorize.mock.calls).toEqual(['content.read', 'content.read', 'deployments.read', 'publish_content.read'].map(permission => [
    { permission, workspaceId: 'ws', principalId: 'operator', entityType: 'domain-dns' },
  ]));
  f.compare.mockResolvedValueOnce({ status: 'unknown', expectedHost: 'current.example.test' });
  expect(await runTool(f.regs, 'domain_check_dns', { domain: hostname })).toEqual({ status: 'unknown', expectedHost: 'current.example.test' });
});

test('blocks a DNS comparison when publish-content permission is denied, and wraps only input errors', async () => {
  const f = fixture();
  f.authorize.mockResolvedValueOnce({ allowed: true, reason: 'allowed' }).mockResolvedValueOnce({ allowed: false, reason: 'no grant' });
  await expect(runTool(f.regs, 'domain_check_dns', { domain: hostname })).rejects.toMatchObject({
    message: "principal 'operator' is not authorized for 'publish_content.read' (no grant)",
  });
  expect(f.compare.mock.calls).toEqual([]);
  const invalid = new DomainDnsInputError({ message: 'Owner name is invalid' });
  f.lookup.mockRejectedValueOnce(invalid);
  const result = runTool(f.regs, 'domain_lookup_dns', { domain: hostname });
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toMatchObject({ message: 'Owner name is invalid', cause: invalid });
  const offline = new Error('resolver offline');
  f.lookup.mockRejectedValueOnce(offline);
  await expect(runTool(f.regs, 'domain_lookup_dns', { domain: hostname })).rejects.toBe(offline);
});
