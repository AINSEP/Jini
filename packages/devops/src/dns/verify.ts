/**
 * @file Propagation verification against the zone's AUTHORITATIVE nameservers — every one of them,
 * not a single recursive DoH cache, so "propagated" means the source of truth answers correctly
 * and a nameserver still serving old data is noticed.
 *
 * A transport error is `unknown` (retry later), never a failure: slow DNS is not a broken domain.
 */
import type { DomainRecordRequirement } from '@jini-ai/core/provider-registry';
import { DNS_ADDRESS_TYPES, type AuthoritativeDnsPort } from './contract.js';
import { settlePort } from './delegation.js';
import { dnsValueKey, isMxValue, normalizeDnsName, parseAnswerValue, requirementValue } from './records.js';
import { isSpfValue, spfSatisfies } from './spf.js';
import type { DnsPlanRequirement } from './contract.js';

export type PropagationState = 'propagated' | 'pending' | 'mismatch' | 'unknown';

export interface NameserverObservation {
  readonly nameserver: string;
  readonly state: PropagationState;
  readonly answers: readonly string[];
}

export interface RecordVerification {
  readonly record: DomainRecordRequirement;
  readonly state: PropagationState;
  readonly byNameserver: readonly NameserverObservation[];
}

export interface DnsVerification {
  readonly zone: string;
  readonly state: PropagationState;
  readonly nameservers: readonly string[];
  readonly records: readonly RecordVerification[];
  readonly reason?: string;
}

/** First re-check after 30s, doubling, never more than 10 minutes apart. */
export const FIRST_CHECK_DELAY_MS = 30_000;
export const MAX_CHECK_DELAY_MS = 600_000;
/** Give up (report, don't fail silently) after 48 hours — the outer bound of NS/TTL caching. */
export const PROPAGATION_CAP_MS = 48 * 60 * 60 * 1000;

/** Delay before check number `attempt` (0-based). @complexity O(1). */
export function nextCheckDelayMs(required: { readonly attempt: number }, _optional = {}): number {
  const attempt = Math.max(0, Math.floor(required.attempt));
  return Math.min(MAX_CHECK_DELAY_MS, FIRST_CHECK_DELAY_MS * 2 ** Math.min(attempt, 10));
}

export function isExpired(required: { readonly startedAt: number; readonly now: number }, _optional = {}): boolean {
  return required.now - required.startedAt >= PROPAGATION_CAP_MS;
}

/** True when one presentation-format answer satisfies the required record. */
export function answerMatches(required: { readonly record: DomainRecordRequirement; readonly answer: string }, _optional = {}): boolean {
  const { record } = required;
  const actual = parseAnswerValue({ type: record.type, text: required.answer });
  const expected = requirementValue({ record });
  if (actual === undefined || expected === undefined) return false;
  // An MX requirement without a priority accepts any priority for its exchange.
  const have = { value: actual };
  const want = { value: expected };
  if (record.priority === undefined && isMxValue(have) && isMxValue(want)) return have.value.exchange === want.value.exchange;
  return typeof actual === 'string' && typeof expected === 'string' ? textMatches(actual, expected) : dnsValueKey({ value: actual }) === dnsValueKey({ value: expected });
}

/** SPF requirements are merged into the zone's single SPF record, so containment is the test. */
function textMatches(actual: string, expected: string): boolean {
  if (!isSpfValue({ value: expected })) return actual === expected;
  return isSpfValue({ value: actual }) && spfSatisfies({ actual, wanted: expected });
}

/** True when a TXT answer or requirement value is an SPF (`v=spf1`) record. */
function isSpfText(type: DomainRecordRequirement['type'], text: string): boolean {
  const value = parseAnswerValue({ type, text });
  return type === 'TXT' && typeof value === 'string' && isSpfValue({ value });
}

/**
 * Answers that make an RRset wrong even though one of them matches: an address RRset must hold
 * only required values (an obsolete IP still receives traffic), and a name may publish only one
 * SPF record (a second makes every SPF check a PermError).
 */
function invalidRrset(record: DomainRecordRequirement, answers: readonly string[], siblings: readonly DomainRecordRequirement[]): boolean {
  if (DNS_ADDRESS_TYPES.has(record.type)) return answers.some(answer => !siblings.some(sibling => answerMatches({ record: sibling, answer })));
  return isSpfText(record.type, record.value) && answers.filter(answer => isSpfText(record.type, answer)).length > 1;
}

async function observe(record: DomainRecordRequirement, nameserver: string, ports: { resolver: AuthoritativeDnsPort; siblings: readonly DomainRecordRequirement[] }): Promise<NameserverObservation> {
  const name = normalizeDnsName({ name: record.name });
  const result = await settlePort({ call: () => ports.resolver.query({ name, type: record.type, nameserver }) });
  if (result.status === 'unknown') return { nameserver, state: 'unknown', answers: [] };
  if (result.status === 'rejected') return { nameserver, state: result.error.code === 'not_found' ? 'pending' : 'unknown', answers: [] };
  const { answers } = result.value;
  if (!answers.some(answer => answerMatches({ record, answer }))) return { nameserver, state: answers.length === 0 ? 'pending' : 'mismatch', answers };
  return { nameserver, state: invalidRrset(record, answers, ports.siblings) ? 'mismatch' : 'propagated', answers };
}

/** Requirement records at the same name and type: together they are the RRset a server must serve. */
function sameRrset(records: readonly DomainRecordRequirement[], record: DomainRecordRequirement): DomainRecordRequirement[] {
  const name = normalizeDnsName({ name: record.name });
  return records.filter(other => other.type === record.type && normalizeDnsName({ name: other.name }) === name);
}

/** Per record: all nameservers agree → propagated; some do → still pending between servers. */
function recordState(states: readonly PropagationState[]): PropagationState {
  if (states.every(state => state === 'propagated')) return 'propagated';
  if (states.includes('unknown')) return 'unknown';
  if (states.includes('propagated')) return 'pending';
  return states.includes('mismatch') ? 'mismatch' : 'pending';
}

/** Overall: a mismatch is the actionable signal, so it outranks unknown and pending. */
export function aggregatePropagation(required: { readonly states: readonly PropagationState[] }, _optional = {}): PropagationState {
  const { states } = required;
  if (states.every(state => state === 'propagated')) return 'propagated';
  if (states.includes('mismatch')) return 'mismatch';
  return states.includes('unknown') ? 'unknown' : 'pending';
}

/**
 * Check every requirement record on every authoritative nameserver of `zone`.
 * @complexity O(records · nameservers) queries, issued concurrently.
 */
export async function verifyRequirements(
  required: { readonly zone: string; readonly requirements: readonly DnsPlanRequirement[] },
  ports: { readonly resolver: AuthoritativeDnsPort },
): Promise<DnsVerification> {
  const zone = normalizeDnsName({ name: required.zone });
  const records = required.requirements.flatMap(requirement => requirement.records);
  const ns = await settlePort({ call: () => ports.resolver.queryNs({ zone }) });
  const nameservers = ns.status === 'ok' ? [...new Set(ns.value.map(name => normalizeDnsName({ name })))] : [];
  if (nameservers.length === 0) {
    const reason = ns.status === 'ok' ? `${zone} has no authoritative nameservers.` : `The nameservers of ${zone} could not be read.`;
    return { zone, state: 'unknown', nameservers, reason, records: records.map(record => ({ record, state: 'unknown', byNameserver: [] })) };
  }
  const verified = await Promise.all(records.map(async record => {
    const siblings = sameRrset(records, record);
    const byNameserver = await Promise.all(nameservers.map(nameserver => observe(record, nameserver, { resolver: ports.resolver, siblings })));
    return { record, state: recordState(byNameserver.map(observation => observation.state)), byNameserver };
  }));
  return { zone, nameservers, records: verified, state: aggregatePropagation({ states: verified.map(record => record.state) }) };
}
