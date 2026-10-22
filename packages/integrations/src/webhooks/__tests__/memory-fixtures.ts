import type {
  WebhookDeliveryRepoPort,
  WebhookSubscriptionRepoPort,
} from "../ports.js";
import type {
  IntegrationId,
  WebhookDeliveryRecord,
  WebhookEventEnvelope,
  WebhookSubscriptionRecord,
  WebhookTopic,
} from "../types.js";

function rowKey(workspaceId: string, id: string): string {
  return `${workspaceId}:${id}`;
}

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

export class InMemoryWebhookSubscriptionRepo implements WebhookSubscriptionRepoPort {
  private rows = new Map<string, WebhookSubscriptionRecord>();

  constructor(initialRows: WebhookSubscriptionRecord[] = []) {
    for (const row of initialRows) {
      this.rows.set(rowKey(row.workspaceId, row.id), row);
    }
  }

  async insert(record: WebhookSubscriptionRecord): Promise<void> {
    const key = rowKey(record.workspaceId, record.id);
    if (this.rows.has(key)) {
      throw new Error(`webhook subscription '${record.id}' already exists`);
    }
    this.rows.set(key, record);
  }

  async save(record: WebhookSubscriptionRecord): Promise<void> {
    this.rows.set(rowKey(record.workspaceId, record.id), record);
  }

  async findById(required: {
    workspaceId: string;
    id: IntegrationId;
  }): Promise<WebhookSubscriptionRecord | null> {
    return this.rows.get(rowKey(required.workspaceId, required.id)) ?? null;
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

export class InMemoryWebhookDeliveryRepo implements WebhookDeliveryRepoPort {
  private rows = new Map<string, WebhookDeliveryRecord>();

  constructor(initialRows: WebhookDeliveryRecord[] = []) {
    for (const row of initialRows) {
      this.rows.set(rowKey(row.workspaceId, row.id), row);
    }
  }

  async enqueue(required: { record: WebhookDeliveryRecord }): Promise<void> {
    const { record } = required;
    if ([...this.rows.values()].some((row) =>
      row.workspaceId === record.workspaceId && row.subscriptionId === record.subscriptionId && row.eventId === record.eventId
    )) return;
    this.rows.set(rowKey(record.workspaceId, record.id), record);
  }

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
    return due.map((row) => ({ ...row }));
  }

  /** The row, unless a `claimedAttempts` fence names an older claim than the row's current one. */
  private fenced(required: { workspaceId: string; id: IntegrationId }, claimedAttempts: number | undefined) {
    const row = this.rows.get(rowKey(required.workspaceId, required.id));
    if (!row || (claimedAttempts !== undefined && row.attempts !== claimedAttempts)) return undefined;
    return row;
  }

  async releaseClaim(required: { workspaceId: string; id: IntegrationId; claimedAttempts: number; nextAttemptAt: string }): Promise<void> {
    const row = this.fenced(required, required.claimedAttempts);
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
    const row = this.fenced(required, optional.claimedAttempts);
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
    const row = this.fenced(required, optional.claimedAttempts);
    if (!row) return;

    row.lastError = required.error;
    row.lastResponseStatus = required.responseStatus;
    row.nextAttemptAt = required.nextAttemptAt;

    if (required.nextStatus === "dead") {
      row.status = "dead";
      row.deadAt = optional.deadAtIso ?? row.deadAt;
    } else {
      row.status = "pending";
    }
  }

  async findById(required: {
    workspaceId: string;
    id: IntegrationId;
  }): Promise<WebhookDeliveryRecord | null> {
    return this.rows.get(rowKey(required.workspaceId, required.id)) ?? null;
  }

  async listBySubscription(required: {
    workspaceId: string;
    subscriptionId: IntegrationId;
    limit: number;
  }): Promise<WebhookDeliveryRecord[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.workspaceId === required.workspaceId && row.subscriptionId === required.subscriptionId
      )
      .slice(0, required.limit);
  }
}

export interface DeliveryEnvelopeStore {
  save(input: { deliveryId: IntegrationId; envelope: WebhookEventEnvelope }): Promise<void>;
  find(input: { deliveryId: IntegrationId }): Promise<WebhookEventEnvelope | null>;
}

export class InMemoryDeliveryEnvelopeStore implements DeliveryEnvelopeStore {
  private envelopes = new Map<string, WebhookEventEnvelope>();

  async save(input: { deliveryId: IntegrationId; envelope: WebhookEventEnvelope }): Promise<void> {
    this.envelopes.set(input.deliveryId, input.envelope);
  }

  async find(input: { deliveryId: IntegrationId }): Promise<WebhookEventEnvelope | null> {
    return this.envelopes.get(input.deliveryId) ?? null;
  }
}

import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";


export interface RecordedHttpCall {
  readonly request: HttpRequest;
}

export type ScriptedHttpResponse = HttpResponse | (() => HttpResponse);

export interface RecordingHttpClientOptions {

  responses?: readonly ScriptedHttpResponse[];
}

export class RecordingHttpClient implements HttpClientPort {
  readonly calls: RecordedHttpCall[] = [];

  private readonly responses: readonly ScriptedHttpResponse[];
  private cursor = 0;

  constructor(options: RecordingHttpClientOptions = {}) {
    this.responses = options.responses ?? [{ status: 200, headers: {}, bodyText: "" }];
  }

  async send({ request }: { request: HttpRequest }): Promise<HttpResponse> {
    this.calls.push({ request });

    const index = Math.min(this.cursor, this.responses.length - 1);
    const entry = this.responses[index];
    if (!entry) throw new Error("no response configured");
    this.cursor += 1;

    return typeof entry === "function" ? entry() : entry;
  }
}
