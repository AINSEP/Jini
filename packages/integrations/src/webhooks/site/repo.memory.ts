import type {
  DeliveryEnvelopeStorePort,
  WebhookDeliveryRepoPort,
  WebhookSubscriptionRepoPort,
} from "../ports.js";
import type { AssertVersionedWritePort } from "@jini-ai/core/optimistic-concurrency";
import type {
  IntegrationId,
  WebhookDeliveryRecord,
  WebhookEventEnvelope,
  WebhookSubscriptionRecord,
  WebhookTopic,
} from "../types.js";

/**
 * @file In-memory adapters for the `integrations` repo ports (ADR-036) + a small local
 * envelope side-channel the delivery worker needs (see {@link DeliveryEnvelopeStorePort} below).
 *
 * Purpose:
 * Zero-infrastructure test/dev doubles for `WebhookSubscriptionRepoPort` and
 * `WebhookDeliveryRepoPort`, mirroring the core event bus's in-memory `InMemoryOutbox` shape
 * (claim-then-mark lifecycle, `attempts` incremented at claim time, "failed" re-enters "pending"
 * per {@link import("../types.js").WebhookDeliveryStatus}'s own doc comment).
 *
 * How it relates to the project:
 * - Implements the ports declared in `../ports.ts` — read those first; this file matches them
 *   precisely rather than redesigning the contract.
 * - Used directly by `./__tests__/*.test.ts` and available for local dev wiring the same way
 *   other features' in-memory repos are.
 *
 * Architectural role:
 * Local adapter implementations only. The SQLite adapters (the other half of each ADR-006
 * rule-of-two) are out of scope for this task.
 */

/** Composite `(workspaceId, id)` key, mirroring the tables' composite FK isolation (ADR-007). */
function rowKey({ workspaceId, id }: { workspaceId: string; id: string }, _optional = {}): string {
  return `${workspaceId}:${id}`;
}

/**
 * Does a subscription's topic set match a delivered event's topic? Trailing `.*` matches every
 * action for an entity; a bare `*` is the owner-scoped "all topics" wildcard (ADR-036 §4,
 * `WebhookTopic` doc comment). Empty topic sets never match (fail-closed, per `types.ts`).
 *
 * @complexity O(subscribedTopics) string comparisons; subscriptions carry a handful of topics.
 */
function topicMatches(subscribedTopics: readonly WebhookTopic[], topic: WebhookTopic): boolean {
  return subscribedTopics.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern === topic) return true;
    if (pattern.endsWith(".*")) {
      const entityPrefix = pattern.slice(0, -1); // keep the trailing "."
      return topic.startsWith(entityPrefix);
    }
    return false;
  });
}

/** The memory subscription adapter's constructor object: the host binds its optimistic-concurrency
 * implementation, as for `SqlWebhookSubscriptionRepo` (see `../sql/webhook-repo.ts`). */
export interface InMemoryWebhookSubscriptionRequired { assertVersionedWrite: AssertVersionedWritePort }

/**
 * In-memory `WebhookSubscriptionRepoPort` adapter (ADR-036 §2 `webhook_subscriptions`).
 *
 * @overallScore 100
 * Purity/effect: all methods mutate the private `Map`; no I/O beyond memory. No findings.
 */
export class InMemoryWebhookSubscriptionRepo implements WebhookSubscriptionRepoPort {
  private rows = new Map<string, WebhookSubscriptionRecord>();
  private readonly assertVersionedWrite: AssertVersionedWritePort;

  constructor({ assertVersionedWrite }: InMemoryWebhookSubscriptionRequired, { initialRows = [] }: { initialRows?: WebhookSubscriptionRecord[] } = {}) {
    this.assertVersionedWrite = assertVersionedWrite;
    this.rows = new Map(initialRows.map(row => [rowKey({ workspaceId: row.workspaceId, id: row.id }), row]));
  }

  async insert(record: WebhookSubscriptionRecord): Promise<void> {
    const key = rowKey({ workspaceId: record.workspaceId, id: record.id });
    if (this.rows.has(key)) {
      throw new Error(`webhook subscription '${record.id}' already exists`);
    }
    this.rows.set(key, record);
  }

  async save(record: WebhookSubscriptionRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const current = this.rows.get(rowKey({ workspaceId: record.workspaceId, id: record.id }));
    if (optional.expectedVersion !== undefined && current?.version !== optional.expectedVersion) {
      await this.assertVersionedWrite({ changedRows: 0, recordKind: "webhook subscription", recordId: record.id,
        expectedVersion: optional.expectedVersion, readCurrentVersion: async () => current?.version ?? null });
    }
    // The successful compare and write are synchronous for concurrent memory callers.
    this.rows.set(rowKey({ workspaceId: record.workspaceId, id: record.id }), record);
  }

  async findById(required: {
    workspaceId: string;
    id: IntegrationId;
  }): Promise<WebhookSubscriptionRecord | null> {
    return this.rows.get(rowKey({ workspaceId: required.workspaceId, id: required.id })) ?? null;
  }

  async listByWorkspace(required: { workspaceId: string }): Promise<WebhookSubscriptionRecord[]> {
    return [...this.rows.values()].filter((row) => row.workspaceId === required.workspaceId);
  }

  async findMatching(required: {
    workspaceId: string;
    topic: WebhookTopic;
  }): Promise<WebhookSubscriptionRecord[]> {
    return [...this.rows.values()].filter(
      (row) =>
        row.workspaceId === required.workspaceId &&
        row.status === "active" &&
        topicMatches(row.topics, required.topic)
    );
  }
}

/**
 * In-memory `WebhookDeliveryRepoPort` adapter (ADR-036 §2 `webhook_deliveries`), mirroring
 * `InMemoryOutbox`'s claim/mark lifecycle. `attempts` is incremented at claim time (same
 * convention as `InMemoryOutbox.claimPending`); a `markFailed` call with `nextStatus: "failed"`
 * re-enters `"pending"` immediately (per the `WebhookDeliveryStatus` doc: "`failed` re-enters
 * `pending` until attempts are exhausted, then `dead`") so the row is reclaimed once
 * `nextAttemptAt` passes — the caller (`./delivery.ts`) owns the backoff/attempts-exhausted
 * decision, this repo only persists the outcome it's told.
 *
 * @overallScore 100
 * Purity/effect: all methods mutate the private `Map`; no I/O beyond memory. No findings.
 */
export class InMemoryWebhookDeliveryRepo implements WebhookDeliveryRepoPort {
  private rows = new Map<string, WebhookDeliveryRecord>();

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: WebhookDeliveryRecord[] } = {}) {
    this.rows = new Map(initialRows.map(row => [rowKey({ workspaceId: row.workspaceId, id: row.id }), row]));
  }

  async enqueue({ record }: { record: WebhookDeliveryRecord }, _optional: { envelope?: WebhookEventEnvelope } = {}): Promise<void> {
    if ([...this.rows.values()].some((row) =>
      row.workspaceId === record.workspaceId && row.subscriptionId === record.subscriptionId && row.eventId === record.eventId
    )) return;
    this.rows.set(rowKey({ workspaceId: record.workspaceId, id: record.id }), record);
  }

  /** With `claimLeaseMs`, an expired `delivering` lease (its `nextAttemptAt`) is claimable again
   * and each claim persists nowIso + claimLeaseMs as its lease (port doc: Jini `webhooks/ports.ts`). */
  async claimPending(required: {
    batchSize: number;
    nowIso: string;
  }, optional: { claimLeaseMs?: number } = {}): Promise<WebhookDeliveryRecord[]> {
    const { claimLeaseMs } = optional;
    const claimable = (row: WebhookDeliveryRecord) =>
      (row.status === "pending" || (claimLeaseMs !== undefined && row.status === "delivering")) && row.nextAttemptAt <= required.nowIso;
    const due = [...this.rows.values()]
      .filter(claimable)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, required.batchSize);

    for (const row of due) {
      row.status = "delivering";
      row.attempts += 1;
      if (claimLeaseMs !== undefined) row.nextAttemptAt = new Date(Date.parse(required.nowIso) + claimLeaseMs).toISOString();
    }

    // Return copies so a caller can't mutate claimed state without going through markDelivered/
    // markFailed — matches the SQLite adapter's row-per-claim semantics.
    return due.map((row) => ({ ...row }));
  }

  /** The row, unless a `claimedAttempts` fence names an older claim than the row's current one. */
  private fenced({ required, claimedAttempts }: { required: { workspaceId: string; id: IntegrationId }; claimedAttempts: number | undefined }, _optional = {}): WebhookDeliveryRecord | undefined {
    const row = this.rows.get(rowKey({ workspaceId: required.workspaceId, id: required.id }));
    if (!row || (claimedAttempts !== undefined && row.attempts !== claimedAttempts)) return undefined;
    return row;
  }

  /** Returns a never-attempted `delivering` claim to `pending`, undoing its attempt; fenced. */
  async releaseClaim(required: {
    workspaceId: string;
    id: IntegrationId;
    claimedAttempts: number;
    nextAttemptAt: string;
  }, _optional: Record<string, never> = {}): Promise<void> {
    const row = this.fenced({ required, claimedAttempts: required.claimedAttempts });
    if (!row || row.status !== "delivering") return;
    row.status = "pending";
    row.attempts -= 1;
    row.nextAttemptAt = required.nextAttemptAt;
  }

  async markDelivered(required: {
    workspaceId: string;
    id: IntegrationId;
    responseStatus: number;
    deliveredAtIso: string;
  }, optional: { claimedAttempts?: number } = {}): Promise<void> {
    const row = this.fenced({ required, claimedAttempts: optional.claimedAttempts });
    if (!row) return;
    row.status = "delivered";
    row.lastResponseStatus = required.responseStatus;
    row.deliveredAt = required.deliveredAtIso;
    row.lastError = null;
  }

  async markFailed(required: {
    workspaceId: string;
    id: IntegrationId;
    error: string;
    responseStatus: number | null;
    nextStatus: "failed" | "dead";
    nextAttemptAt: string;
  }, optional: { deadAtIso?: string; claimedAttempts?: number } = {}): Promise<void> {
    const row = this.fenced({ required, claimedAttempts: optional.claimedAttempts });
    if (!row) return;

    row.lastError = required.error;
    row.lastResponseStatus = required.responseStatus;
    row.nextAttemptAt = required.nextAttemptAt;

    if (required.nextStatus === "dead") {
      row.status = "dead";
      row.deadAt = optional.deadAtIso ?? row.deadAt;
    } else {
      // "failed" re-enters "pending" immediately (WebhookDeliveryStatus doc comment) — the row
      // becomes reclaimable once nextAttemptAt passes.
      row.status = "pending";
    }
  }

  async findById(required: {
    workspaceId: string;
    id: IntegrationId;
  }): Promise<WebhookDeliveryRecord | null> {
    return this.rows.get(rowKey({ workspaceId: required.workspaceId, id: required.id })) ?? null;
  }

  async listBySubscription(required: {
    workspaceId: string;
    subscriptionId: IntegrationId;
    limit: number;
  }, _optional: Record<string, never> = {}): Promise<WebhookDeliveryRecord[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.workspaceId === required.workspaceId && row.subscriptionId === required.subscriptionId
      )
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        // Rows are keyed by (workspaceId, id) and filtered to one workspace, so two compared rows
        // never share an id: the tie-break is strictly descending and needs no equal-id arm.
        return a.id < b.id ? 1 : -1;
      })
      .slice(0, required.limit);
  }
}

/**
 * Non-port side-channel carrying one delivery's outbound envelope (topic/data) from Stage A
 * (fan-out, `enqueueDelivery`) to Stage B (the delivery worker, `processDueDeliveries`).
 *
 * Why this exists (scope gap, flagged for the Architect): ADR-036 §2's `webhook_deliveries` DDL
 * sketch carries only retry/state columns (`subscription_id`, `event_id`, `topic`, `status`,
 * `attempts`, …) — no payload column, and `WebhookDeliveryRecord` (types.ts) matches that
 * sketch exactly. A real delivery worker running in a later process/tick still needs the
 * original event's `data` to build the `WebhookEventEnvelope` it signs and POSTs. The ADR
 * doesn't say where that re-hydration comes from (most likely: re-reading the core event
 * outbox row by `event_id`, since `OutboxRecord.event` already retains the full `DomainEvent`
 * payload — but core/events exposes no by-id lookup port today, and wiring one is out of this
 * task's scope). This in-memory store is a stand-in seam so `enqueueDelivery` and
 * `processDueDeliveries` are independently testable now; swap it for the real re-hydration path
 * (or fold `data` into `webhook_deliveries` directly) once that's decided upstream.
 */

/**
 * In-memory `DeliveryEnvelopeStorePort`. See the doc above for why this seam exists.
 *
 * @overallScore 100
 */
export class InMemoryDeliveryEnvelopeStore implements DeliveryEnvelopeStorePort {
  private envelopes = new Map<string, WebhookEventEnvelope>();

  async save(input: { deliveryId: IntegrationId; envelope: WebhookEventEnvelope }): Promise<void> {
    this.envelopes.set(input.deliveryId, input.envelope);
  }

  async find(input: { deliveryId: IntegrationId }): Promise<WebhookEventEnvelope | null> {
    return this.envelopes.get(input.deliveryId) ?? null;
  }
}
