/**
 * @file The `node:dns` {@link AuthoritativeDnsPort} (moved here from the first host, review 13-dns
 * #10: nothing in it is host specific; the host injects its address policy).
 *
 * `query` asks the zone's OWN nameserver (its hostname resolved to an address, then a fresh
 * `Resolver` pointed at it with `setServers`), so "propagated" means the source of truth answers,
 * not a recursive cache.
 *
 * `queryNs` reads the delegation from the PARENT zone's nameservers (review 13-dns #5): a parent
 * publishes a child's NS set as a referral, which is what the registrar changed. A recursive
 * resolver's answer can be cached or come from the child's own (possibly stale) NS records, which
 * would let verification stop at the previous DNS host. Only the parent's server list itself is
 * read recursively. A top-level zone (no parent below the root) is read recursively.
 *
 * Every failure maps onto the kernel's result convention and never throws: NXDOMAIN → rejected
 * `not_found`, NODATA → ok with no answers, anything else (timeout, refused, SERVFAIL, a malformed
 * or mismatched reply) → `unknown`. A nameserver whose only addresses fail the host's
 * `isPublicAddress` policy is refused as `unknown`, so a hostile zone cannot point the probe at an
 * internal port 53.
 */
import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { Resolver } from 'node:dns/promises';
import { providerOk, providerRejected, providerUnknown, type ProviderResult } from '@jini-ai/core/provider-registry';
import type { AuthoritativeDnsPort, DnsRecordType } from '../contract.js';
import { normalizeDnsName } from '../records.js';
import { createUdpDnsExchange, type DnsExchange } from './udp.js';
import { decodeNsReply, DNS_RCODE_NXDOMAIN, encodeNsQuery } from './wire.js';

/** The `node:dns/promises` Resolver surface this adapter uses; tests inject a fake. */
export type DnsResolverLike = Pick<Resolver, 'setServers' | 'resolve4' | 'resolve6' | 'resolveCname' | 'resolveTxt' | 'resolveMx' | 'resolveCaa' | 'resolveNs' | 'resolveSrv'>;

/** One c-ares try per query: a slow server is `unknown` quickly and the verifier retries later. */
export const AUTHORITATIVE_DNS_TIMEOUT_MS = 5_000;

export interface NodeAuthoritativeDnsResolverOptions {
  /** Resolver factory (default `new Resolver(options)`). */
  readonly createResolver?: (options: { timeout: number; tries: number }) => DnsResolverLike;
  /** Recursive servers for nameserver-address and parent-server reads; default the system's. */
  readonly bootstrapServers?: string[];
  /** Per-query timeout; default {@link AUTHORITATIVE_DNS_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Raw DNS exchange for the parent delegation read; default UDP port 53. */
  readonly exchange?: DnsExchange;
  /** Query id source (16-bit); default a CSPRNG, so an off-path reply cannot be guessed. */
  readonly randomId?: () => number;
}

type Answers = { answers: string[]; ttl?: number };
type Reader = (resolver: DnsResolverLike, name: string) => Promise<Answers>;

/** Addresses with the smallest TTL; an empty list carries no TTL. */
const addresses = (records: readonly { address: string; ttl: number }[]): Answers => ({
  answers: records.map(record => record.address),
  ...(records.length === 0 ? {} : { ttl: Math.min(...records.map(record => record.ttl)) }),
});
const quote = (chunk: string): string => `"${chunk.replace(/(["\\])/g, '\\$1')}"`;
const CAA_TAGS = ['issue', 'issuewild', 'iodef'] as const;

/** Presentation-format answers per type, the format the kernel's parsers read. */
const READERS: Readonly<Record<Exclude<DnsRecordType, 'ALIAS'>, Reader>> = {
  A: async (resolver, name) => addresses(await resolver.resolve4(name, { ttl: true })),
  AAAA: async (resolver, name) => addresses(await resolver.resolve6(name, { ttl: true })),
  CNAME: async (resolver, name) => ({ answers: await resolver.resolveCname(name) }),
  // Character-strings stay quoted so the kernel re-joins a long (chunked) TXT value exactly.
  TXT: async (resolver, name) => ({ answers: (await resolver.resolveTxt(name)).map(chunks => chunks.map(quote).join(' ')) }),
  MX: async (resolver, name) => ({ answers: (await resolver.resolveMx(name)).map(record => `${record.priority} ${record.exchange}`) }),
  CAA: async (resolver, name) => ({
    answers: (await resolver.resolveCaa(name)).flatMap(record => CAA_TAGS.filter(tag => record[tag] !== undefined).map(tag => `${record.critical} ${tag} ${quote(record[tag] as string)}`)),
  }),
  NS: async (resolver, name) => ({ answers: await resolver.resolveNs(name) }),
  SRV: async (resolver, name) => ({ answers: (await resolver.resolveSrv(name)).map(record => `${record.priority} ${record.weight} ${record.port} ${record.name}`) }),
};

/** NXDOMAIN / NODATA / transport failure, per the port's result convention. */
async function settle<T>(call: () => Promise<T>, empty: T): Promise<ProviderResult<T>> {
  try {
    return providerOk({ value: await call() });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENODATA') return providerOk({ value: empty });
    if (code === 'ENOTFOUND') return providerRejected({ code: 'not_found', message: 'The name does not exist.' });
    if (code === 'ETIMEOUT') return providerUnknown({ code: 'timeout', message: 'The DNS server did not answer in time.' });
    return providerUnknown({ code: 'network', message: 'The DNS query failed before an answer arrived.' });
  }
}

/** `dev.example.com` → `example.com`; undefined for a top-level name. */
function parentOf(name: string): string | undefined {
  const dot = name.indexOf('.');
  return dot < 0 ? undefined : name.slice(dot + 1);
}

/**
 * Build the adapter.
 * @param required.isPublicAddress - Host address policy: only addresses it accepts are queried.
 * @complexity O(1) setup; each `query` is ≤ 3 DNS round trips (NS address A + AAAA, then the
 * record); each `queryNs` walks up to the closest enclosing zone, then asks its servers in turn.
 * @example createNodeAuthoritativeDnsResolver({ isPublicAddress: ({ address }) => policy(address) })
 */
export function createNodeAuthoritativeDnsResolver(
  required: { readonly isPublicAddress: (required: { readonly address: string }) => boolean },
  optional: NodeAuthoritativeDnsResolverOptions = {},
): AuthoritativeDnsPort {
  const timeoutMs = optional.timeoutMs ?? AUTHORITATIVE_DNS_TIMEOUT_MS;
  const options = { timeout: timeoutMs, tries: 1 };
  const create = optional.createResolver ?? (resolverOptions => new Resolver(resolverOptions));
  const exchange = optional.exchange ?? createUdpDnsExchange();
  const randomId = optional.randomId ?? (() => randomInt(0, 0x10000));
  const bootstrap = create(options);
  if (optional.bootstrapServers !== undefined) bootstrap.setServers(optional.bootstrapServers);
  const publicOnly = (addresses: readonly string[]): string[] => addresses.filter(address => required.isPublicAddress({ address }));

  /** The nameserver's first public address (an address literal is used as given, if public). */
  const nameserverAddress = async (nameserver: string): Promise<string | undefined> => {
    if (isIP(nameserver) !== 0) return publicOnly([nameserver])[0];
    const [v4, v6] = await Promise.all([settle(() => bootstrap.resolve4(nameserver), []), settle(() => bootstrap.resolve6(nameserver), [])]);
    const addresses = [v4, v6].flatMap(result => (result.status === 'ok' ? result.value : []));
    return publicOnly(addresses)[0];
  };

  /** The NS set of the closest enclosing zone of `name` (a name without its own NS is not a zone cut). */
  const enclosingServers = async (name: string): Promise<ProviderResult<readonly string[]>> => {
    for (let candidate: string | undefined = name; candidate !== undefined; candidate = parentOf(candidate)) {
      const zone = candidate;
      const result = await settle(() => bootstrap.resolveNs(zone), []);
      if (result.status !== 'ok' || result.value.length > 0) return result;
    }
    return providerUnknown({ code: 'network', message: `No zone enclosing ${name} has nameservers.` });
  };

  /** One NS question to one parent server; a mismatched id or truncated reply is not an answer. */
  const askParent = async (address: string, zone: string): Promise<ProviderResult<readonly string[]>> => {
    try {
      const id = randomId();
      const reply = decodeNsReply({ message: await exchange({ address, message: encodeNsQuery({ id, name: zone }), timeoutMs }), name: zone });
      if (reply.id !== id || reply.truncated) return providerUnknown({ code: 'network', message: `The parent nameserver ${address} sent an unusable reply.` });
      if (reply.rcode === DNS_RCODE_NXDOMAIN) return providerRejected({ code: 'not_found', message: 'The name does not exist.' });
      if (reply.rcode !== 0) return providerUnknown({ code: 'network', message: `The parent nameserver ${address} refused the query (rcode ${reply.rcode}).` });
      return providerOk({ value: reply.nameservers });
    } catch {
      return providerUnknown({ code: 'network', message: 'The DNS query failed before an answer arrived.' });
    }
  };

  /** The parent's delegation of `zone`, from the first parent server that gives a usable reply. */
  const delegation = async (zone: string, parent: string): Promise<ProviderResult<readonly string[]>> => {
    const servers = await enclosingServers(parent);
    if (servers.status !== 'ok') return servers;
    for (const server of servers.value) {
      const address = await nameserverAddress(server);
      const result = address === undefined ? undefined : await askParent(address, zone);
      if (result !== undefined && result.status !== 'unknown') return result;
    }
    return providerUnknown({ code: 'network', message: `No nameserver of ${parent} answered for the delegation of ${zone}.` });
  };

  return {
    queryNs: ({ zone }) => {
      const name = normalizeDnsName({ name: zone });
      const parent = parentOf(name);
      return parent === undefined ? settle(() => bootstrap.resolveNs(name), []) : delegation(name, parent);
    },
    query: async ({ name, type, nameserver }) => {
      if (type === 'ALIAS') return providerRejected({ code: 'unsupported', message: 'ALIAS is a DNS-host feature, not a record type a nameserver serves.' });
      const address = await nameserverAddress(nameserver);
      if (address === undefined) return providerUnknown({ code: 'network', message: `The nameserver ${nameserver} has no public address.` });
      const resolver = create(options);
      resolver.setServers([address]);
      return settle(() => READERS[type](resolver, name), { answers: [] });
    },
  };
}
