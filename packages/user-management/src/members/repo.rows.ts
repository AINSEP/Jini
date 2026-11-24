import type { Generated, Insertable, Selectable } from "kysely";

import type { JsonObject } from "@jini-ai/core/primitives";
import { toBool } from "@jini-ai/core/contracts/storage";
import type {
  ConsentEvidence,
  ConsentPurpose,
  ConsentStatus,
  MagicLinkTokenRecord,
  MemberConsentRecord,
  MemberConsentRevisionRecord,
  MemberExternalIdentityRecord,
  MemberRecord,
  MemberSessionRecord,
  MemberStatus,
  MemberSubscriptionRecord,
  MemberSubscriptionSource,
  MemberSubscriptionStatus,
  MemberTierRecord,
  MemberTierStatus,
  MemberTierType,
} from "./types.js";

/**
 * @file Row mapping for the `members` tables, shared by every dialect: the columns are the generated
 * `ContentDatabase` types (snake_case, JSON as compact text, booleans via `toBool`). Neutral on
 * purpose — no repo, no driver.
 */

/**
 * Stored column shapes of the member tables, copied without schema changes in the generated key
 * order of the host's content database types. The table names are host-owned (see `MemberTables`
 * in `repo.ts`).
 */
export interface MembersTable {
  id: string;
  workspace_id: string;
  email: string;
  name: string | null;
  email_verified_at: string | null;
  credentials_revoked_at: string | null;
  password_hash: string | null;
  status: string;
  note: string | null;
  fields_json: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}
export interface MemberTiersTable {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  description: string | null;
  welcome_page_path: string | null;
  visible_in_portal: Generated<number>;
  monthly_price_cents: number | null;
  yearly_price_cents: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}
export interface MemberSubscriptionsTable {
  id: string;
  workspace_id: string;
  member_id: string;
  tier_id: string;
  status: string;
  source: string;
  external_ref: string | null;
  started_at: string;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}
export interface MemberSessionsTable {
  id: string;
  workspace_id: string;
  member_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  user_agent: string | null;
  ip: string | null;
}
export interface MemberMagicTokensTable {
  id: string;
  workspace_id: string;
  member_id: string;
  email: string | null;
  token_hash: string;
  code_hash: string | null;
  failed_attempts: Generated<number>;
  purpose: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}
export interface MemberConsentsTable {
  id: string;
  workspace_id: string;
  member_id: string;
  purpose: string;
  status: string;
  evidence_json: string;
  granted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}
export interface MemberRevisionsTable {
  seq: Generated<number>;
  entity_kind: string;
  entity_id: string;
  workspace_id: string;
  member_id: string;
  purpose: string | null;
  op: string;
  before_json: string | null;
  after_json: string | null;
  origin_module: string | null;
  created_at: string;
}
export interface MemberExternalIdentitiesTable {
  id: string;
  workspace_id: string;
  member_id: string;
  provider_id: string;
  issuer: string;
  subject: string;
  linked_at: string;
  unlinked_at: string | null;
}


export type MemberRow = Selectable<MembersTable>;
export type MemberTierRow = Selectable<MemberTiersTable>;
export type MemberSubscriptionRow = Selectable<MemberSubscriptionsTable>;
export type MemberSessionRow = Selectable<MemberSessionsTable>;
export type MagicTokenRow = Selectable<MemberMagicTokensTable>;
export type MemberConsentRow = Selectable<MemberConsentsTable>;
export type MemberRevisionRow = Selectable<MemberRevisionsTable>;

/** Map only association columns; provider credentials never enter this record. O(1), pure. */
export function toMemberExternalIdentityRecord(required: { row: Selectable<MemberExternalIdentitiesTable> }, _options: Record<string, never> = {}): MemberExternalIdentityRecord {
  const { row } = required;
  return {
    id: row.id, workspaceId: row.workspace_id, memberId: row.member_id,
    providerId: row.provider_id, issuer: row.issuer, subject: row.subject, linkedAt: row.linked_at,
    ...(row.unlinked_at === null ? {} : { unlinkedAt: row.unlinked_at }),
  };
}

/** Write an absent marker as SQL NULL so explicit reconnect can clear it. O(1), pure. */
export function toMemberExternalIdentityRow(required: { record: MemberExternalIdentityRecord }, _options: Record<string, never> = {}): Insertable<MemberExternalIdentitiesTable> {
  const { record } = required;
  return {
    id: record.id, workspace_id: record.workspaceId, member_id: record.memberId,
    provider_id: record.providerId, issuer: record.issuer, subject: record.subject,
    linked_at: record.linkedAt, unlinked_at: record.unlinkedAt ?? null,
  };
}

export function toMemberRecord(row: MemberRow): MemberRecord {
  // Deliberate allowlist: password_hash is credential-only and must never reach admin/tool profiles.
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    name: row.name ?? undefined,
    emailVerifiedAt: row.email_verified_at ?? undefined,
    ...(row.credentials_revoked_at == null ? {} : { credentialsRevokedAt: row.credentials_revoked_at }),
    status: row.status as MemberStatus,
    note: row.note ?? undefined,
    fields: row.fields_json == null ? undefined : (JSON.parse(row.fields_json) as JsonObject),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
    // Absent columns stay present as `undefined` keys (the stored record shape callers compare against).
  } as MemberRecord;
}

export function toMemberRow(record: MemberRecord, _optional: Record<string, never> = {}): Insertable<MembersTable> {
  // Omit password_hash so ordinary profile upserts cannot erase a stored password.
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    email: record.email,
    name: record.name ?? null,
    email_verified_at: record.emailVerifiedAt ?? null,
    credentials_revoked_at: record.credentialsRevokedAt ?? null,
    status: record.status,
    note: record.note ?? null,
    fields_json: record.fields == null ? null : JSON.stringify(record.fields),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

export function toMemberTierRecord(row: MemberTierRow): MemberTierRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    type: row.type as MemberTierType,
    status: row.status as MemberTierStatus,
    description: row.description ?? undefined,
    welcomePagePath: row.welcome_page_path ?? undefined,
    visibleInPortal: toBool({ value: row.visible_in_portal }) === true,
    monthlyPriceCents: row.monthly_price_cents == null ? undefined : Number(row.monthly_price_cents),
    yearlyPriceCents: row.yearly_price_cents == null ? undefined : Number(row.yearly_price_cents),
    currency: row.currency ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
    // Absent columns stay present as `undefined` keys (the stored record shape callers compare against).
  } as MemberTierRecord;
}

export function toMemberTierRow(record: MemberTierRecord, _optional: Record<string, never> = {}): Insertable<MemberTiersTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    name: record.name,
    slug: record.slug,
    type: record.type,
    status: record.status,
    description: record.description ?? null,
    welcome_page_path: record.welcomePagePath ?? null,
    visible_in_portal: record.visibleInPortal ? 1 : 0,
    monthly_price_cents: record.monthlyPriceCents ?? null,
    yearly_price_cents: record.yearlyPriceCents ?? null,
    currency: record.currency ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

export function toMemberSubscriptionRecord(row: MemberSubscriptionRow): MemberSubscriptionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    tierId: row.tier_id,
    status: row.status as MemberSubscriptionStatus,
    source: row.source as MemberSubscriptionSource,
    externalRef: row.external_ref ?? undefined,
    startedAt: row.started_at,
    currentPeriodEnd: row.current_period_end ?? undefined,
    canceledAt: row.canceled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
    // Absent columns stay present as `undefined` keys (the stored record shape callers compare against).
  } as MemberSubscriptionRecord;
}

export function toMemberSubscriptionRow(
  record: MemberSubscriptionRecord, _optional: Record<string, never> = {}
): Insertable<MemberSubscriptionsTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    member_id: record.memberId,
    tier_id: record.tierId,
    status: record.status,
    source: record.source,
    external_ref: record.externalRef ?? null,
    started_at: record.startedAt,
    current_period_end: record.currentPeriodEnd ?? null,
    canceled_at: record.canceledAt ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

export function toMemberSessionRecord(row: MemberSessionRow): MemberSessionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? undefined,
    lastSeenAt: row.last_seen_at ?? undefined,
    userAgent: row.user_agent ?? undefined,
    ip: row.ip ?? undefined,
    // Absent columns stay present as `undefined` keys (the stored record shape callers compare against).
  } as MemberSessionRecord;
}

export function toMemberSessionRow(record: MemberSessionRecord, _optional: Record<string, never> = {}): Insertable<MemberSessionsTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    member_id: record.memberId,
    token_hash: record.tokenHash,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
    revoked_at: record.revokedAt ?? null,
    last_seen_at: record.lastSeenAt ?? null,
    user_agent: record.userAgent ?? null,
    ip: record.ip ?? null,
  };
}

/** Maps legacy/new-address challenge rows without adding an undefined identity to legacy records. @complexity O(1). */
export function toMagicLinkTokenRecord(row: MagicTokenRow, _optional: Record<string, never> = {}): MagicLinkTokenRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    ...(row.email === null ? {} : { email: row.email }),
    tokenHash: row.token_hash,
    ...(row.code_hash === null ? {} : { codeHash: row.code_hash }),
    // Keep the legacy record shape; an absent counter has always meant no failed attempts.
    ...(row.failed_attempts === 0 ? {} : { failedAttempts: Number(row.failed_attempts) }),
    purpose: row.purpose as MagicLinkTokenRecord["purpose"],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at ?? undefined,
  };
}

/** Stores new-address identity on the challenge only; legacy links retain a null email. @complexity O(1). */
export function toMagicLinkTokenRow(record: MagicLinkTokenRecord, _optional: Record<string, never> = {}): Insertable<MemberMagicTokensTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    member_id: record.memberId,
    email: record.email ?? null,
    token_hash: record.tokenHash,
    code_hash: record.codeHash ?? null,
    failed_attempts: record.failedAttempts ?? 0,
    purpose: record.purpose,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
    consumed_at: record.consumedAt ?? null,
  };
}

export function toMemberConsentRecord(row: MemberConsentRow, _optional: Record<string, never> = {}): MemberConsentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    purpose: row.purpose as ConsentPurpose,
    status: row.status as ConsentStatus,
    evidence: JSON.parse(row.evidence_json) as ConsentEvidence,
    grantedAt: row.granted_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

export function toMemberConsentRow(record: MemberConsentRecord, _optional: Record<string, never> = {}): Insertable<MemberConsentsTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    member_id: record.memberId,
    purpose: record.purpose,
    status: record.status,
    evidence_json: JSON.stringify(record.evidence),
    granted_at: record.grantedAt ?? null,
    revoked_at: record.revokedAt ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

export function toMemberConsentRevisionRecord(row: MemberRevisionRow): MemberConsentRevisionRecord {
  return {
    seq: Number(row.seq),
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    consentId: row.entity_id,
    purpose: (row.purpose ?? "") as ConsentPurpose,
    op: row.op as MemberConsentRevisionRecord["op"],
    beforeJson: row.before_json == null ? null : (JSON.parse(row.before_json) as JsonObject),
    afterJson: row.after_json == null ? null : (JSON.parse(row.after_json) as JsonObject),
    originModule: row.origin_module ?? "",
    createdAt: row.created_at,
  };
}

/** The `member_revisions` row a consent revision appends (compact JSON snapshots). */
export function toConsentRevisionRow(
  record: Omit<MemberConsentRevisionRecord, "seq">, _optional: Record<string, never> = {}
): Insertable<MemberRevisionsTable> {
  return {
    entity_kind: "consent",
    entity_id: record.consentId,
    workspace_id: record.workspaceId,
    member_id: record.memberId,
    purpose: record.purpose,
    op: record.op,
    before_json: record.beforeJson == null ? null : JSON.stringify(record.beforeJson),
    after_json: record.afterJson == null ? null : JSON.stringify(record.afterJson),
    origin_module: record.originModule,
    created_at: record.createdAt,
  };
}
