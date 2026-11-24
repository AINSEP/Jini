/**
 * @file The public DNS record-type vocabulary and the framework-independent input error shared by
 * the DNS diagnostics (which own hostname validation) and the DNS agent tools.
 *
 * `DomainDnsInputError` has a single class identity here, so a caller that matches it with
 * `instanceof` sees the same class whichever package threw it. Pure values; no I/O.
 */

/** Validation error independent of any tool framework. */
export class DomainDnsInputError extends Error {
 constructor({ message }: { message: string }) { super(message); this.name = "DomainDnsInputError"; }
}
/** Public DNS only. The composition root supplies a resolver that cannot inspect internal DNS. */
export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;
export type DnsRecordType = typeof DNS_TYPES[number];
