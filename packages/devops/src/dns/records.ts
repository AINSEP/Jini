/**
 * @file Pure value helpers shared by the planner, the verifier and the manual provider: name
 * normalization, presentation-format parsing and a canonical value key for set comparison.
 */
import type { DomainRecordRequirement } from '@jini-ai/core/provider-registry';
import type { CaaTag, CaaValue, DnsRecord, DnsRecordType, DnsRecordValue, MxValue } from './contract.js';

/** Used when an MX requirement names no priority; 10 is the conventional single-MX value. */
export const DEFAULT_MX_PRIORITY = 10;

/** Types whose values are host names and therefore compare case- and trailing-dot-insensitively. */
const HOST_VALUE_TYPES: ReadonlySet<DnsRecordType> = new Set<DnsRecordType>(['CNAME', 'ALIAS', 'NS']);

/** Lowercase, trimmed, without the trailing root dot. */
export function normalizeDnsName(required: { readonly name: string }, _optional = {}): string {
  return required.name.trim().toLowerCase().replace(/\.$/, '');
}

export function isMxValue(value: DnsRecordValue): value is MxValue {
  return typeof value === 'object' && 'exchange' in value;
}

/** A stable string per value, so RRset membership is a string-set comparison. */
export function dnsValueKey(required: { readonly value: DnsRecordValue }, _optional = {}): string {
  const { value } = required;
  if (typeof value === 'string') return value;
  if (isMxValue(value)) return `${value.priority} ${value.exchange}`;
  return `${value.flags} ${value.tag} "${value.value}"`;
}

/** `10 mx.example.com.` → MX value. */
export function parseMxText(required: { readonly text: string }, _optional = {}): MxValue | undefined {
  const match = /^(\d+)\s+(\S+)$/.exec(required.text.trim());
  return match ? { priority: Number(match[1]), exchange: normalizeDnsName({ name: match[2] as string }) } : undefined;
}

/** `0 issue "letsencrypt.org"` → CAA value (quotes optional). */
export function parseCaaText(required: { readonly text: string }, _optional = {}): CaaValue | undefined {
  const match = /^(\d+)\s+(issue|issuewild|iodef)\s+"?([^"]*)"?$/i.exec(required.text.trim());
  if (!match) return undefined;
  return { flags: Number(match[1]), tag: (match[2] as string).toLowerCase() as CaaTag, value: match[3] as string };
}

/** Join quoted character-strings (`"a" "b"` → `ab`); an unquoted value is already logical. */
export function unquoteTxt(required: { readonly text: string }, _optional = {}): string {
  const segments = [...required.text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => (match[1] as string).replace(/\\(.)/g, '$1'));
  return segments.length > 0 ? segments.join('') : required.text;
}

function plainValue(required: { readonly type: DnsRecordType; readonly text: string }): string {
  return HOST_VALUE_TYPES.has(required.type) ? normalizeDnsName({ name: required.text }) : required.text.trim().toLowerCase();
}

/** One presentation-format answer (what a DNS query returns) as a typed value. */
export function parseAnswerValue(required: { readonly type: DnsRecordType; readonly text: string }, _optional = {}): DnsRecordValue | undefined {
  const { type, text } = required;
  if (type === 'MX') return parseMxText({ text });
  if (type === 'CAA') return parseCaaText({ text });
  if (type === 'TXT') return unquoteTxt({ text });
  return plainValue({ type, text });
}

/** The value a requirement asks for; undefined when it is malformed (e.g. an unparseable CAA). */
export function requirementValue(required: { readonly record: DomainRecordRequirement }, _optional = {}): DnsRecordValue | undefined {
  const { record } = required;
  if (record.type === 'MX') return { priority: record.priority ?? DEFAULT_MX_PRIORITY, exchange: normalizeDnsName({ name: record.value }) };
  return parseAnswerValue({ type: record.type, text: record.value });
}

/**
 * Build an RRset from values already checked against `type`. The union cannot be narrowed from a
 * runtime `type` string, so this is the single place the value array is asserted to fit it.
 */
export function buildRecord(required: {
  readonly name: string;
  readonly type: DnsRecordType;
  readonly ttl: number;
  readonly values: readonly DnsRecordValue[];
}, _optional = {}): DnsRecord {
  return { name: required.name, type: required.type, ttl: required.ttl, values: required.values } as DnsRecord;
}

/** True when both sets hold the same values (order-insensitive). */
export function sameValueSet(required: { readonly left: readonly DnsRecordValue[]; readonly right: readonly DnsRecordValue[] }, _optional = {}): boolean {
  const left = new Set(required.left.map(value => dnsValueKey({ value })));
  const right = new Set(required.right.map(value => dnsValueKey({ value })));
  return left.size === right.size && [...left].every(key => right.has(key));
}
