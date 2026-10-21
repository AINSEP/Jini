/**
 * @file The built-in default DNS provider, `manual`: no API and no credentials. It reads the zone
 * through the authoritative nameservers and turns a plan into copy-pasteable rows a person enters
 * at any DNS host. It works for every registrar out of the box, including delegated subzones.
 *
 * What it cannot read stays `unknown` — it never invents a CONFLICT or an empty zone.
 */
import { providerOk, type ProviderResult } from '@jini-ai/core/provider-registry';
import {
  DEFAULT_DNS_TTL,
  chunkTxt,
  type AuthoritativeDnsPort,
  type CaaValue,
  type DnsChange,
  type DnsChangePlan,
  type DnsInstructionRow,
  type DnsInstructions,
  type DnsPlanRequirement,
  type DnsProvider,
  type DnsRecord,
  type DnsRecordType,
  type DnsRecordValue,
  type DnsZone,
} from './contract.js';
import { settlePort } from './delegation.js';
import { buildRecord, isMxValue, normalizeDnsName, parseAnswerValue, requirementValue } from './records.js';

export const MANUAL_DNS_PROVIDER_ID = 'manual';

/** Every type the planner reasons about; a name answering all of these is fully known. */
const QUERIED_TYPES: readonly DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'CAA'];

export interface ManualDnsProviderOptions {
  readonly label?: string;
  /** Public-suffix check (e.g. `co.uk`), so a zone is never guessed at a suffix. */
  readonly isPublicSuffix?: (required: { readonly name: string }) => boolean;
}

type Lookup = { readonly kind: 'found'; readonly record: DnsRecord } | { readonly kind: 'none' } | { readonly kind: 'unknown' };

/** `www.example.com` in `example.com` → `www`; the apex is `@`. */
export function relativeHost(required: { readonly name: string; readonly zone: string }, _optional = {}): string {
  const { name, zone } = required;
  if (name === zone) return '@';
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
}

function valueText(type: DnsRecordType, value: DnsRecordValue): string {
  const input = { value };
  if (isMxValue(input)) return input.value.exchange;
  // MX returned above; a type guard on `input` does not narrow `value`.
  if (typeof value !== 'string') return `${(value as CaaValue).flags} ${(value as CaaValue).tag} "${(value as CaaValue).value}"`;
  // Long TXT values must be entered as several quoted strings on most DNS hosts.
  if (type === 'TXT' && new TextEncoder().encode(value).length > 255) return chunkTxt({ value }).map(chunk => `"${chunk}"`).join(' ');
  return value;
}

function rowsFor(record: DnsRecord, action: DnsInstructionRow['action'], zone: string): DnsInstructionRow[] {
  const values: readonly DnsRecordValue[] = record.values;
  return values.map(value => {
    const input = { value };
    return {
      action, type: record.type, name: record.name, host: relativeHost({ name: record.name, zone }),
      value: valueText(record.type, value), ttl: record.ttl,
      ...(isMxValue(input) ? { priority: input.value.priority } : {}),
    };
  });
}

const ACTION: Readonly<Record<DnsChange['op'], DnsInstructionRow['action']>> = { create: 'add', update: 'change', delete: 'remove' };

function changeRows(change: DnsChange, zone: string): DnsInstructionRow[] {
  const record = (change.after ?? change.before) as DnsRecord;
  return rowsFor(record, ACTION[change.op], zone);
}

/** When the plan could not be computed, show what is required so a person can still act. */
function requirementRows(requirements: readonly DnsPlanRequirement[], zone: string): DnsInstructionRow[] {
  return requirements.flatMap(requirement => requirement.records).flatMap(record => {
    const value = requirementValue({ record });
    if (value === undefined) return [];
    return rowsFor(buildRecord({ name: normalizeDnsName({ name: record.name }), type: record.type, ttl: record.ttl ?? DEFAULT_DNS_TTL, values: [value] }), 'add', zone);
  });
}

function instructionNotes(plan: DnsChangePlan, rows: readonly DnsInstructionRow[]): string[] {
  const notes = [`Make these changes at the DNS host that serves ${plan.zone} (check its NS records if unsure).`];
  if (rows.some(row => row.host === '@' && (row.type === 'CNAME' || row.type === 'ALIAS'))) {
    notes.push('At the zone apex many DNS hosts refuse a CNAME: use their ALIAS/ANAME/flattening option, or A/AAAA records.');
  }
  if (rows.some(row => row.action === 'change')) notes.push('"change" rows list the complete final set of values for that name and type.');
  if (plan.inventory !== 'complete') notes.push(`The existing records could not be read; first check ${plan.zone} for records at these names that conflict.`);
  for (const blocker of plan.blockers) notes.push(['Blocked:', blocker.message, ...(blocker.suggestion ? [blocker.suggestion] : [])].join(' '));
  return notes;
}

/** Copy-pasteable rows (type/name/value/TTL/priority) for a plan. */
export function renderDnsInstructions(
  required: { readonly plan: DnsChangePlan },
  optional: { readonly requirements?: readonly DnsPlanRequirement[] } = {},
): DnsInstructions {
  const { plan } = required;
  const fallback = plan.inventory !== 'complete' && optional.requirements !== undefined;
  const rows = fallback ? requirementRows(optional.requirements, plan.zone) : plan.changes.flatMap(change => changeRows(change, plan.zone));
  return { zone: plan.zone, rows, notes: instructionNotes(plan, rows) };
}

async function lookup(resolver: AuthoritativeDnsPort, required: { name: string; type: DnsRecordType; nameserver: string }): Promise<Lookup> {
  const result = await settlePort({ call: () => resolver.query(required) });
  if (result.status === 'rejected' && result.error.code === 'not_found') return { kind: 'none' };
  if (result.status !== 'ok') return { kind: 'unknown' };
  const values = result.value.answers.map(text => parseAnswerValue({ type: required.type, text })).filter((value): value is DnsRecordValue => value !== undefined);
  if (values.length === 0) return { kind: 'none' };
  return { kind: 'found', record: buildRecord({ name: required.name, type: required.type, ttl: result.value.ttl ?? DEFAULT_DNS_TTL, values }) };
}

/** Candidate zones for a host name, most specific first, never a bare TLD or a public suffix. */
function zoneCandidates(hostname: string, isPublicSuffix: ManualDnsProviderOptions['isPublicSuffix']): string[] {
  const labels = normalizeDnsName({ name: hostname }).split('.');
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join('.')).filter(name => !isPublicSuffix?.({ name }));
}

/**
 * Create the manual provider over an authoritative resolver.
 * @param required.resolver - Queries the zone's own nameservers (see {@link AuthoritativeDnsPort}).
 */
export function createManualDnsProvider(required: { readonly resolver: AuthoritativeDnsPort }, optional: ManualDnsProviderOptions = {}): DnsProvider {
  const { resolver } = required;
  return {
    id: MANUAL_DNS_PROVIDER_ID,
    label: optional.label ?? 'Manual (any DNS host)',
    credentialKeys: [],
    capabilities: { automatic: false, recordTypes: ['A', 'AAAA', 'CNAME', 'ALIAS', 'TXT', 'MX', 'CAA', 'NS', 'SRV'], apexFlattening: false, proxy: false },
    // The most specific name with its own NS delegation is the zone, so a delegated subzone
    // (`dev.example.com` served elsewhere) is found before its parent.
    async findZone(_ctx, { hostname }): Promise<ProviderResult<DnsZone | null>> {
      for (const zone of zoneCandidates(hostname, optional.isPublicSuffix)) {
        const result = await settlePort({ call: () => resolver.queryNs({ zone }) });
        if (result.status === 'unknown') return result;
        if (result.status === 'ok' && result.value.length > 0) return providerOk({ value: { zone, ref: zone } });
      }
      return providerOk({ value: null });
    },
    // Complete only for the requested names and the planner's types; any unread answer makes the
    // whole inventory unknown, which the planner turns into zero changes.
    async listRecords(_ctx, { zoneRef, names }) {
      const ns = await settlePort({ call: () => resolver.queryNs({ zone: zoneRef }) });
      const nameserver = ns.status === 'ok' ? ns.value[0] : undefined;
      if (nameserver === undefined) return providerOk({ value: { records: [], inventory: 'unknown' as const } });
      const lookups = await Promise.all(names.flatMap(name => QUERIED_TYPES.map(type => lookup(resolver, { name: normalizeDnsName({ name }), type, nameserver }))));
      const records = lookups.flatMap(found => (found.kind === 'found' ? [found.record] : []));
      const inventory = lookups.some(found => found.kind === 'unknown') ? 'unknown' as const : 'complete' as const;
      return providerOk({ value: { records, inventory } });
    },
    instructions: (instructionsRequired, instructionsOptional = {}) => renderDnsInstructions(instructionsRequired, instructionsOptional),
  };
}
