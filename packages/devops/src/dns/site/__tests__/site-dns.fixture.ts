import type { PublicNameValidators } from '../tools.js';
import { DomainDnsInputError } from '@jini-ai/core/net/public-dns-vocabulary';
import { vi } from 'vitest';
import { ctx, fakeResolver } from '../../__tests__/fakes.js';
import { createDnsProviderRegistry } from '../../registry.js';
import type { DnsPlanRequirement } from '../../contract.js';
import type { DomainBinding, DomainBindingStore } from '../binding.repo.js';
import type { DnsChangeToolDeps } from '../tool-deps.js';
import type { ToolExecutionContext, ToolRegistration } from '@jini-ai/core';

export const hostname = 'studio.example.test';
export const ns1 = 'ns1.example.test';
export const ns2 = 'ns2.example.test';
export const now = '2026-11-27T20:00:00.000Z';
export const siteRequirement: DnsPlanRequirement = {
  purpose: 'site', providerId: 'host', domain: hostname, records: [{ name: hostname, type: 'A', value: '192.0.2.18' }],
};
export const mailRequirement: DnsPlanRequirement = {
  purpose: 'mail', providerId: 'mailer', domain: hostname,
  records: [{ name: hostname, type: 'MX', value: 'mx.mail.test', priority: 17, ttl: 120, note: 'Inbound verification' }],
};

export function bindingStore(initial: readonly DomainBinding[] = []) {
  const rows = new Map(initial.map(row => [row.hostname, row]));
  const get = vi.fn<DomainBindingStore['get']>(async ({ hostname }) => structuredClone(rows.get(hostname) ?? null));
  const put = vi.fn<DomainBindingStore['put']>(async ({ binding, expectedVersion }) => {
    if ((rows.get(binding.hostname)?.version ?? null) !== expectedVersion) return false;
    rows.set(binding.hostname, structuredClone(binding));
    return true;
  });
  const listDue = vi.fn<DomainBindingStore['listDue']>(async ({ now, limit }) =>
    [...rows.values()].filter(row => row.nextCheckAt !== null && row.nextCheckAt <= now)
      .sort((a, b) => a.nextCheckAt!.localeCompare(b.nextCheckAt!) || a.hostname.localeCompare(b.hostname))
      .slice(0, limit).map(row => structuredClone(row)));
  return { get, put, listDue };
}

export function dnsFixture(config: Parameters<typeof fakeResolver>[0] = {}) {
  const records = config.records ?? {};
  const resolver = fakeResolver({ ...config, ns: config.ns ?? { [hostname]: [ns2, ns1] }, records });
  const bindings = bindingStore();
  const authorize = vi.fn<DnsChangeToolDeps['authorize']>().mockResolvedValue({ allowed: true, reason: 'allowed' });
  const deps = { registry: createDnsProviderRegistry({ resolver }), resolver, context: ctx, now: () => Date.parse(now), bindings, authorize, workspaceId: ctx.workspaceId };
  return { deps, records, resolver, bindings, authorize };
}

export function runTool(registrations: ToolRegistration[], id: string, input: unknown) {
  const registration = registrations.find(r => r.descriptor.id === id);
  if (!registration) throw new Error(`missing registered tool ${id}`);
  const context: ToolExecutionContext = { executionId: 'exec-dns', principal: { id: 'operator' }, run: { id: 'run-8' }, signal: new AbortController().signal, input };
  return registration.handler(context);
}

export const publicNames: PublicNameValidators = {
  readPublicDomain({ value, errorPrefix }) {
    if (typeof value !== 'string' || !/^[a-z0-9.-]+$/i.test(value)) throw new DomainDnsInputError({ message: `${errorPrefix}: expected a hostname` });
    return value.toLowerCase().replace(/\.$/, '');
  },
  readPublicDnsName({ value, errorPrefix }) {
    if (typeof value !== 'string' || !/^[a-z0-9_.-]+$/i.test(value)) throw new DomainDnsInputError({ message: `${errorPrefix}: expected a DNS owner` });
    return value.toLowerCase().replace(/\.$/, '');
  },
};
