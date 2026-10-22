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

/** True when the value is an MX value (narrows `required.value`). */
export function isMxValue(required: { readonly value: DnsRecordValue }, _optional = {}): required is { readonly value: MxValue } {
  return typeof required.value === 'object' && 'exchange' in required.value;
}

const IPV6_GROUP = /^[0-9a-f]{1,4}$/;
const IPV4_TAIL = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A trailing dotted IPv4 (`::ffff:192.0.2.1`) as its two hex groups; undefined when out of range. */
function expandIpv4Tail(text: string): string | undefined {
  const match = IPV4_TAIL.exec(text);
  if (!match) return text;
  const octets = match.slice(2).map(Number);
  if (octets.some(octet => octet > 255)) return undefined;
  const [a, b, c, d] = octets as [number, number, number, number];
  return `${match[1] as string}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
}

function parseGroups(text: string): number[] | undefined {
  const groups = text === '' ? [] : text.split(':');
  return groups.every(group => IPV6_GROUP.test(group)) ? groups.map(group => parseInt(group, 16)) : undefined;
}

/** The eight 16-bit groups of an IPv6 address; undefined when the text is not one. */
function ipv6Groups(text: string): number[] | undefined {
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = parseGroups(halves[0] as string);
  const tail = halves.length === 2 ? parseGroups(halves[1] as string) : [];
  if (head === undefined || tail === undefined) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

/** Each run of zero groups as [start, length], in order. */
function zeroRuns(groups: readonly number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  groups.forEach((group, index) => {
    if (group !== 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] + last[1] === index) last[1] += 1;
    else runs.push([index, 1]);
  });
  return runs;
}

/** The first longest run of two or more zero groups, as [start, length]; length 0 when none. */
function longestZeroRun(groups: readonly number[]): [number, number] {
  return zeroRuns(groups).reduce<[number, number]>((best, run) => (run[1] >= 2 && run[1] > best[1] ? run : best), [0, 0]);
}

/**
 * RFC 5952 text of a valid IPv6 address (lowercase, no leading zeros, the first longest zero run
 * as `::`), so equivalent spellings compare equal; undefined when the text is not an IPv6 address.
 * @complexity O(1) — an address has eight groups.
 */
export function canonicalIpv6(required: { readonly address: string }, _optional = {}): string | undefined {
  const expanded = expandIpv4Tail(required.address.trim().toLowerCase());
  const groups = expanded === undefined ? undefined : ipv6Groups(expanded);
  if (groups === undefined) return undefined;
  const [start, length] = longestZeroRun(groups);
  const hex = groups.map(group => group.toString(16));
  if (length === 0) return hex.join(':');
  return `${hex.slice(0, start).join(':')}::${hex.slice(start + length).join(':')}`;
}

/** A stable string per value, so RRset membership is a string-set comparison. */
export function dnsValueKey(required: { readonly value: DnsRecordValue }, _optional = {}): string {
  const { value } = required;
  if (typeof value === 'string') return value;
  if (isMxValue(required)) return `${required.value.priority} ${required.value.exchange}`;
  // Strings and MX values returned above; a type guard on `required` does not narrow `value`.
  const caa = value as CaaValue;
  return `${caa.flags} ${caa.tag} "${caa.value}"`;
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
  if (HOST_VALUE_TYPES.has(required.type)) return normalizeDnsName({ name: required.text });
  const text = required.text.trim().toLowerCase();
  // Expanded and compressed IPv6 spellings are the same address; an invalid one is kept as typed.
  return required.type === 'AAAA' ? (canonicalIpv6({ address: text }) ?? text) : text;
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
