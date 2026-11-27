import { expect, test, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { buildDnsChangeRegistrations, contributeDomainDnsAndChangeTools, readDnsChangeInput } from '../dns-tools.js';
import { dnsFixture, hostname, publicNames, runTool, now } from './site-dns.fixture.js';

const aRecord = { type: 'A', name: hostname, value: '192.0.2.18' };
const request = { hostname, requirements: [{ purpose: 'site', records: [aRecord] }] };

test('normalizes all DNS names, defaults the purpose owner, and preserves optional record data', () => {
  const result = readDnsChangeInput({ errorPrefix: 'dns_plan', publicNames, input: {
    hostname: 'STUDIO.EXAMPLE.TEST.', include: ['mail'], requirements: [
      request.requirements[0], { purpose: 'mail', domain: 'STUDIO.EXAMPLE.TEST.', providerId: 'custom-mail', caa: { issuer: 'ca.example' }, records: [
        { type: 'MX', name: 'STUDIO.EXAMPLE.TEST.', value: 'mx.example.test', ttl: 86400, priority: 0, note: 'Inbound' },
        { type: 'TXT', name: 'SELECTOR._DOMAINKEY.STUDIO.EXAMPLE.TEST.', value: 'public-key' },
      ] },
    ],
  } });
  expect(result).toEqual({ hostname, include: ['mail'], requirements: [
    { purpose: 'site', providerId: 'site', domain: hostname, records: [aRecord] },
    { purpose: 'mail', providerId: 'custom-mail', domain: hostname, caa: { issuer: 'ca.example' }, records: [
      { type: 'MX', name: hostname, value: 'mx.example.test', ttl: 86400, priority: 0, note: 'Inbound' },
      { type: 'TXT', name: `selector._domainkey.${hostname}`, value: 'public-key' },
    ] },
  ] });
  expect(readDnsChangeInput({ errorPrefix: 'dns_plan', publicNames, input: { hostname } })).toEqual({ hostname });
});

test('each malformed input is refused before permission checks and DNS reads', async () => {
  const f = dnsFixture();
  const regs = buildDnsChangeRegistrations({ ...f.deps, publicNames });
  const invalidRequirements = [null, [], Array(11).fill(request.requirements[0]), [null], [{ purpose: 'storage', records: [aRecord] }],
    [{ purpose: 'site', records: [] }], [{ purpose: 'site', records: Array(51).fill(aRecord) }],
    [{ purpose: 'site', records: [aRecord], providerId: 'x'.repeat(65) }],
    ...[null, {}, { issuer: '' }, { issuer: 'a'.repeat(254) }].map(caa => [{ purpose: 'site', records: [aRecord], caa }]),
  ];
  const cases: Array<[unknown, RegExp]> = [
    [null, /^input must be an object$/], [{ ...request, hostname: 'https://studio.example.test' }, /^dns_plan: expected a hostname$/],
    ...invalidRequirements.map((requirements): [unknown, RegExp] => [{ hostname, requirements }, /^dns_plan: requirements must be 1-10 objects/]),
    ...[null, [], ['site'], ['mail', 'mail']].map((include): [unknown, RegExp] => [{ ...request, include }, /^dns_plan: include must be \["mail"\]\.$/]),
    ...[null, ...[{ type: 'AXFR' }, { value: false }, { value: '' }, { value: 'x'.repeat(4097) }, { ttl: 59 }, { ttl: 86401 }, { ttl: 60.5 }, { priority: -1 }, { priority: 65536 }, { note: 'x'.repeat(201) }]
      .map(field => ({ ...aRecord, ...field }))].map((record): [unknown, RegExp] => [
      { hostname, requirements: [{ purpose: 'site', records: [record] }] }, /^dns_plan: each requirement record needs type/,
    ]),
  ];
  for (const [input, message] of cases) {
    const result = runTool(regs, 'dns_plan', input);
    await expect(result).rejects.toBeInstanceOf(ToolInputError);
    await expect(result).rejects.toHaveProperty('message', expect.stringMatching(message));
  }
  expect(f.authorize.mock.calls).toEqual([]);
  expect(f.resolver.queries).toEqual([]);
});

test('plan and instructions are read-only while verify saves the normalized request', async () => {
  const f = dnsFixture();
  const regs = buildDnsChangeRegistrations({ ...f.deps, publicNames });
  expect(await runTool(regs, 'dns_plan', request)).toMatchObject({
    hostname, inventory: 'complete', blockers: [], untrusted: true,
    next: 'Nothing is applied automatically: use dns_instructions for the rows to enter, then dns_verify.',
  });
  expect(await runTool(regs, 'dns_instructions', request)).toMatchObject({
    hostname, zone: hostname, untrusted: true, rows: [{ name: hostname, action: 'add', host: '@', type: 'A', value: '192.0.2.18' }],
  });
  expect(await f.bindings.get({ hostname })).toBeNull();
  expect(await runTool(regs, 'dns_verify', request)).toMatchObject({
    hostname, zone: hostname, status: 'pending', attempt: 0, startedAt: now, nextCheckAt: '2026-11-27T20:00:30.000Z',
    records: [{ ...aRecord, status: 'Missing', state: 'pending' }], untrusted: true,
  });
  expect(await f.bindings.get({ hostname })).toMatchObject({ requirements: [{ providerId: 'site', domain: hostname, records: [aRecord] }], status: 'pending' });
  expect(f.authorize.mock.calls).toEqual(['deployments.read', 'deployments.read', 'deployments.publish'].map(permission => [
    { permission, workspaceId: 'ws', principalId: 'operator', entityType: 'domain-dns' },
  ]));
});

test('no zone yields blocker guidance and no store prevents verification', async () => {
  const f = dnsFixture({ ns: {} });
  const { bindings: _unused, ...deps } = f.deps;
  const regs = buildDnsChangeRegistrations({ ...deps, publicNames });
  expect(await runTool(regs, 'dns_plan', request)).toMatchObject({
    zoneFound: false, delegation: null, inventory: 'unknown',
    next: 'Resolve the blockers first; dns_instructions still lists the required records.',
  });
  const result = runTool(regs, 'dns_verify', request);
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toHaveProperty('message', "dns_verify: this site has no content database to keep the domain's tracking state in.");
});

test('the domain contributor assembles all tools with independent read and write risk declarations', () => {
  const f = dnsFixture();
  const createChecks = vi.fn(() => { throw new Error('registration must not start checks'); });
  const routeDeps = { route: 'site-7' };
  const createDeps = vi.fn((_route: typeof routeDeps) => ({ ...f.deps, publicNames, createChecks }));
  const createDnsDeps = vi.fn((_route: typeof routeDeps) => f.deps);
  const contributor = contributeDomainDnsAndChangeTools({ createDeps, createDnsDeps });
  expect(createDeps).not.toHaveBeenCalled();
  const regs = contributor.build(routeDeps, {});
  expect(createDeps.mock.calls).toEqual([[routeDeps]]);
  expect(createDnsDeps.mock.calls).toEqual([[routeDeps]]);
  const expected = [
    ['domain_lookup_dns', 'none'], ['domain_check_dns', 'none'], ['domain_tls_status', 'none'],
    ['dns_plan', 'none'], ['dns_instructions', 'none'], ['dns_verify', 'mutates-durable-state'],
    ['mail_dns_status', 'none'], ['mail_dns_verify', 'mutates-durable-state'],
  ];
  expect(regs.map(({ descriptor }) => descriptor.id)).toEqual(expected.map(([id]) => id));
  expect([...contributor.risk]).toEqual(expected);
  expect(createChecks.mock.calls).toEqual([]);
});
