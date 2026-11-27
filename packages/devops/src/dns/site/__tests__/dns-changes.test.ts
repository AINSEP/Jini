import { expect, test, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { domainDnsInstructions, inspectDomainDns, planDomainDns, verifyDomainDns, verifyDueDomainBindings } from '../dns-changes.js';
import { dnsFixture, hostname, mailRequirement, now, ns1, siteRequirement } from './site-dns.fixture.js';
import { providerOk } from "@jini-ai/core/provider-registry";
import { createDnsProviderRegistry } from "../../registry.js";
import { createManualDnsProvider } from "../../manual.js";
import type { DnsProvider } from "../../contract.js";

const request = { hostname, requirements: [siteRequirement] };

test('plans and renders a missing apex record without starting tracking', async () => {
  const f = dnsFixture();
  const { planned, instructions, verification, binding } = await inspectDomainDns(request, f.deps);
  expect(planned).toMatchObject({ hostname, providerId: 'manual', zone: hostname, zoneFound: true, blockers: [], plan: {
    inventory: 'complete', changes: [{ op: 'create', after: { name: hostname, type: 'A', values: ['192.0.2.18'] } }],
  } });
  expect(instructions.rows).toMatchObject([{ action: 'add', type: 'A', name: hostname, host: '@', value: '192.0.2.18' }]);
  expect(verification).toMatchObject({ state: 'pending' });
  expect(binding).toBeNull();
  expect(await f.bindings.get({ hostname })).toBeNull();
});

test('no discovered zone still yields copyable instructions but never claims current inventory', async () => {
  const f = dnsFixture({ ns: {} });
  const { planned, instructions } = await domainDnsInstructions(request, f.deps);
  expect(planned).toMatchObject({ zone: hostname, zoneFound: false, delegation: null, plan: { inventory: 'unknown' } });
  expect(planned.blockers).toContainEqual(expect.objectContaining({ code: 'zone_not_found', name: hostname }));
  expect(instructions.rows).toMatchObject([{ action: 'add', host: '@', type: 'A', value: '192.0.2.18' }]);
});

test('rejects requirements served by a delegated child or outside the zone before reading records', async () => {
  const child = `child.${hostname}`;
  const outside = 'outside.example.net';
  const f = dnsFixture({ ns: { [hostname]: [ns1], [child]: ['ns.child.test'] } });
  const action = planDomainDns({ hostname, requirements: [{ ...siteRequirement, records: [
    { type: 'A', name: outside, value: '192.0.2.17' }, { type: 'A', name: child, value: '192.0.2.18' },
  ] }] }, f.deps);
  await expect(action).rejects.toBeInstanceOf(ToolInputError);
  await expect(action).rejects.toHaveProperty('message', `dns_plan: ${outside} (outside it), ${child} (served by the delegated zone ${child}) is not in the zone ${hostname} that serves ${hostname}; plan and verify each zone separately.`);
  expect(f.resolver.queries).toEqual([`NS ${hostname}`, `NS ${child}`]);
});

test('checks CAA above a delegated child using the parent zone inventory', async () => {
  const f = dnsFixture({ ns: { [hostname]: [ns1], 'example.test': ['ns.parent.test'] }, records: {
    'ns.parent.test|example.test|CAA': ['0 issue "other-ca.test"'],
  } });
  const result = await planDomainDns({ hostname, requirements: [{ ...siteRequirement, caa: { issuer: 'expected-ca.test' } }] }, f.deps);
  expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'caa_excludes_issuer', name: hostname }));
  expect(f.resolver.queries).toContain('ns.parent.test example.test CAA');
});

test('tracking persists a pending check then a due sweep marks its exact record propagated', async () => {
  const f = dnsFixture();
  const first = await verifyDomainDns(request, f.deps);
  expect(first.binding).toMatchObject({ hostname, status: 'pending', attempt: 0, version: 1, startedAt: now, nextCheckAt: '2026-11-27T20:00:30.000Z', lastCheckedAt: now });
  expect(await f.bindings.get({ hostname })).toEqual(first.binding);
  f.records[`${hostname}|A`] = ['192.0.2.18'];
  const sweepNow = '2026-11-27T20:00:30.000Z';
  expect(await verifyDueDomainBindings({ limit: 5 }, { ...f.deps, now: () => Date.parse(sweepNow) })).toEqual([hostname]);
  expect(f.bindings.listDue.mock.calls).toEqual([[{ now: sweepNow, limit: 5 }]]);
  expect(await f.bindings.get({ hostname })).toMatchObject({
    status: 'propagated', version: 2, attempt: 1, nextCheckAt: null, lastCheckedAt: sweepNow,
    lastResult: { state: 'propagated', records: [{ type: 'A', name: hostname, value: '192.0.2.18', state: 'propagated' }] },
  });
});

test('a lost CAS reads the winning requirement instead of saving stale DNS evidence', async () => {
  const f = dnsFixture();
  const first = await verifyDomainDns(request, f.deps);
  const winner = { ...first.binding, version: 2, requirements: [{ ...siteRequirement, records: [{ type: 'A' as const, name: hostname, value: '192.0.2.22' }] }] };
  await f.bindings.put({ binding: winner, now, expectedVersion: 1 });
  f.bindings.get.mockResolvedValueOnce(first.binding);
  f.records[`${hostname}|A`] = ['192.0.2.22'];
  const result = await verifyDomainDns({ hostname }, f.deps);
  expect(result.binding).toMatchObject({ version: 3, status: 'propagated', requirements: winner.requirements });
  expect(f.bindings.put.mock.calls.slice(-2).map(([request]) => request.expectedVersion)).toEqual([1, 2]);
  expect(await f.bindings.get({ hostname })).toEqual(result.binding);
});

test('a binding still losing every CAS reports exhaustion without inserting a row', async () => {
  const f = dnsFixture();
  f.bindings.put.mockResolvedValue(false);
  const result = verifyDomainDns(request, f.deps);
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toHaveProperty('message', `dns_verify: ${hostname} kept changing while it was being checked (3 attempts); try again.`);
  expect(f.bindings.put.mock.calls.map(([request]) => request.expectedVersion)).toEqual([null, null, null]);
  expect(await f.bindings.get({ hostname })).toBeNull();
});

test('an explicitly empty requirements list does not silently reuse a tracked binding', async () => {
  const f = dnsFixture();
  await verifyDomainDns(request, f.deps);
  f.resolver.queries.length = 0;
  await expect(planDomainDns({ hostname, requirements: [] }, f.deps)).rejects.toMatchObject({
    constructor: ToolInputError,
    message: `dns_plan: no DNS requirements are saved for ${hostname}; pass requirements (the records the host or mail provider asked for).`,
  });
  expect(f.resolver.queries).toEqual([]);
  expect((await f.bindings.get({ hostname }))?.requirements).toEqual([siteRequirement]);
});

test('an uninstalled DNS provider cannot silently reroute a saved binding to the manual provider', async () => {
  const f = dnsFixture();
  const { binding } = await verifyDomainDns(request, f.deps);
  await f.bindings.put({ binding: { ...binding, version: binding.version + 1, providerId: 'uninstalled' }, now, expectedVersion: 1 });
  f.resolver.queries.length = 0;
  await expect(planDomainDns({ hostname }, f.deps)).rejects.toMatchObject({
    constructor: ToolInputError, message: `dns_plan: the DNS provider 'uninstalled' saved for ${hostname} is not installed.`,
  });
  expect(f.resolver.queries).toEqual([]);
});

test('planning renders the host blocker when a discovered zone is not delegated or delegation is unreadable', async () => {
  for (const [answer, code, state, message] of [
    ['nxdomain', 'not_delegated', 'not_delegated', `${hostname} has no NS delegation in its parent zone.`],
    ['timeout', 'delegation_unknown', 'unknown', `The delegation of ${hostname} could not be read: DNS lookup failed.`],
  ] as const) {
    const f = dnsFixture({ ns: { [hostname]: answer } });
    const findZone = vi.fn<DnsProvider['findZone']>().mockResolvedValue(providerOk({ value: { zone: hostname, ref: 'provider-zone-7' } }));
    const listRecords = vi.fn<DnsProvider['listRecords']>(() => { throw new Error('Undelegated zone must not be read'); });
    const provider: DnsProvider = { ...createManualDnsProvider({ resolver: f.resolver }), id: 'managed', findZone, listRecords };
    const registry = createDnsProviderRegistry({ resolver: f.resolver }, { seed: [provider] });
    const { binding } = await verifyDomainDns(request, f.deps);
    await f.bindings.put({ binding: { ...binding, version: 2, providerId: 'managed' }, now, expectedVersion: 1 });
    const result = await planDomainDns({ hostname }, { ...f.deps, registry });
    expect(result).toMatchObject({ providerId: 'managed', zoneFound: true, delegation: { state }, plan: { inventory: 'unknown', changes: [] } });
    expect(result.blockers).toContainEqual({ name: hostname, code, message });
    expect(findZone).toHaveBeenCalledExactlyOnceWith(f.deps.context, { hostname });
    expect(listRecords).not.toHaveBeenCalled();
  }
});

test('dns instructions include provider mail records and a monitoring hint using the real planner', async () => {
  const f = dnsFixture();
  const mailRequirements = vi.fn(async () => mailRequirement);
  const result = await domainDnsInstructions({ ...request, include: ['mail'] }, { ...f.deps, mailRequirements });
  expect(mailRequirements).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws' });
  expect(result.instructions.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'A', host: '@', value: '192.0.2.18' }),
    expect.objectContaining({ type: 'MX', host: '@', value: 'mx.mail.test', priority: 17, ttl: 120 }),
    expect.objectContaining({ type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=none' }),
  ]));
  expect(result.instructions.rows).toHaveLength(3);
  expect(await f.bindings.get({ hostname })).toBeNull();
});

test('tracking times out at the 48-hour cap and an explicit retry starts a fresh window', async () => {
  const f = dnsFixture();
  await verifyDomainDns(request, f.deps);
  const expiredAt = '2026-11-29T20:00:00.000Z';
  const ports = { ...f.deps, now: () => Date.parse(expiredAt) };
  const expired = await verifyDomainDns({ hostname }, ports);
  expect(expired.binding).toMatchObject({ status: 'timeout', attempt: 1, version: 2, startedAt: now, nextCheckAt: null, lastCheckedAt: expiredAt });
  const retry = await verifyDomainDns({ hostname }, ports);
  expect(retry.binding).toMatchObject({ status: 'pending', attempt: 0, version: 3, startedAt: expiredAt, nextCheckAt: '2026-11-29T20:00:30.000Z' });
  expect(await f.bindings.get({ hostname })).toEqual(retry.binding);
});

test('the scheduled sweep skips a binding when its save loses a concurrent version change', async () => {
  const f = dnsFixture();
  const { binding } = await verifyDomainDns(request, f.deps);
  f.bindings.put.mockResolvedValueOnce(false);
  const sweepNow = '2026-11-27T20:00:30.000Z';
  expect(await verifyDueDomainBindings({ limit: 1 }, { ...f.deps, now: () => Date.parse(sweepNow) })).toEqual([]);
  expect(f.bindings.put.mock.calls.at(-1)?.[0]).toMatchObject({ expectedVersion: 1, now: sweepNow });
  expect(await f.bindings.get({ hostname })).toEqual(binding);
});

test('providers without their own instructions get canonical rows for the tracked zone', async () => {
  const f = dnsFixture();
  const { instructions: _instructions, ...provider } = createManualDnsProvider({ resolver: f.resolver });
  const registry = createDnsProviderRegistry({ resolver: f.resolver }, { seed: [{ ...provider, id: 'generic' }] });
  const { binding } = await verifyDomainDns(request, f.deps);
  await f.bindings.put({ binding: { ...binding, providerId: 'generic', version: 2 }, now, expectedVersion: 1 });
  expect(await domainDnsInstructions({ hostname }, { ...f.deps, registry })).toMatchObject({
    planned: { providerId: 'generic', zone: hostname },
    instructions: { zone: hostname, rows: [{ name: hostname, type: 'A', host: '@', action: 'add', value: '192.0.2.18' }] },
  });
  expect((await f.bindings.get({ hostname }))?.version).toBe(2);
});
