/**
 * @file The generic DNS provider contract (lots D1–D3 of the domains & DNS design).
 *
 * Records are modelled as RRsets (`name` + `type` + `values[]`), because every DNS API and the
 * wire protocol itself treat the set as the unit of change: two TXT values at one name are one
 * record set, and replacing "the" A record of a name means replacing the set. Planning,
 * verification and approval are provider-neutral and live beside this file; a provider only
 * finds zones, lists records and (later, D4) applies changes.
 *
 * The requirement shapes (`DomainRequirement`) and the provider registry are shared with mail and
 * hosting providers in `@jini-ai/core/provider-registry`; they are reused, never redefined here.
 */
import type { HttpClientPort } from '@jini-ai/core/primitives';
import type {
  DnsRecordType as CoreDnsRecordType,
  DomainRequirement,
  ProviderContext,
  ProviderResult,
} from '@jini-ai/core/provider-registry';

/** Core record types plus `ALIAS` (apex flattening / provider alias targets), a DNS-host concept. */
export type DnsRecordType = CoreDnsRecordType | 'ALIAS';

/** Address records: at most one of these families may own a name (CNAME excludes everything). */
export const DNS_ADDRESS_TYPES: ReadonlySet<DnsRecordType> = new Set<DnsRecordType>(['A', 'AAAA', 'CNAME', 'ALIAS']);

/** TTL used when neither a requirement nor a provider supplies one. */
export const DEFAULT_DNS_TTL = 300;

/** RFC 1035 character-string limit for one TXT chunk, in bytes. */
export const TXT_CHUNK_BYTES = 255;

export interface MxValue {
  readonly priority: number;
  /** Normalized host name: lowercase, no trailing dot. */
  readonly exchange: string;
}

export type CaaTag = 'issue' | 'issuewild' | 'iodef';

export interface CaaValue {
  readonly flags: number;
  readonly tag: CaaTag;
  readonly value: string;
}

export type DnsRecordValue = string | MxValue | CaaValue;

interface DnsRecordBase {
  /** Fully-qualified, normalized name (lowercase, no trailing dot). */
  readonly name: string;
  readonly ttl: number;
  /** Provider proxy flag (e.g. a CDN reverse proxy); only meaningful when `capabilities.proxy`. */
  readonly proxied?: boolean;
  /** Provider-native alias target (e.g. a cloud load balancer) instead of literal values. */
  readonly providerAlias?: { readonly target: string };
  /**
   * `self` marks a record this engine created for the host; anything else is someone else's record.
   * (Neutral on purpose: product names belong to the host, never the engine.)
   */
  readonly managedBy?: 'self' | 'other';
  /** Opaque provider handle for later apply calls. Never shown to an operator. */
  readonly providerRef?: string;
}

/** A/AAAA/CNAME/ALIAS/NS/SRV carry plain strings; TXT carries the LOGICAL (unchunked) string. */
export interface DnsPlainRecord extends DnsRecordBase {
  readonly type: Exclude<DnsRecordType, 'MX' | 'CAA'>;
  readonly values: readonly string[];
}

export interface DnsMxRecord extends DnsRecordBase {
  readonly type: 'MX';
  readonly values: readonly MxValue[];
}

export interface DnsCaaRecord extends DnsRecordBase {
  readonly type: 'CAA';
  readonly values: readonly CaaValue[];
}

/** One RRset. */
export type DnsRecord = DnsPlainRecord | DnsMxRecord | DnsCaaRecord;

/** A shared requirement, optionally naming the CA the target will use so a CAA set can be checked. */
export type DnsPlanRequirement = DomainRequirement & { readonly caa?: { readonly issuer: string } };

/**
 * How much of the zone the provider could see. Only `complete` may ever lead to a mutation:
 * a plan over a partial view could delete or shadow a record nobody looked at.
 */
export type DnsInventory = 'complete' | 'partial' | 'unknown';

export interface DnsChange {
  readonly op: 'create' | 'update' | 'delete';
  readonly before?: DnsRecord;
  readonly after?: DnsRecord;
  readonly reason: string;
}

export type DnsPlanBlockerCode =
  | 'inventory_incomplete'
  | 'cname_coexistence'
  | 'apex_cname'
  | 'caa_excludes_issuer'
  | 'multiple_spf'
  | 'unsupported_record_type'
  | 'invalid_requirement'
  /** An address record not marked `managedBy: 'self'` would have been replaced or deleted. */
  | 'record_not_owned';

export interface DnsPlanBlocker {
  readonly code: DnsPlanBlockerCode;
  /** The record name the blocker is about (the zone for plan-wide blockers). */
  readonly name: string;
  readonly message: string;
  readonly suggestion?: string;
}

export interface DnsChangePlan {
  readonly providerId: string;
  readonly zone: string;
  /** Ordered: deletes, then updates, then creates. */
  readonly changes: readonly DnsChange[];
  /** Disclosed and untouched (wildcards, mail, TXT, CAA, unrelated records). */
  readonly preserved: readonly DnsRecord[];
  readonly inventory: DnsInventory;
  /** Any blocker makes the plan unapprovable. */
  readonly blockers: readonly DnsPlanBlocker[];
  /** sha-256 over the canonical plan; the approval binds to it. */
  readonly fingerprint: string;
}

/** Everything a provider call may use. Credentials are pre-resolved by the host. */
export interface DnsProviderContext extends ProviderContext {
  readonly credentials: Readonly<Record<string, string>>;
  readonly httpClient: HttpClientPort;
  readonly now: () => number;
}

export interface DnsZone {
  /** Normalized zone apex, e.g. `example.com` or a delegated subzone `dev.example.com`. */
  readonly zone: string;
  /** Opaque provider zone handle. */
  readonly ref: string;
}

export interface DnsProviderCapabilities {
  /** False: the provider cannot write (it emits instructions instead) and must omit `apply`. */
  readonly automatic: boolean;
  readonly recordTypes: readonly DnsRecordType[];
  /** True when a CNAME at the zone apex is flattened by the host. */
  readonly apexFlattening: boolean;
  readonly proxy: boolean;
}

export interface DnsInstructionRow {
  readonly action: 'add' | 'change' | 'remove';
  readonly type: DnsRecordType;
  /** Fully-qualified record name. */
  readonly name: string;
  /** Name relative to the zone, `@` for the apex — what most DNS host forms ask for. */
  readonly host: string;
  readonly value: string;
  readonly ttl: number;
  readonly priority?: number;
}

export interface DnsInstructions {
  readonly zone: string;
  readonly rows: readonly DnsInstructionRow[];
  readonly notes: readonly string[];
}

export interface DnsProvider {
  readonly id: string;
  readonly label: string;
  readonly credentialKeys: readonly string[];
  readonly capabilities: DnsProviderCapabilities;
  /** The zone (possibly a delegated subzone) serving `hostname`; `null` when the provider has none. */
  findZone(ctx: DnsProviderContext, required: { readonly hostname: string }): Promise<ProviderResult<DnsZone | null>>;
  listRecords(
    ctx: DnsProviderContext,
    required: { readonly zoneRef: string; readonly names: readonly string[] },
  ): Promise<ProviderResult<{ readonly records: readonly DnsRecord[]; readonly inventory: DnsInventory }>>;
  /** Declared for D4; unused in v1. Providers with `automatic: false` omit it. */
  apply?(
    ctx: DnsProviderContext,
    required: { readonly zoneRef: string; readonly change: DnsChange; readonly idempotencyKey: string },
  ): Promise<ProviderResult<{ readonly record?: DnsRecord }>>;
  /** Copy-pasteable steps for a human; `requirements` lets a blocked plan still show what is needed. */
  instructions?(
    required: { readonly plan: DnsChangePlan },
    optional?: { readonly requirements?: readonly DnsPlanRequirement[] },
  ): DnsInstructions;
}

/**
 * Queries a zone's authoritative servers directly, never through a caching recursive resolver,
 * so "propagated" means the source of truth answers, not one resolver's cache.
 *
 * Result convention: `ok` with an empty list is NODATA; `rejected` with `not_found` is NXDOMAIN;
 * `unknown` is a transport failure. A thrown error is treated as `unknown` by every caller.
 */
export interface AuthoritativeDnsPort {
  /** The NS set delegated to `zone` by its parent (what the registrar published). */
  queryNs(required: { readonly zone: string }): Promise<ProviderResult<readonly string[]>>;
  /** Records of exactly `type` at `name`, asked of `nameserver`; answers in presentation format. */
  query(required: {
    readonly name: string;
    readonly type: DnsRecordType;
    readonly nameserver: string;
  }): Promise<ProviderResult<{ readonly answers: readonly string[]; readonly ttl?: number }>>;
}

/**
 * Split a logical TXT value into ≤255-byte character-strings without splitting a UTF-8 sequence.
 * An empty value is one empty chunk (a TXT record always has at least one character-string).
 * @complexity O(n) in the value length.
 */
export function chunkTxt(required: { readonly value: string }, _optional = {}): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let size = 0;
  for (const char of required.value) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > TXT_CHUNK_BYTES) {
      chunks.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  chunks.push(current);
  return chunks;
}
