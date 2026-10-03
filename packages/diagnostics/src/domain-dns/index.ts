import { isIP } from "node:net";
import { domainToASCII } from "node:url";

/** Validation error independent of any tool framework. */
export class DomainDnsInputError extends Error {
 constructor({ message }: { message: string }) { super(message); this.name = "DomainDnsInputError"; }
}
/** Public DNS only. The composition root supplies a resolver that cannot inspect internal DNS. */
export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;
export type DnsRecordType = typeof DNS_TYPES[number];
export interface DnsQuery {
  type: DnsRecordType;
  status: "ok" | "not-found" | "no-data";
  records: Array<{ value: string; ttl: number }>;
}
export interface PublicDnsResolver {
  query(input: { domain: string; type: DnsRecordType }): Promise<DnsQuery>;
}
export interface TlsStatus {
  status: "verified" | "invalid" | "unavailable";
  httpStatus: number | null;
}
export type DomainDnsOperation = 'lookup-dns' | 'check-dns' | 'tls-status';
export interface DomainDnsDependencies {
  authorize(required: { operation: DomainDnsOperation }): Promise<void>;
  resolver: PublicDnsResolver;
  /** Workspace-scoped saved publishing hostnames, not caller-supplied expectations. */
  listExpectedHosts(required: Record<string, never>): Promise<string[]>;
  probeTls(input: { domain: string }): Promise<TlsStatus>;
}
/**
 * Normalizes a public hostname before any effect.
 * @param required Hostname text and the caller's error-message prefix.
 * @returns Canonical ASCII hostname.
 * @throws {DomainDnsInputError} For URLs, IPs, ports, invalid labels, or reserved/internal suffixes.
 * @complexity O(length) time and space.
 * @example readPublicDomain({ value: "EXAMPLE.COM.", errorPrefix: "DNS" }); // example.com
 */
export function readPublicDomain({ value, errorPrefix }: { value: unknown; errorPrefix: string }): string {
  return readPublicName(value, errorPrefix);
}
/**
 * Normalizes public DNS owner names, including ACME, DKIM, and DMARC underscores.
 * @returns Canonical ASCII owner name; TLS and hosting inputs use readPublicDomain instead.
 * @throws {DomainDnsInputError} For URLs, IPs, invalid labels, or reserved/internal suffixes.
 * @complexity O(length) time and space.
 * @example readPublicDnsName({ value: "_acme-challenge.example.com", errorPrefix: "DNS" });
 */
export function readPublicDnsName({ value, errorPrefix }: { value: unknown; errorPrefix: string }): string {
  return readPublicName(value, errorPrefix, { allowUnderscores: true });
}
/** Shared normalization keeps URL/IP/internal-name refusals identical for both kinds of public name. */
function readPublicName(value: unknown, toolId: string, options: { allowUnderscores?: boolean } = {}): string {
  const invalid = () => new DomainDnsInputError({ message: `${toolId}: pass a public DNS hostname such as 'example.com', without a URL, IP address, path, or port.` });
  if (typeof value !== "string" || value.length > 254 || value.trim() !== value || /[/\\?#@:%\[\]\s]/u.test(value)) throw invalid();
  const domain = domainToASCII(value.replace(/\.$/, "")).toLowerCase();
  const labels = domain.split(".");
  const labelPattern = options.allowUnderscores ? /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/ : /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const validLabels = labels.every(label => labelPattern.test(label));
  const validSuffix = /^[a-z][a-z0-9-]*$/.test(labels.at(-1)!);
  const reservedName = /\.(?:local|localhost|internal|invalid|test|onion)$/.test(domain);
  if (!domain || domain.length > 253 || isIP(domain) || labels.length < 2 || !validLabels || !validSuffix || reservedName) throw invalid();
  return domain;
}
/** Checks the bounded record type selection without silently dropping unknown/duplicate types. */
function readTypes(value: unknown): DnsRecordType[] {
  if (value === undefined) return [...DNS_TYPES];
  if (!Array.isArray(value) || value.length < 1 || value.length > 6 || new Set(value).size !== value.length || !value.every(type => DNS_TYPES.includes(type))) {
    throw new DomainDnsInputError({ message: "domain_lookup_dns: types must be a non-empty list of distinct A, AAAA, CNAME, MX, TXT, or NS record types." });
  }
  return value as DnsRecordType[];
}
/** Sequential bounded fan-out keeps a single tool call to at most six DNS requests. O(records). */
async function queryTypes(resolver: PublicDnsResolver, domain: string, types: readonly DnsRecordType[]): Promise<DnsQuery[]> {
  const queries: DnsQuery[] = [];
  for (const type of types) queries.push(await resolver.query({ domain, type }));
  return queries;
}
/** Canonicalizes address spelling (including compressed IPv6) for set comparison. O(r log r) time and O(r) space for r records. */
function recordValues(queries: DnsQuery[], type: DnsRecordType): string[] {
  const records = queries.find(query => query.type === type)?.records ?? [];
  return [...new Set(records.map(({ value }) => type === "AAAA" ? new URL(`https://[${value}]/`).hostname.slice(1, -1) : value.toLowerCase().replace(/\.$/, "")))].sort();
}
/** Set difference preserves the normalized record order. O(left + right) time and space. */
function difference(left: string[], right: string[]): string[] {
  const expected = new Set(right);
  return left.filter(value => !expected.has(value));
}
const UNKNOWN_REASON = "No independent hosting hostname is available.";
/** Compares all advertised addresses, so one correct record cannot hide a wrong IPv6 route. O(r log r) time, O(r) space; at most five bounded DNS queries. */
async function checkHost(deps: DomainDnsDependencies, domain: string, selected: unknown) {
  const hosts = [...new Set(await deps.listExpectedHosts({}))].filter(host => host !== domain).sort();
  if (hosts.length === 0 && selected === undefined) return { domain, status: "unknown" as const, expectedHost: null, reason: UNKNOWN_REASON, untrusted: true as const };
  const expectedHost = selected === undefined && hosts.length === 1 ? hosts[0] : selected;
  if (typeof expectedHost !== "string" || !hosts.includes(expectedHost)) {
    throw new DomainDnsInputError({ message: `domain_check_dns: choose expectedHost from the saved hosting hostnames: ${hosts.join(", ") || "(none)"}.` });
  }
  const actualQueries = await queryTypes(deps.resolver, domain, ["A", "AAAA", "CNAME"]);
  const hostQueries = await queryTypes(deps.resolver, expectedHost, ["A", "AAAA"]);
  const expected = { A: recordValues(hostQueries, "A"), AAAA: recordValues(hostQueries, "AAAA") };
  const observed = { A: recordValues(actualQueries, "A"), AAAA: recordValues(actualQueries, "AAAA"), CNAME: recordValues(actualQueries, "CNAME") };
  const unexpected = { A: difference(observed.A, expected.A), AAAA: difference(observed.AAAA, expected.AAAA) };
  const missing = { A: difference(expected.A, observed.A), AAAA: difference(expected.AAAA, observed.AAAA) };
  const hasExpected = expected.A.length + expected.AAAA.length > 0;
  const differs = unexpected.A.length + unexpected.AAAA.length + missing.A.length + missing.AAAA.length > 0;
  return { domain, expectedHost, status: !hasExpected ? "unknown" as const : differs ? "mismatch" as const : "matches-host-dns" as const, expectationSource: "host-dns" as const, expected, observed, unexpected, missing, untrusted: true as const, limitation: "Compares current public DNS, not provider-required records. Shared/CDN addresses do not prove that traffic reaches the correct app." };
}

export interface DomainDnsChecks {
 lookupDns(required: { domain: unknown }, options?: { types?: unknown }): Promise<{ domain: string; resolver: 'public-dns'; untrusted: true; queries: DnsQuery[] }>;
 checkDns(required: { domain: unknown }, options?: { expectedHost?: unknown }): Promise<Awaited<ReturnType<typeof checkHost>>>;
 tlsStatus(required: { domain: unknown }): Promise<TlsStatus & { domain: string; certificate: { expiresAt: null; issuer: null }; limitation: string }>;
}

/** Builds three bounded read operations without CMS/tool registration.
 * @param deps Required public-network, hosting-source and authorization ports.
 * @returns DNS lookup/comparison and TLS status checks. Validation precedes authorization and I/O.
 * @throws DomainDnsInputError for invalid inputs; authorization and transport failures propagate.
 */
export function createDomainDnsChecks(deps: DomainDnsDependencies): DomainDnsChecks {
 return {
  async lookupDns({ domain: value }, { types: selectedTypes } = {}) {
   const domain = readPublicDnsName({ value, errorPrefix: 'domain_lookup_dns' });
   const types = readTypes(selectedTypes);
   await deps.authorize({ operation: 'lookup-dns' });
   return { domain, resolver: 'public-dns', untrusted: true, queries: await queryTypes(deps.resolver, domain, types) };
  },
  async checkDns({ domain: value }, { expectedHost: selected } = {}) {
   const domain = readPublicDomain({ value, errorPrefix: 'domain_check_dns' });
   const expectedHost = selected === undefined ? undefined : readPublicDomain({ value: selected, errorPrefix: 'domain_check_dns' });
   await deps.authorize({ operation: 'check-dns' });
   return checkHost(deps, domain, expectedHost);
  },
  async tlsStatus({ domain: value }) {
   const domain = readPublicDomain({ value, errorPrefix: 'domain_tls_status' });
   await deps.authorize({ operation: 'tls-status' });
   return { domain, ...await deps.probeTls({ domain }), certificate: { expiresAt: null, issuer: null }, limitation: 'Checks certificate trust, hostname, and validity through HTTPS. Certificate issuer and expiry date are not exposed by this client.' };
  },
 };
}
