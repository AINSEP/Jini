import type { Insertable, Kysely, Selectable } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

import type { WebhookDeliveriesTable, WebhookSubscriptionsTable } from "./repo.rows.js";

/** Host type boundary for durable repositories (ADR-036).
 * Webhook tables are core-owned, not third-party plugin data modules; writes use the host mutation
 * chokepoint and composite workspace isolation. API keys remain owned by identity.
 * Host rows use stable ULIDs. Delivery/signature/envelope contracts belong to the Jini owner.
 */
import type { DeliveryEnvelopeStorePort as DeliveryEnvelopeStore } from "../ports.js";
import type { WebhookDeliveryRepoPort, WebhookSubscriptionRepoPort } from "../ports.js";
import type {
  IntegrationId,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookEventEnvelope,
  WebhookSubscriptionRecord,
  WebhookSubscriptionStatus,
  WebhookTopic,
} from "../types.js";

/**
 * @file THE adapters for the `integrations` webhook repo ports (ADR-036 §2, ADR-PIPE-015 Phase 2,
 * GAP-05 + GAP-12): one Kysely query body each for every dialect (storage plan §4, ADR-066).
 * The host's SQLite binding holds the thin subclasses built from its content db handle, passing
 * its table names ({@link WebhookTables}).
 *
 * Purpose:
 * The other half of each ADR-006 rule-of-two, mirroring `repo.memory.ts`'s in-memory shape
 * exactly (same claim/mark lifecycle, same `topicMatches` semantics). `SqlWebhookDeliveryRepo`
 * additionally implements `DeliveryEnvelopeStore` against the SAME `webhook_deliveries` row (its
 * `payload_json` column) rather than a separate table — GAP-05 (no durable storage) and GAP-12
 * (no envelope re-hydration path) are the same underlying gap, per the ADR's own Rationale.
 *
 * How it relates to the project:
 * - `enqueueDelivery` (`../delivery.ts`) calls `deliveryRepo.enqueue()` then
 *   `envelopeStore.save()` as two sequential calls (see that file) — both land on the same row
 *   here, `save()` updating the `payload_json` column `enqueue()` left `NULL`.
 * - The unique index on `(workspace_id, subscription_id, event_id)` (the host schema) makes `enqueue`
 *   idempotent at the storage layer: a duplicate insert is `ON CONFLICT DO NOTHING` (any unique
 *   index, the primary key included — not a caught error, which would abort an enclosing
 *   Postgres transaction), closing the race `delivery.ts`'s scan-based pre-check alone can't (two
 *   concurrent enqueues could both pass the scan before either commits).
 *
 * `claimPending` selects and marks rows `delivering` in one kernel transaction under
 * `lockKey("webhook_deliveries:claim")`, so two claimers never take the same row on any dialect.
 */

/** Host-owned table names. No schema or product table defaults live in the adapter. */
export interface WebhookTables { webhookSubscriptions: string; webhookDeliveries: string }
export interface WebhookSqlRequired { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: WebhookTables }

/**
 * Finishes a conditional subscription save: changed rows mean done; none means re-read the live
 * version and throw the host's conflict error. The host binds its optimistic-concurrency
 * implementation (normally `@jini-ai/core/optimistic-concurrency`'s `assertVersionedWrite`).
 */
export type AssertVersionedWritePort = (required: {
  changedRows: number | bigint;
  recordKind: string;
  recordId: string;
  expectedVersion: number;
  readCurrentVersion: () => Promise<number | null>;
}) => Promise<void>;

/** The subscription adapter's constructor object: the shared SQL deps plus its versioned-write collaborator. */
export interface WebhookSubscriptionSqlRequired extends WebhookSqlRequired { assertVersionedWrite: AssertVersionedWritePort }

function topicsToJson(topics: readonly WebhookTopic[]): string {
  return JSON.stringify(topics);
}

function topicsFromJson({ json }: { json: string }, _optional: Record<string, never> = {}): WebhookTopic[] {
  return JSON.parse(json) as WebhookTopic[];
}

function toSubscriptionRecord(row: Selectable<WebhookSubscriptionsTable>): WebhookSubscriptionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerPrincipalId: row.owner_principal_id,
    label: row.label,
    targetUrl: row.target_url,
    topics: topicsFromJson({ json: row.topics_json }),
    secretVersion: row.secret_version,
    previousSecretVersion: row.previous_secret_version,
    status: row.status as WebhookSubscriptionStatus,
    createdByPrincipalId: row.created_by_principal_id,
    createdByPluginId: row.created_by_plugin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
    version: row.version,
  };
}

function toSubscriptionRow(record: WebhookSubscriptionRecord): Insertable<WebhookSubscriptionsTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    owner_principal_id: record.ownerPrincipalId,
    label: record.label,
    target_url: record.targetUrl,
    topics_json: topicsToJson(record.topics),
    secret_version: record.secretVersion,
    previous_secret_version: record.previousSecretVersion,
    status: record.status,
    created_by_principal_id: record.createdByPrincipalId,
    created_by_plugin_id: record.createdByPluginId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    disabled_at: record.disabledAt,
    version: record.version,
  };
}

/**
 * Does a subscription's topic set match a delivered event's topic? Mirrors
 * `repo.memory.ts`'s `topicMatches` exactly — kept as a private duplicate rather than a shared
 * import so each adapter stays independently readable (same rationale the settings adapters use).
 */
function topicMatches(subscribedTopics: readonly WebhookTopic[], topic: WebhookTopic): boolean {
  return subscribedTopics.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern === topic) return true;
    if (pattern.endsWith(".*")) {
      const entityPrefix = pattern.slice(0, -1);
      return topic.startsWith(entityPrefix);
    }
    return false;
  });
}

export class SqlWebhookSubscriptionRepo implements WebhookSubscriptionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: WebhookTables;
  private readonly assertVersionedWrite: AssertVersionedWritePort;
  constructor({ kernel, tables, assertVersionedWrite }: WebhookSubscriptionSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.assertVersionedWrite = assertVersionedWrite;
  }

  /** Host-owned table name needs an explicit column schema, as in the outbox adapter. */
  private table(db: Kysely<unknown>) {
    return db.withTables<Record<string, WebhookSubscriptionsTable>>();
  }

  async insert(record: WebhookSubscriptionRecord): Promise<void> {
    await this.kernel.run((db) => this.table(db).insertInto(this.tables.webhookSubscriptions).values(toSubscriptionRow(record)).execute());
  }

  async save(record: WebhookSubscriptionRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const row = toSubscriptionRow(record);
    const { expectedVersion } = optional;
    if (expectedVersion !== undefined) {
      const { id: _id, workspace_id: _workspaceId, ...values } = row;
      // A single conditional UPDATE rejects stale editors without re-creating missing rows.
      const result = await this.kernel.run((db) => this.table(db).updateTable(this.tables.webhookSubscriptions).set(values)
        .where("workspace_id", "=", record.workspaceId).where("id", "=", record.id)
        .where("version", "=", expectedVersion).executeTakeFirst());
      await this.assertVersionedWrite({ changedRows: result.numUpdatedRows, recordKind: "webhook subscription", recordId: record.id,
        expectedVersion, readCurrentVersion: async () => (await this.findById({ workspaceId: record.workspaceId, id: record.id }))?.version ?? null });
      return;
    }
    await this.kernel.run((db) =>
      this.table(db)
        .insertInto(this.tables.webhookSubscriptions)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(row))
        .execute()
    );
  }

  async findById(required: {
    workspaceId: string;
    id: IntegrationId;
  }): Promise<WebhookSubscriptionRecord | null> {
    const row = await this.kernel.run((db) =>
      this.table(db)
        .selectFrom(this.tables.webhookSubscriptions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toSubscriptionRecord(row) : null;
  }

  async listByWorkspace(required: { workspaceId: string }): Promise<WebhookSubscriptionRecord[]> {
    const rows = await this.kernel.run((db) =>
      this.table(db).selectFrom(this.tables.webhookSubscriptions).selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map(toSubscriptionRecord);
  }

  async findMatching(required: {
    workspaceId: string;
    topic: WebhookTopic;
  }): Promise<WebhookSubscriptionRecord[]> {
    const rows = await this.kernel.run((db) =>
      this.table(db)
        .selectFrom(this.tables.webhookSubscriptions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("status", "=", "active")
        .execute()
    );
    return rows.map(toSubscriptionRecord).filter((row) => topicMatches(row.topics, required.topic));
  }
}

function toDeliveryRecord(row: Selectable<WebhookDeliveriesTable>): WebhookDeliveryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    subscriptionId: row.subscription_id,
    eventId: row.event_id,
    topic: row.topic as WebhookTopic,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastResponseStatus: row.last_response_status,
    lastError: row.last_error,
    signedWithVersion: row.signed_with_version,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    deadAt: row.dead_at,
  };
}

export class SqlWebhookDeliveryRepo implements WebhookDeliveryRepoPort, DeliveryEnvelopeStore {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: WebhookTables;
  constructor({ kernel, tables }: WebhookSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  /** Host-owned table name needs an explicit column schema, as in the outbox adapter. */
  private table(db: Kysely<unknown>) {
    return db.withTables<Record<string, WebhookDeliveriesTable>>();
  }

  /** ADR-046 fold-in item 5 (GAP-05/GAP-12): when `envelope` is supplied, it's written in this
   * SAME `INSERT` — never left `NULL` for a later `.update()` to fill in — so a durable claimable
   * delivery row can never exist with a missing envelope. A row that collides with any unique
   * index (`(workspace_id, subscription_id, event_id)` or the id) is already enqueued: idempotent
   * by design (INV-P4), a silent no-op. */
  async enqueue({ record }: { record: WebhookDeliveryRecord }, { envelope }: { envelope?: WebhookEventEnvelope } = {}): Promise<void> {
    await this.kernel.run((db) =>
      this.table(db)
        .insertInto(this.tables.webhookDeliveries)
        .values({
          id: record.id,
          workspace_id: record.workspaceId,
          subscription_id: record.subscriptionId,
          event_id: record.eventId,
          topic: record.topic,
          payload_json: envelope ? JSON.stringify(envelope) : null,
          status: record.status,
          attempts: record.attempts,
          next_attempt_at: record.nextAttemptAt,
          last_response_status: record.lastResponseStatus,
          last_error: record.lastError,
          signed_with_version: record.signedWithVersion,
          created_at: record.createdAt,
          delivered_at: record.deliveredAt,
          dead_at: record.deadAt,
        })
        .onConflict((oc) => oc.doNothing())
        .execute()
    );
  }

  /** With `claimLeaseMs`, a `delivering` row whose lease (`next_attempt_at`, no new column) has
   * expired is claimable again, and each claim writes nowIso + claimLeaseMs as its lease: a claimer
   * that crashed or was abandoned at shutdown no longer strands its rows in `delivering`. */
  async claimPending(required: {
    batchSize: number;
    nowIso: string;
  }, optional: { claimLeaseMs?: number } = {}): Promise<WebhookDeliveryRecord[]> {
    const { claimLeaseMs } = optional;
    const statuses = claimLeaseMs === undefined ? ["pending"] : ["pending", "delivering"];
    const lease = claimLeaseMs === undefined ? {} : { next_attempt_at: new Date(Date.parse(required.nowIso) + claimLeaseMs).toISOString() };
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey("webhook_deliveries:claim");
      const due = await this.kernel.run((db) =>
        this.table(db)
          .selectFrom(this.tables.webhookDeliveries)
          .selectAll()
          .where("status", "in", statuses)
          .where("next_attempt_at", "<=", required.nowIso)
          .orderBy("next_attempt_at", "asc")
          .limit(required.batchSize)
          .execute()
      );
      for (const row of due) {
        await this.kernel.run((db) =>
          this.table(db)
            .updateTable(this.tables.webhookDeliveries)
            .set({ status: "delivering", attempts: row.attempts + 1, ...lease })
            .where("id", "=", row.id)
            .execute()
        );
      }
      return due.map((row) => toDeliveryRecord({ ...row, status: "delivering", attempts: row.attempts + 1, ...lease }));
    });
  }

  /** Returns a never-attempted claim to `pending` with its attempt undone. Fenced on the claim's
   * attempts and on `delivering`, so a row reclaimed or settled since is left alone. */
  async releaseClaim(required: {
    workspaceId: string;
    id: IntegrationId;
    claimedAttempts: number;
    nextAttemptAt: string;
  }, _optional: Record<string, never> = {}): Promise<void> {
    await this.kernel.run((db) =>
      this.table(db)
        .updateTable(this.tables.webhookDeliveries)
        .set({ status: "pending", attempts: required.claimedAttempts - 1, next_attempt_at: required.nextAttemptAt })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .where("status", "=", "delivering")
        .where("attempts", "=", required.claimedAttempts)
        .execute()
    );
  }

  async markDelivered(required: {
    workspaceId: string;
    id: IntegrationId;
    responseStatus: number;
    deliveredAtIso: string;
  }, optional: { claimedAttempts?: number } = {}): Promise<void> {
    const { claimedAttempts } = optional;
    await this.kernel.run((db) =>
      this.table(db)
        .updateTable(this.tables.webhookDeliveries)
        .set({
          status: "delivered",
          last_response_status: required.responseStatus,
          delivered_at: required.deliveredAtIso,
          last_error: null,
        })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        // Ownership fence: a stale claimer's outcome must not overwrite a newer claim.
        .$if(claimedAttempts !== undefined, (qb) => claimedAttempts === undefined ? qb : qb.where("attempts", "=", claimedAttempts))
        .execute()
    );
  }

  /** One UPDATE: `dead_at` is only written when the row goes dead with a stamp; otherwise it keeps
   *  its stored value. A missing row is a no-op. */
  async markFailed(required: {
    workspaceId: string;
    id: IntegrationId;
    error: string;
    responseStatus: number | null;
    nextStatus: Extract<WebhookDeliveryStatus, "failed" | "dead">;
    nextAttemptAt: string;
  }, optional: { deadAtIso?: string; claimedAttempts?: number } = {}): Promise<void> {
    const dead = required.nextStatus === "dead";
    const { claimedAttempts } = optional;
    await this.kernel.run((db) =>
      this.table(db)
        .updateTable(this.tables.webhookDeliveries)
        .set({
          // "failed" re-enters "pending" immediately (WebhookDeliveryStatus doc); "dead" terminal.
          status: dead ? "dead" : "pending",
          last_error: required.error,
          last_response_status: required.responseStatus,
          next_attempt_at: required.nextAttemptAt,
          ...(dead && optional.deadAtIso !== undefined ? { dead_at: optional.deadAtIso } : {}),
        })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .$if(claimedAttempts !== undefined, (qb) => claimedAttempts === undefined ? qb : qb.where("attempts", "=", claimedAttempts))
        .execute()
    );
  }

  async findById(required: {
    workspaceId: string;
    id: IntegrationId;
  }): Promise<WebhookDeliveryRecord | null> {
    const row = await this.kernel.run((db) =>
      this.table(db)
        .selectFrom(this.tables.webhookDeliveries)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toDeliveryRecord(row) : null;
  }

  async listBySubscription(required: {
    workspaceId: string;
    subscriptionId: IntegrationId;
    limit: number;
  }, _optional: Record<string, never> = {}): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.kernel.run((db) =>
      this.table(db)
        .selectFrom(this.tables.webhookDeliveries)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("subscription_id", "=", required.subscriptionId)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(required.limit)
        .execute()
    );
    return rows.map(toDeliveryRecord);
  }

  // --- DeliveryEnvelopeStore (GAP-12: same row, `payload_json` column) ---

  async save(input: { deliveryId: IntegrationId; envelope: WebhookEventEnvelope }): Promise<void> {
    await this.kernel.run((db) =>
      this.table(db)
        .updateTable(this.tables.webhookDeliveries)
        .set({ payload_json: JSON.stringify(input.envelope) })
        .where("id", "=", input.deliveryId)
        .execute()
    );
  }

  async find(input: { deliveryId: IntegrationId }): Promise<WebhookEventEnvelope | null> {
    const row = await this.kernel.run((db) =>
      this.table(db).selectFrom(this.tables.webhookDeliveries).select("payload_json").where("id", "=", input.deliveryId).limit(1).executeTakeFirst()
    );
    if (!row || !row.payload_json) return null;
    return JSON.parse(row.payload_json) as WebhookEventEnvelope;
  }
}
