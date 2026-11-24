import type { Generated, Insertable, Kysely, Selectable } from "kysely";

import { toBool, type StorageKernel } from "@jini-ai/core/contracts/storage";
import type {
  AudienceSnapshotRow,
  CampaignCounters,
  CampaignRecord,
  CampaignRevision,
  ConfirmationTokenRecord,
  NewsletterListRow,
  SendRow,
  SubscriptionRow,
} from "./types.js";

/**
 * @file Row types and mapping for the newsletter tables, shared by every dialect. The campaign pair
 * is in the migrated core schema, so its columns are the generated `ContentDatabase` types
 * (snake_case, JSON as compact text). The five `p_newsletter__*` tables are created by the
 * dataModule engine (`data-module-manifest.ts`), not the migrated schema, so they are NOT in
 * `ContentDatabase`: the repo brings them into a query with Kysely's `withTables<NewsletterTables>()`.
 * Neutral on purpose: no repo, no driver.
 *
 * Now: the campaign pair's stored column shape is copied here without schema changes (the host owns
 * that schema), the manifest is `@jini-ai/user-management/newsletter/data-module-manifest`, and every
 * table name is host-owned ({@link NewsletterSqlTables}): each repo brings its tables into a query
 * with Kysely's `withTables<…TableViews>()`.
 */

/** Host-owned table names. No schema or product table defaults live in the adapters. */
export interface NewsletterSqlTables {
  campaigns: string;
  campaignRevisions: string;
  lists: string;
  subscriptions: string;
  audienceSnapshots: string;
  sends: string;
  confirmationTokens: string;
}

/** Reported when a stored campaign revision cannot be read: identity and sequence only. The host binds its own logger. */
export type CampaignBodyReporter = (required: { campaignId: string; seq: number | null | undefined }, optional?: Record<string, never>) => void;

/** Constructor requirement shared by every newsletter SQL repo: the schema-free kernel and the host's table names. */
export interface NewsletterSqlRequired<K extends keyof NewsletterSqlTables = keyof NewsletterSqlTables> {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: Pick<NewsletterSqlTables, K>;
}

/** Stored `newsletter_campaigns` columns, in the host schema's generated key order. */
export interface CampaignsTable {
  id: string;
  workspace_id: string;
  status: string;
  subject: string;
  preheader: string | null;
  from_name: string;
  from_email: string;
  reply_to: string;
  list_id: string;
  scheduled_at: string | null;
  send_started_at: string | null;
  audience_snapshot_id: string | null;
  counters_json: string;
  version: number;
  created_by_principal: string;
  created_at: string;
  updated_at: string;
}

/** Stored `newsletter_campaign_revisions` columns, in the host schema's generated key order. */
export interface CampaignRevisionsTable {
  seq: Generated<number>;
  campaign_id: string;
  workspace_id: string;
  state_json: string;
  actor_id: string;
  recorded_at: string;
}

export type ListTableRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  is_default: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type SubscriptionTableRow = {
  id: string;
  workspace_id: string;
  list_id: string;
  subscriber_id: string;
  status: string;
  source: string;
  consent_revision_id_at_subscribe: string | null;
  subscribed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AudienceSnapshotTableRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  list_id: string;
  recipient_count: number;
  created_at: string;
};

export type SendTableRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  audience_snapshot_id: string;
  subscriber_id: string;
  recipient_email: string;
  status: string;
  attempts: number;
  idempotency_key: string;
  provider_message_id: string | null;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ConfirmationTokenTableRow = {
  id: string;
  workspace_id: string;
  subscription_id: string;
  token_hash: string;
  purpose: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

/** The tables the newsletter repos add to the content kernel's schema. Type aliases, not interfaces:
 *  Kysely's `withTables` needs the implicit index signature only an alias has.
 *  Now: one per-table view each, a `Record<string, Row>` alias keyed by the host-owned table name. */
export type ListTableViews = Record<string, ListTableRow>;
export type SubscriptionTableViews = Record<string, SubscriptionTableRow>;
export type AudienceSnapshotTableViews = Record<string, AudienceSnapshotTableRow>;
export type SendTableViews = Record<string, SendTableRow>;
export type ConfirmationTokenTableViews = Record<string, ConfirmationTokenTableRow>;
export type CampaignTableViews = Record<string, CampaignsTable>;
export type CampaignRevisionTableViews = Record<string, CampaignRevisionsTable>;
/**
 * The view of the campaign pair a detail read correlates. Every name resolves to the union of their
 * columns, which is exact here: the one column they share (`workspace_id`) has one type.
 */
export type CampaignJoinTableViews = Record<string, CampaignsTable & CampaignRevisionsTable>;

export type CampaignTableRow = Selectable<CampaignsTable>;
export type CampaignRevisionTableRow = Selectable<CampaignRevisionsTable>;

/** Read only the opened campaign's document. Corrupt revisions keep the envelope usable;
 * log identity/sequence only, never document text or the parser's potentially private message. */
function editorialBody({ row, onUnreadableBody }: { row: { id: string; editorial_state_json?: string | null; editorial_seq?: number | null }; onUnreadableBody: CampaignBodyReporter }): CampaignRecord["bodyJson"] {
  if (!row.editorial_state_json) return undefined;
  try {
    const state: unknown = JSON.parse(row.editorial_state_json);
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new TypeError("Campaign revision must be an object");
    return (state as CampaignRecord).bodyJson;
  } catch {
    onUnreadableBody({ campaignId: row.id, seq: row.editorial_seq });
    return undefined;
  }
}

/** One `newsletter_campaigns` row as a {@link CampaignRecord}.
 * Now: an unreadable revision body goes to `onUnreadableBody`. */
export function toCampaignRecord(
  { row, onUnreadableBody }: { row: CampaignTableRow & { editorial_state_json?: string | null; editorial_seq?: number | null }; onUnreadableBody: CampaignBodyReporter },
  _optional: Record<string, never> = {}
): CampaignRecord {
  const bodyJson = editorialBody({ row, onUnreadableBody });
  return {
    ...(bodyJson === undefined ? {} : { bodyJson }),
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status as CampaignRecord["status"],
    subject: row.subject,
    preheader: row.preheader,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    listId: row.list_id,
    scheduledAt: row.scheduled_at,
    sendStartedAt: row.send_started_at,
    audienceSnapshotId: row.audience_snapshot_id,
    counters: JSON.parse(row.counters_json) as CampaignCounters,
    version: row.version,
    createdByPrincipal: row.created_by_principal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The `newsletter_campaigns` row an INSERT writes. */
export function toCampaignRow(c: CampaignRecord, _optional: Record<string, never> = {}): Insertable<CampaignsTable> {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    status: c.status,
    subject: c.subject,
    preheader: c.preheader,
    from_name: c.fromName,
    from_email: c.fromEmail,
    reply_to: c.replyTo,
    list_id: c.listId,
    scheduled_at: c.scheduledAt,
    send_started_at: c.sendStartedAt,
    audience_snapshot_id: c.audienceSnapshotId,
    counters_json: JSON.stringify(c.counters),
    version: c.version,
    created_by_principal: c.createdByPrincipal,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

/**
 * The columns a re-save overwrites: everything except the key and the counters, which are
 * insert-only here (`incrementCounter` owns them afterwards, see `ports.ts`).
 */
export function updatableCampaignColumns(row: Insertable<CampaignsTable>, _optional: Record<string, never> = {}) {
  const { id: _id, counters_json: _counters, ...updatable } = row;
  return updatable;
}

/** One `newsletter_campaign_revisions` row as a {@link CampaignRevision}. */
export function toCampaignRevision(row: CampaignRevisionTableRow): CampaignRevision {
  return {
    campaignId: row.campaign_id,
    workspaceId: row.workspace_id,
    seq: row.seq,
    state: JSON.parse(row.state_json) as CampaignRecord,
    actorId: row.actor_id,
    recordedAt: row.recorded_at,
  };
}

/** One `p_newsletter__lists` row as a {@link NewsletterListRow}; `is_default` is read through `toBool`. */
export function toListRecord(row: Selectable<ListTableRow>): NewsletterListRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    isDefault: toBool({ value: row.is_default }) === true,
    status: row.status as NewsletterListRow["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The `p_newsletter__lists` row an INSERT writes. */
export function toListRow(row: NewsletterListRow, _optional: Record<string, never> = {}): Insertable<ListTableRow> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    slug: row.slug,
    is_default: row.isDefault ? 1 : 0,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** The columns a re-save of a list overwrites: everything except the key, workspace and creation time. */
export function updatableListColumns(row: Insertable<ListTableRow>, _optional: Record<string, never> = {}) {
  const { id: _id, workspace_id: _workspace, created_at: _created, ...updatable } = row;
  return updatable;
}

/** One `p_newsletter__subscriptions` row as a {@link SubscriptionRow}. */
export function toSubscriptionRecord(row: Selectable<SubscriptionTableRow>): SubscriptionRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    listId: row.list_id,
    subscriberId: row.subscriber_id,
    status: row.status as SubscriptionRow["status"],
    source: row.source as SubscriptionRow["source"],
    consentRevisionIdAtSubscribe: row.consent_revision_id_at_subscribe,
    subscribedAt: row.subscribed_at,
    unsubscribedAt: row.unsubscribed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The `p_newsletter__subscriptions` row an INSERT writes. */
export function toSubscriptionRow(row: SubscriptionRow, _optional: Record<string, never> = {}): Insertable<SubscriptionTableRow> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    list_id: row.listId,
    subscriber_id: row.subscriberId,
    status: row.status,
    source: row.source,
    consent_revision_id_at_subscribe: row.consentRevisionIdAtSubscribe,
    subscribed_at: row.subscribedAt,
    unsubscribed_at: row.unsubscribedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** The columns a re-save of a subscription overwrites: its lifecycle, not its identity (list, subscriber, source, creation). */
export function updatableSubscriptionColumns(row: Insertable<SubscriptionTableRow>, _optional: Record<string, never> = {}) {
  return {
    status: row.status,
    consent_revision_id_at_subscribe: row.consent_revision_id_at_subscribe,
    subscribed_at: row.subscribed_at,
    unsubscribed_at: row.unsubscribed_at,
    updated_at: row.updated_at,
  };
}

/** One `p_newsletter__audience_snapshots` row as an {@link AudienceSnapshotRow}. */
export function toAudienceSnapshotRecord(row: Selectable<AudienceSnapshotTableRow>, _optional: Record<string, never> = {}): AudienceSnapshotRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    listId: row.list_id,
    recipientCount: row.recipient_count,
    createdAt: row.created_at,
  };
}

/** The `p_newsletter__audience_snapshots` row an INSERT writes. */
export function toAudienceSnapshotRow(row: AudienceSnapshotRow, _optional: Record<string, never> = {}): Insertable<AudienceSnapshotTableRow> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    campaign_id: row.campaignId,
    list_id: row.listId,
    recipient_count: row.recipientCount,
    created_at: row.createdAt,
  };
}

/** One `p_newsletter__sends` row as a {@link SendRow}. */
export function toSendRecord(row: Selectable<SendTableRow>): SendRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    audienceSnapshotId: row.audience_snapshot_id,
    subscriberId: row.subscriber_id,
    recipientEmail: row.recipient_email,
    status: row.status as SendRow["status"],
    attempts: row.attempts,
    idempotencyKey: row.idempotency_key,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The `p_newsletter__sends` row an INSERT writes. */
export function toSendRow(row: SendRow, _optional: Record<string, never> = {}): Insertable<SendTableRow> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    campaign_id: row.campaignId,
    audience_snapshot_id: row.audienceSnapshotId,
    subscriber_id: row.subscriberId,
    recipient_email: row.recipientEmail,
    status: row.status,
    attempts: row.attempts,
    idempotency_key: row.idempotencyKey,
    provider_message_id: row.providerMessageId,
    last_error: row.lastError,
    next_attempt_at: row.nextAttemptAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** The columns a re-save of a send overwrites: its delivery state, not its identity (campaign, snapshot, subscriber, key). */
export function updatableSendColumns(row: Insertable<SendTableRow>, _optional: Record<string, never> = {}) {
  return {
    status: row.status,
    attempts: row.attempts,
    provider_message_id: row.provider_message_id,
    last_error: row.last_error,
    next_attempt_at: row.next_attempt_at,
    recipient_email: row.recipient_email,
    updated_at: row.updated_at,
  };
}

/** One `p_newsletter__confirmation_tokens` row as a {@link ConfirmationTokenRecord}. */
export function toConfirmationTokenRecord(row: Selectable<ConfirmationTokenTableRow>): ConfirmationTokenRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    subscriptionId: row.subscription_id,
    tokenHash: row.token_hash,
    purpose: row.purpose as ConfirmationTokenRecord["purpose"],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

/** The `p_newsletter__confirmation_tokens` row an INSERT writes. */
export function toConfirmationTokenRow(row: ConfirmationTokenRecord, _optional: Record<string, never> = {}): Insertable<ConfirmationTokenTableRow> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    subscription_id: row.subscriptionId,
    token_hash: row.tokenHash,
    purpose: row.purpose,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    consumed_at: row.consumedAt,
  };
}
