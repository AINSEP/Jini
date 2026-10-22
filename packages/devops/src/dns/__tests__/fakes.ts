import { providerOk, providerRejected, providerUnknown, type ProviderResult } from '@jini-ai/core/provider-registry';
import type { AuthoritativeDnsPort, DnsChangePlan, DnsProviderContext, DnsRecordType } from '../contract.js';
import { fingerprintPlan } from '../plan.js';

/** Scripted outcome of one fake query. */
export type FakeAnswer = readonly string[] | 'nxdomain' | 'refused' | 'timeout' | 'throw';

function outcome<T>(answer: FakeAnswer | undefined, ok: (answers: readonly string[]) => T): ProviderResult<T> {
  if (answer === 'throw') throw new Error('socket closed');
  if (answer === 'nxdomain') return providerRejected({ code: 'not_found', message: 'NXDOMAIN' });
  if (answer === 'refused') return providerRejected({ code: 'forbidden', message: 'REFUSED' });
  if (answer === 'timeout') return providerUnknown({ code: 'timeout', message: 'timed out' });
  return providerOk({ value: ok(answer ?? []) });
}

/**
 * An in-memory authoritative DNS. `ns` maps zone → delegation; `records` maps `name|type` (all
 * nameservers) or `nameserver|name|type` (one nameserver) → answers.
 */
export function fakeResolver(required: { ns?: Record<string, FakeAnswer>; records?: Record<string, FakeAnswer>; ttl?: number }): AuthoritativeDnsPort & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async queryNs({ zone }) {
      queries.push(`NS ${zone}`);
      return outcome(required.ns?.[zone] ?? 'nxdomain', answers => answers);
    },
    async query({ name, type, nameserver }: { name: string; type: DnsRecordType; nameserver: string }) {
      queries.push(`${nameserver} ${name} ${type}`);
      const answer = required.records?.[`${nameserver}|${name}|${type}`] ?? required.records?.[`${name}|${type}`];
      return outcome(answer, answers => ({ answers, ...(required.ttl === undefined ? {} : { ttl: required.ttl }) }));
    },
  };
}

export const ctx: DnsProviderContext = {
  workspaceId: 'ws',
  mode: 'test',
  credentials: {},
  httpClient: { send: async () => { throw new Error('unused'); } },
  now: () => 0,
};

/** A plan literal with a correct fingerprint. */
export function plan(body: Omit<DnsChangePlan, 'fingerprint'>): DnsChangePlan {
  return { ...body, fingerprint: fingerprintPlan({ plan: body }) };
}
