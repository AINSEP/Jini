/**
 * @file The provider-neutral DNS planner. Planning is core, not per provider, so every provider
 * gets identical, testable semantics; providers only list and (later) apply.
 *
 * Rule (lifted from the first host deploy plugin's DNS planner): preserve by default. Only address
 * records (A/AAAA/CNAME/ALIAS) this engine owns (`managedBy: 'self'`) at a name that needs a
 * different address are changed; a foreign or unmarked one blocks the name instead. Mail, TXT,
 * CAA, wildcard and unrelated records are never removed — new values are merged into them and
 * the untouched rest is disclosed in `preserved`.
 */
import { createHash } from 'node:crypto';
import {
  DEFAULT_DNS_TTL,
  DNS_ADDRESS_TYPES,
  type CaaValue,
  type DnsChange,
  type DnsChangePlan,
  type DnsInventory,
  type DnsPlanBlocker,
  type DnsPlanRequirement,
  type DnsRecord,
  type DnsRecordType,
  type DnsRecordValue,
} from './contract.js';
import { buildRecord, dnsValueKey, normalizeDnsName, requirementValue, sameValueSet } from './records.js';
import { isSpfValue, mergeSpf } from './spf.js';

export interface PlanDnsChangesInput {
  readonly providerId: string;
  readonly zone: string;
  readonly current: readonly DnsRecord[];
  readonly requirements: readonly DnsPlanRequirement[];
  readonly inventory: DnsInventory;
}

export interface PlanDnsChangesOptions {
  /** The provider flattens a CNAME at the apex (so it is allowed there). Default false. */
  readonly apexFlattening?: boolean;
  /** When given, a required type outside this list blocks the plan. */
  readonly recordTypes?: readonly DnsRecordType[];
  readonly defaultTtl?: number;
}

interface PlanContext {
  readonly zone: string;
  readonly current: readonly DnsRecord[];
  readonly desired: readonly DnsRecord[];
  readonly apexFlattening: boolean;
}

interface Planned { readonly changes: readonly DnsChange[]; readonly blockers: readonly DnsPlanBlocker[] }

const OP_ORDER: Readonly<Record<DnsChange['op'], number>> = { delete: 0, update: 1, create: 2 };

/** Canonical JSON: object keys sorted, `undefined` members dropped, array order kept. */
export function canonicalJson(required: { readonly value: unknown }, _optional = {}): string {
  const { value } = required;
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson({ value: item })).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson({ value: record[key] })}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** sha-256 hex over the canonical plan, excluding any fingerprint it already carries. */
export function fingerprintPlan(required: { readonly plan: Omit<DnsChangePlan, 'fingerprint'> & { readonly fingerprint?: string } }, _optional = {}): string {
  const { fingerprint: _ignored, ...body } = required.plan;
  return createHash('sha256').update(canonicalJson({ value: body })).digest('hex');
}

function finalize(plan: Omit<DnsChangePlan, 'fingerprint'>): DnsChangePlan {
  return { ...plan, fingerprint: fingerprintPlan({ plan }) };
}

function normalizeRecord(record: DnsRecord): DnsRecord {
  return { ...record, name: normalizeDnsName({ name: record.name }) };
}

function recordKey(record: { readonly name: string; readonly type: string }): string {
  return `${record.name}|${record.type}`;
}

/** Group requirement records into desired RRsets (deduplicated values, smallest TTL wins). */
function desiredRecordSets(required: { readonly requirements: readonly DnsPlanRequirement[]; readonly defaultTtl: number }): { records: DnsRecord[]; blockers: DnsPlanBlocker[] } {
  const sets = new Map<string, { name: string; type: DnsRecordType; ttl: number; values: DnsRecordValue[] }>();
  const blockers: DnsPlanBlocker[] = [];
  for (const record of required.requirements.flatMap(requirement => requirement.records)) {
    const name = normalizeDnsName({ name: record.name });
    const value = requirementValue({ record });
    if (value === undefined) {
      blockers.push({ code: 'invalid_requirement', name, message: `The required ${record.type} value '${record.value}' at ${name} cannot be parsed.` });
      continue;
    }
    const key = recordKey({ name, type: record.type });
    const set = sets.get(key) ?? { name, type: record.type, ttl: record.ttl ?? required.defaultTtl, values: [] };
    set.ttl = Math.min(set.ttl, record.ttl ?? set.ttl);
    if (!set.values.some(existing => dnsValueKey({ value: existing }) === dnsValueKey({ value }))) set.values.push(value);
    sets.set(key, set);
  }
  const records = [...sets.values()].sort((a, b) => recordKey(a).localeCompare(recordKey(b))).map(set => buildRecord(set));
  return { records, blockers };
}

/** Apex CNAME on a non-flattening host, or a CNAME that would share its name with other data. */
function nameBlocker(ctx: PlanContext, name: string): DnsPlanBlocker | undefined {
  const desiredHere = ctx.desired.filter(record => record.name === name);
  const existingHere = ctx.current.filter(record => record.name === name);
  const wantsAddress = desiredHere.some(record => DNS_ADDRESS_TYPES.has(record.type));
  const hasCname = desiredHere.some(record => record.type === 'CNAME') || (!wantsAddress && existingHere.some(record => record.type === 'CNAME'));
  const isApex = name === ctx.zone;
  if (!hasCname || (isApex && ctx.apexFlattening)) return undefined;
  if (isApex) {
    return { code: 'apex_cname', name, message: `${name} is the zone apex; this DNS host cannot serve a CNAME there.`, suggestion: 'Use an ALIAS record or A/AAAA records at the apex, or a DNS host that flattens apex CNAMEs.' };
  }
  const others = [...desiredHere.filter(record => record.type !== 'CNAME'), ...existingHere.filter(record => !DNS_ADDRESS_TYPES.has(record.type))];
  if (others.length === 0) return undefined;
  return { code: 'cname_coexistence', name, message: `A CNAME at ${name} cannot coexist with its ${[...new Set(others.map(record => record.type))].join('/')} record(s).`, suggestion: 'Point the name with A/AAAA records instead, or move the other records to a different name.' };
}

/** The address changes (deletes, updates, creates) that make one name serve `desired`. */
function addressChanges(name: string, desired: readonly DnsRecord[], existing: readonly DnsRecord[]): DnsChange[] {
  const wanted = desired.map(record => record.type).join('/');
  const changes: DnsChange[] = existing
    .filter(record => !desired.some(want => want.type === record.type))
    .map(record => ({ op: 'delete', before: record, reason: `The ${record.type} record at ${name} conflicts with the required ${wanted} record.` }));
  for (const want of desired) {
    const have = existing.find(record => record.type === want.type);
    if (!have) {
      changes.push({ op: 'create', after: want, reason: `Point ${name} at the required ${want.type} target.` });
    } else if (!sameValueSet({ left: have.values, right: want.values })) {
      changes.push({ op: 'update', before: have, after: { ...have, ttl: want.ttl, values: want.values } as DnsRecord, reason: `Replace the ${want.type} values at ${name} with the required target.` });
    } else {
      // Already satisfied: the record is left untouched and shows up in `preserved`.
    }
  }
  return changes;
}

function ownershipBlocker(name: string, foreign: readonly DnsRecord[], desired: readonly DnsRecord[]): DnsPlanBlocker {
  const types = [...new Set(foreign.map(record => record.type))].join('/');
  const target = desired.map(record => `${record.type} ${(record.values as readonly DnsRecordValue[]).map(value => dnsValueKey({ value })).join(', ')}`).join('; ');
  return {
    code: 'record_not_owned', name,
    message: `The existing ${types} record at ${name} was not created by this engine (it is not marked as managed), so it is left untouched instead of being replaced or deleted.`,
    suggestion: `If it is no longer needed, change it by hand at your DNS host to ${target}, then plan again.`,
  };
}

/**
 * Replace conflicting address records at one name with the desired address RRsets. Only a name
 * that needs an address is touched, and only records marked `managedBy: 'self'` are ever replaced
 * or deleted: anything else belongs to someone else, so the name is blocked instead.
 */
function planAddressName(ctx: PlanContext, name: string): Planned {
  const desired = ctx.desired.filter(record => record.name === name && DNS_ADDRESS_TYPES.has(record.type));
  // A TXT/MX/CAA-only requirement must not "replace" the name's addresses with nothing.
  if (desired.length === 0) return { changes: [], blockers: [] };
  const existing = ctx.current.filter(record => record.name === name && DNS_ADDRESS_TYPES.has(record.type));
  const changes = addressChanges(name, desired, existing);
  const foreign = changes.flatMap(change => (change.before !== undefined && change.before.managedBy !== 'self' ? [change.before] : []));
  return foreign.length === 0 ? { changes, blockers: [] } : { changes: [], blockers: [ownershipBlocker(name, foreign, desired)] };
}

/** Fold desired TXT values into an existing set; SPF is merged, never duplicated. */
function mergeTxtValues(existing: readonly string[], desired: readonly string[], name: string): { values: string[] } | { blocker: DnsPlanBlocker } {
  const existingSpf = existing.filter(value => isSpfValue({ value }));
  if (existingSpf.length > 1) {
    return { blocker: { code: 'multiple_spf', name, message: `${name} already has ${existingSpf.length} SPF (v=spf1) records, which is invalid; merge them by hand first.` } };
  }
  const values = [...existing, ...desired.filter(value => !isSpfValue({ value }) && !existing.includes(value))];
  const desiredSpf = desired.filter(value => isSpfValue({ value }));
  if (desiredSpf.length === 0) return { values };
  const base = existingSpf[0];
  const merged = desiredSpf.reduce((acc, addition) => mergeSpf({ base: acc, addition }), base ?? (desiredSpf[0] as string));
  return { values: base === undefined ? [...values, merged] : values.map(value => (value === base ? merged : value)) };
}

/** Additive merge for non-address RRsets: existing values stay, missing desired values are added. */
function mergedValues(have: DnsRecord, want: DnsRecord): { values: readonly DnsRecordValue[] } | { blocker: DnsPlanBlocker } {
  if (want.type === 'TXT') return mergeTxtValues(have.values as readonly string[], want.values, want.name);
  const keys = new Set(have.values.map(value => dnsValueKey({ value })));
  return { values: [...have.values, ...(want.values as readonly DnsRecordValue[]).filter(value => !keys.has(dnsValueKey({ value })))] };
}

function planAdditive(ctx: PlanContext, want: DnsRecord): Planned {
  const have = ctx.current.find(record => record.name === want.name && record.type === want.type);
  const merged = mergedValues(have ?? buildRecord({ ...want, values: [] }), want);
  if ('blocker' in merged) return { changes: [], blockers: [merged.blocker] };
  if (!have) return { changes: [{ op: 'create', after: buildRecord({ ...want, values: merged.values }), reason: `Add the required ${want.type} record at ${want.name}.` }], blockers: [] };
  if (sameValueSet({ left: have.values, right: merged.values })) return { changes: [], blockers: [] };
  return { changes: [{ op: 'update', before: have, after: { ...have, values: merged.values } as DnsRecord, reason: `Add the required ${want.type} value(s) to ${want.name}, keeping the existing ones.` }], blockers: [] };
}

function caaAuthorizes(values: readonly CaaValue[], issuer: string, wildcard: boolean): boolean {
  const wildcardIssuers = values.filter(value => value.tag === 'issuewild');
  const relevant = wildcard && wildcardIssuers.length > 0 ? wildcardIssuers : values.filter(value => value.tag === 'issue');
  // No issue property at all means CAA does not restrict issuance (RFC 8659 §4).
  return relevant.length === 0 || relevant.some(value => (value.value.split(';')[0] as string).trim().toLowerCase() === issuer);
}

/** CAA tree-climbing: the closest name (itself, then each parent) holding any CAA values. */
function relevantCaa(ctx: PlanContext, name: string): readonly CaaValue[] | undefined {
  for (let candidate = name.replace(/^\*\./, ''); candidate !== ''; candidate = candidate.includes('.') ? candidate.slice(candidate.indexOf('.') + 1) : '') {
    const values = [...ctx.current, ...ctx.desired].filter(record => record.name === candidate && record.type === 'CAA').flatMap(record => record.values as readonly CaaValue[]);
    if (values.length > 0) return values;
  }
  return undefined;
}

function caaBlockers(ctx: PlanContext, requirements: readonly DnsPlanRequirement[]): DnsPlanBlocker[] {
  const blockers: DnsPlanBlocker[] = [];
  for (const requirement of requirements) {
    if (requirement.caa === undefined) continue;
    const issuer = requirement.caa.issuer.trim().toLowerCase();
    const names = new Set([requirement.domain, ...requirement.records.map(record => record.name)].map(name => normalizeDnsName({ name })));
    for (const name of names) {
      const values = relevantCaa(ctx, name);
      if (values && !caaAuthorizes(values, issuer, name.startsWith('*.'))) {
        blockers.push({ code: 'caa_excludes_issuer', name, message: `The CAA records covering ${name} do not authorize ${issuer} to issue its certificate.`, suggestion: `Add a CAA record '0 issue "${issuer}"' or remove the restriction.` });
      }
    }
  }
  return blockers;
}

function unsupportedBlockers(desired: readonly DnsRecord[], recordTypes: readonly DnsRecordType[] | undefined): DnsPlanBlocker[] {
  if (recordTypes === undefined) return [];
  return desired.filter(record => !recordTypes.includes(record.type))
    .map(record => ({ code: 'unsupported_record_type', name: record.name, message: `This DNS host cannot serve the required ${record.type} record at ${record.name}.` }));
}

function planNames(ctx: PlanContext, skip: ReadonlySet<string>): Planned {
  const changes: DnsChange[] = [];
  const blockers: DnsPlanBlocker[] = [];
  const names = [...new Set(ctx.desired.map(record => record.name))].filter(name => !skip.has(name));
  for (const name of names) {
    const blocker = nameBlocker(ctx, name);
    if (blocker) {
      blockers.push(blocker);
      continue;
    }
    const address = planAddressName(ctx, name);
    changes.push(...address.changes);
    blockers.push(...address.blockers);
    for (const want of ctx.desired.filter(record => record.name === name && !DNS_ADDRESS_TYPES.has(record.type))) {
      const planned = planAdditive(ctx, want);
      changes.push(...planned.changes);
      blockers.push(...planned.blockers);
    }
  }
  return { changes, blockers };
}

/**
 * Plan the changes that make `current` satisfy `requirements`.
 * A non-`complete` inventory yields zero changes and a blocker: a plan over a partial view could
 * delete or shadow a record nobody looked at. Any blocker makes the plan unapprovable; changes for
 * unblocked names are still listed so the operator sees the whole picture.
 * @complexity O(r·c) over required and current RRsets.
 */
export function planDnsChanges(required: PlanDnsChangesInput, optional: PlanDnsChangesOptions = {}): DnsChangePlan {
  const zone = normalizeDnsName({ name: required.zone });
  const current = required.current.map(normalizeRecord);
  const base = { providerId: required.providerId, zone, inventory: required.inventory };
  if (required.inventory !== 'complete') {
    return finalize({ ...base, changes: [], preserved: current, blockers: [{ code: 'inventory_incomplete', name: zone, message: `The existing records of ${zone} could not be fully read (inventory: ${required.inventory}); nothing will be changed.` }] });
  }
  const desired = desiredRecordSets({ requirements: required.requirements, defaultTtl: optional.defaultTtl ?? DEFAULT_DNS_TTL });
  const ctx: PlanContext = { zone, current, desired: desired.records, apexFlattening: optional.apexFlattening ?? false };
  const unsupported = unsupportedBlockers(desired.records, optional.recordTypes);
  const planned = planNames(ctx, new Set(unsupported.map(blocker => blocker.name)));
  const changes = [...planned.changes].sort((a, b) => OP_ORDER[a.op] - OP_ORDER[b.op]);
  const touched = new Set(changes.flatMap(change => (change.before ? [recordKey(change.before)] : [])));
  return finalize({
    ...base,
    changes,
    preserved: current.filter(record => !touched.has(recordKey(record))),
    blockers: [...desired.blockers, ...unsupported, ...planned.blockers, ...caaBlockers(ctx, required.requirements)],
  });
}
