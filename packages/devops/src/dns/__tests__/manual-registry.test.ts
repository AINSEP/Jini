import { describe, expect, test } from 'vitest';
import { ProviderRegistryError } from '@jini-ai/core/provider-registry';
import { providerOk } from '@jini-ai/core/provider-registry';
import type { DnsPlanRequirement, DnsProvider, DnsRecord } from '../contract.js';
import { createManualDnsProvider, MANUAL_DNS_PROVIDER_ID, relativeHost, renderDnsInstructions } from '../manual.js';
import { planDnsChanges } from '../plan.js';
import { AuthoritativeDnsToken, createDnsProviderRegistry, dnsProviderDefinition, dnsProviderShapeError, DnsProviderRegistryToken } from '../registry.js';
import { ctx, fakeResolver, plan } from './fakes.js';

const ns = { 'example.test': ['ns1.host.test', 'ns2.host.test'] };

describe('manual provider: zones', () => {
  test('finds the most specific delegated zone, including a delegated subzone', async () => {
    const resolver = fakeResolver({ ns: { ...ns, 'dev.example.test': ['ns.other.test'], 'app.dev.example.test': [] } });
    const provider = createManualDnsProvider({ resolver });
    expect(await provider.findZone(ctx, { hostname: 'App.Dev.Example.Test.' })).toEqual(providerOk({ value: { zone: 'dev.example.test', ref: 'dev.example.test' } }));
    expect(await provider.findZone(ctx, { hostname: 'www.example.test' })).toEqual(providerOk({ value: { zone: 'example.test', ref: 'example.test' } }));
    expect(resolver.queries).not.toContain('NS test');
  });

  test('skips public suffixes and returns null when nothing is delegated', async () => {
    const resolver = fakeResolver({ ns: { 'co.test': ['ns.registry.test'] } });
    const provider = createManualDnsProvider({ resolver }, { isPublicSuffix: ({ name }) => name === 'co.test' });
    expect(await provider.findZone(ctx, { hostname: 'shop.co.test' })).toEqual(providerOk({ value: null }));
    expect(resolver.queries).toEqual(['NS shop.co.test']);
  });

  test('a transport failure is returned as unknown, not as "no zone"', async () => {
    const provider = createManualDnsProvider({ resolver: fakeResolver({ ns: { 'www.example.test': 'timeout' } }) });
    expect(await provider.findZone(ctx, { hostname: 'www.example.test' })).toMatchObject({ status: 'unknown' });
  });
});

describe('manual provider: listing', () => {
  test('reads every planner type at each name from an authoritative server', async () => {
    const resolver = fakeResolver({ ns, ttl: 120, records: {
      'www.example.test|A': ['192.0.2.1'],
      'www.example.test|TXT': ['"v=spf1 " "-all"'],
      'www.example.test|MX': ['10 mx.test.', 'junk'],
      'www.example.test|CAA': ['junk'],
      'www.example.test|AAAA': 'nxdomain',
    } });
    const provider = createManualDnsProvider({ resolver });
    const result = await provider.listRecords(ctx, { zoneRef: 'example.test', names: ['WWW.example.test.'] });
    expect(result).toEqual(providerOk({ value: { inventory: 'complete', records: [
      { name: 'www.example.test', type: 'A', ttl: 120, values: ['192.0.2.1'] },
      { name: 'www.example.test', type: 'TXT', ttl: 120, values: ['v=spf1 -all'] },
      { name: 'www.example.test', type: 'MX', ttl: 120, values: [{ priority: 10, exchange: 'mx.test' }] },
    ] } }));
    expect(resolver.queries.filter(query => query.startsWith('ns1.host.test'))).toHaveLength(6);
  });

  test('an unreadable answer makes the inventory unknown instead of inventing a conflict', async () => {
    const provider = createManualDnsProvider({ resolver: fakeResolver({ ns, records: { 'www.example.test|A': ['192.0.2.1'], 'www.example.test|CAA': 'refused' } }) });
    const result = await provider.listRecords(ctx, { zoneRef: 'example.test', names: ['www.example.test'] });
    expect(result).toMatchObject({ status: 'ok', value: { inventory: 'unknown' } });
  });

  test('no readable nameservers means an unknown, empty inventory', async () => {
    for (const answer of ['timeout', []] as const) {
      const provider = createManualDnsProvider({ resolver: fakeResolver({ ns: { 'example.test': answer } }) });
      expect(await provider.listRecords(ctx, { zoneRef: 'example.test', names: ['www.example.test'] })).toEqual(providerOk({ value: { records: [], inventory: 'unknown' } }));
    }
  });

  test('declares itself non-automatic without apply', () => {
    const provider = createManualDnsProvider({ resolver: fakeResolver({}) }, { label: 'By hand' });
    expect(provider).toMatchObject({ id: MANUAL_DNS_PROVIDER_ID, label: 'By hand', credentialKeys: [], capabilities: { automatic: false, apexFlattening: false, proxy: false } });
    expect(provider.apply).toBeUndefined();
    expect(createManualDnsProvider({ resolver: fakeResolver({}) }).label).toBe('Manual (any DNS host)');
  });
});

describe('manual instructions', () => {
  const requirement = (records: DnsPlanRequirement['records']): DnsPlanRequirement => ({ purpose: 'site', domain: 'example.test', providerId: 'host', records });

  test('renders add/change/remove rows with relative hosts, priorities and an apex note', () => {
    const current: DnsRecord[] = [
      { name: 'example.test', type: 'A', ttl: 300, values: ['192.0.2.9'] },
      { name: 'mail.example.test', type: 'MX', ttl: 300, values: [{ priority: 10, exchange: 'old.mx.test' }] },
    ];
    const computed = planDnsChanges({ providerId: 'manual', zone: 'example.test', current, inventory: 'complete', requirements: [requirement([
      { type: 'CNAME', name: 'example.test', value: 'target.host.test' },
      { type: 'MX', name: 'mail.example.test', value: 'new.mx.test', priority: 20 },
      { type: 'CAA', name: 'example.test', value: '0 issue "ca.test"' },
    ])] }, { apexFlattening: true });
    const provider = createManualDnsProvider({ resolver: fakeResolver({}) });
    const instructions = provider.instructions?.({ plan: computed });
    expect(instructions?.rows).toEqual([
      { action: 'remove', type: 'A', name: 'example.test', host: '@', value: '192.0.2.9', ttl: 300 },
      { action: 'change', type: 'MX', name: 'mail.example.test', host: 'mail', value: 'old.mx.test', ttl: 300, priority: 10 },
      { action: 'change', type: 'MX', name: 'mail.example.test', host: 'mail', value: 'new.mx.test', ttl: 300, priority: 20 },
      { action: 'add', type: 'CNAME', name: 'example.test', host: '@', value: 'target.host.test', ttl: 300 },
      { action: 'add', type: 'CAA', name: 'example.test', host: '@', value: '0 issue "ca.test"', ttl: 300 },
    ]);
    expect(instructions?.notes.join('\n')).toMatch(/serves example.test[\s\S]*ALIAS[\s\S]*complete final set/);
  });

  test('chunks long TXT values and lists blockers with suggestions', () => {
    const long = 'k'.repeat(300);
    const computed = planDnsChanges({ providerId: 'manual', zone: 'example.test', current: [], inventory: 'complete', requirements: [requirement([
      { type: 'TXT', name: 'dkim._domainkey.example.test', value: long },
      { type: 'TXT', name: 'short.example.test', value: 'tiny' },
      { type: 'CNAME', name: 'example.test', value: 'x.test' },
    ])] });
    const rendered = renderDnsInstructions({ plan: computed });
    expect(rendered.rows.map(row => row.value)).toEqual([`"${'k'.repeat(255)}" "${'k'.repeat(45)}"`, 'tiny']);
    expect(rendered.rows[0]?.host).toBe('dkim._domainkey');
    expect(rendered.notes).toContain('Blocked: example.test is the zone apex; this DNS host cannot serve a CNAME there. Use an ALIAS record or A/AAAA records at the apex, or a DNS host that flattens apex CNAMEs.');
    const noSuggestion = renderDnsInstructions({ plan: plan({ providerId: 'manual', zone: 'example.test', changes: [], preserved: [], inventory: 'complete', blockers: [{ code: 'multiple_spf', name: 'example.test', message: 'Two SPF.' }] }) });
    expect(noSuggestion.notes).toContain('Blocked: Two SPF.');
  });

  test('an unread zone still shows the required records, with a warning', () => {
    const requirements = [requirement([{ type: 'A', name: 'www.example.test.', value: '192.0.2.1', ttl: 60 }, { type: 'MX', name: 'example.test', value: 'mx.test' }, { type: 'CAA', name: 'example.test', value: 'bad' }])];
    const blocked = planDnsChanges({ providerId: 'manual', zone: 'example.test', current: [], requirements, inventory: 'unknown' });
    const rendered = renderDnsInstructions({ plan: blocked }, { requirements });
    expect(rendered.rows).toEqual([
      { action: 'add', type: 'A', name: 'www.example.test', host: 'www', value: '192.0.2.1', ttl: 60 },
      { action: 'add', type: 'MX', name: 'example.test', host: '@', value: 'mx.test', ttl: 300, priority: 10 },
    ]);
    expect(rendered.notes.join('\n')).toMatch(/could not be read/);
    expect(renderDnsInstructions({ plan: blocked }).rows).toEqual([]);
  });

  test('relative hosts: apex, child, and an out-of-zone name kept whole', () => {
    expect(relativeHost({ name: 'example.test', zone: 'example.test' })).toBe('@');
    expect(relativeHost({ name: 'a.b.example.test', zone: 'example.test' })).toBe('a.b');
    expect(relativeHost({ name: 'elsewhere.test', zone: 'example.test' })).toBe('elsewhere.test');
  });
});

describe('DNS provider registry', () => {
  const resolver = fakeResolver({});
  const automatic: DnsProvider = {
    id: 'cloud_dns', label: 'Cloud DNS', credentialKeys: ['token'],
    capabilities: { automatic: true, recordTypes: ['A'], apexFlattening: true, proxy: true },
    findZone: async () => providerOk({ value: null }),
    listRecords: async () => providerOk({ value: { records: [], inventory: 'complete' as const } }),
    apply: async () => providerOk({ value: {} }),
  };

  test('seeds manual as the default and registers further built-ins', () => {
    const registry = createDnsProviderRegistry({ resolver }, { seed: [automatic] });
    expect(registry.contract).toBe('dns');
    expect(registry.getDefault()?.id).toBe('manual');
    expect(registry.list().map(entry => [entry.id, entry.label, entry.origin])).toEqual([['manual', 'Manual (any DNS host)', 'core'], ['cloud_dns', 'Cloud DNS', 'core']]);
    expect(createDnsProviderRegistry({ resolver }).list()).toHaveLength(1);
  });

  test('refuses malformed plugin providers and throws for malformed built-ins', () => {
    const registry = createDnsProviderRegistry({ resolver });
    // An automatic provider that cannot apply is the mistake the shape check exists for.
    const { apply: _apply, ...rest } = automatic;
    const broken: DnsProvider = { ...rest, id: 'broken' };
    expect(registry.contribute({ definition: { id: 'broken', provider: broken }, pluginId: 'plugin' })).toBe(false);
    expect(registry.refusals()[0]).toMatchObject({ code: 'invalid_provider', message: expect.stringContaining('automatic providers must implement apply') });
    expect(registry.contribute({ definition: dnsProviderDefinition({ provider: automatic }), pluginId: 'plugin' })).toBe(true);
    expect(() => createDnsProviderRegistry({ resolver }, { seed: [broken] })).toThrow(ProviderRegistryError);
  });

  test.each([
    [null, 'provider must be an object'],
    [{ ...automatic, label: ' ' }, 'label must be a non-empty string'],
    [{ ...automatic, credentialKeys: [1] }, 'credentialKeys must be a list of strings'],
    [{ ...automatic, capabilities: { automatic: true, recordTypes: 'A', apexFlattening: true, proxy: true } }, 'capabilities must declare automatic, recordTypes, apexFlattening and proxy'],
    [{ ...automatic, capabilities: null }, 'capabilities must declare automatic, recordTypes, apexFlattening and proxy'],
    [{ ...automatic, findZone: 'x' }, 'findZone and listRecords must be functions'],
    [{ ...automatic, instructions: 'x' }, 'apply and instructions must be functions when present'],
    [{ ...automatic, capabilities: { ...automatic.capabilities, automatic: false } }, 'automatic providers must implement apply and manual ones must omit it'],
  ])('shape error for %o', (provider, reason) => {
    expect(dnsProviderShapeError({ provider })).toBe(reason);
  });

  test('accepts both a manual and an automatic provider shape; exposes tokens', () => {
    expect(dnsProviderShapeError({ provider: automatic })).toBeUndefined();
    expect(dnsProviderShapeError({ provider: createManualDnsProvider({ resolver }) })).toBeUndefined();
    expect(DnsProviderRegistryToken).toMatchObject({ id: 'jini.dnsProviderRegistry', cardinality: 'one' });
    expect(AuthoritativeDnsToken).toMatchObject({ id: 'jini.authoritativeDns', cardinality: 'one' });
  });
});
