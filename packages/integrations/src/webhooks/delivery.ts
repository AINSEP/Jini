import { nowIso } from "@jini-ai/core/primitives";
// Keep transport, signing and persistence behind injected ports: this module owns the
// enqueue/retry/filter state machine, so its decisions can be inspected independently of I/O adapters.
import { IntegrationError } from "../argument-error.js";
import type { Clock, IdGenerator, ISODateTime, JsonObject, UUID } from "@jini-ai/core/primitives";

import type { DeliveryEnvelopeStorePort, WebhookHeaderVocabulary } from "./ports.js";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { WebhookDeliveryRepoPort, WebhookSubscriptionRepoPort } from "./ports.js";
import type { WebhookSigner } from "./signing.js";
import type {
  IntegrationId,
  WebhookBeforeDispatchHook,
  WebhookDeliveryRecord,
  WebhookEventEnvelope,
  WebhookSubscriptionRecord,
  WebhookTopic,
} from "./types.js";

// Default eight-attempt budget: dead-letter instead of retrying an endpoint indefinitely.
export const MAX_DELIVERY_ATTEMPTS = 8;

const BASE_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

const MAX_BACKOFF_STEP_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * attempts is one-based after the failing attempt. Equal jitter stays between half and all of
 * min(6 hours, 5 minutes * 2^(attempts-1)), preventing zero-delay retry herds while staying inside
 * the exponential envelope. For attempts 1..8, the half-step lower bounds are approximately
 * 2.5, 5, 10, 20, 40, 80, 160 and 180 minutes. Inject random for deterministic decisions.
 */
/** Compute equal-jitter backoff capped at six hours; the optional random port controls jitter. */
export function computeBackoffMs(required: { attempts: number }, optional: { random?: (() => number) | undefined } = {}): number {
  const { attempts } = required;
  const { random = Math.random } = optional;
  const exponentialStep = Math.min(MAX_BACKOFF_STEP_MS, BASE_BACKOFF_MS * 2 ** (attempts - 1));
  const half = exponentialStep / 2;
  return Math.round(half + random() * half);
}

function addMsToIso(iso: ISODateTime, ms: number): ISODateTime {
  return new Date(Date.parse(iso) + ms).toISOString();
}

export class WebhookDeliveryVetoedError extends IntegrationError {}

// Narrow the source event to JSON-safe data because it becomes a serializable outbound envelope.
export interface WebhookSourceEvent {
  id: UUID;
  name: WebhookTopic;
  workspaceId: UUID;
  occurredAt: ISODateTime;
  payload: JsonObject;
}

export interface EnqueueDeliveryDeps {
  subscriptionRepo: WebhookSubscriptionRepoPort;
  deliveryRepo: WebhookDeliveryRepoPort;
  envelopeStore: DeliveryEnvelopeStorePort;
  idGenerator: IdGenerator;
  clock: Clock;
}

export interface EnqueueDeliveryRequired {
  deps: EnqueueDeliveryDeps;
  input: { event: WebhookSourceEvent };
}

export interface EnqueueDeliveryOptional {}

/** Fan out an event to active matching subscriptions, preserving existing event/subscription deduplication. Durable adapters must enforce uniqueness atomically. */
export async function enqueueDelivery(
  required: EnqueueDeliveryRequired,
  _optional: EnqueueDeliveryOptional = {}
): Promise<{ enqueued: WebhookDeliveryRecord[] }> {
  const { deps, input } = required;
  const { event } = input;

  const matches = await deps.subscriptionRepo.findMatching({
    workspaceId: event.workspaceId,
    topic: event.name,
  });

  const enqueued: WebhookDeliveryRecord[] = [];

  for (const subscription of matches) {
    const duplicate = await isAlreadyEnqueued({
      deliveryRepo: deps.deliveryRepo,
      workspaceId: event.workspaceId,
      subscriptionId: subscription.id,
      eventId: event.id,
    });
    if (duplicate) continue;

    const now = nowIso({ clock: deps.clock });
    const record: WebhookDeliveryRecord = {
      id: deps.idGenerator.newId(),
      workspaceId: event.workspaceId,
      subscriptionId: subscription.id,
      eventId: event.id,
      topic: event.name,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastResponseStatus: null,
      lastError: null,
      signedWithVersion: null,
      createdAt: now,
      deliveredAt: null,
      deadAt: null,
    };

    const envelope: WebhookEventEnvelope = {
      deliveryId: record.id,
      eventId: event.id,
      topic: event.name,
      workspaceId: event.workspaceId,
      occurredAt: event.occurredAt,
      data: event.payload,
    };
    // A durable adapter must co-persist the envelope in the same insert as the row, closing the
    // crash gap before the following save. That save remains the real write for memory adapters;
    // for an adapter with co-persistence it only repeats the same envelope harmlessly.
    await deps.deliveryRepo.enqueue({ record }, { envelope });
    await deps.envelopeStore.save({ deliveryId: record.id, envelope });
    enqueued.push(record);
  }

  return { enqueued };
}

/**
 * The port has no event-specific lookup, so this guard scans prior subscription deliveries:
 * O(matching subscriptions * their delivery history). Production storage needs an atomic unique
 * (workspaceId, subscriptionId, eventId) constraint; a check-before-insert scan alone cannot
 * prevent simultaneous outbox redeliveries from double-enqueuing.
 */
async function isAlreadyEnqueued(params: {
  deliveryRepo: WebhookDeliveryRepoPort;
  workspaceId: UUID;
  subscriptionId: IntegrationId;
  eventId: UUID;
}): Promise<boolean> {
  const existing = await params.deliveryRepo.listBySubscription({
    workspaceId: params.workspaceId,
    subscriptionId: params.subscriptionId,
    limit: Number.MAX_SAFE_INTEGER,
  });
  return existing.some((delivery) => delivery.eventId === params.eventId);
}

export interface ProcessDueDeliveriesDeps {
  deliveryRepo: WebhookDeliveryRepoPort;
  subscriptionRepo: WebhookSubscriptionRepoPort;
  envelopeStore: DeliveryEnvelopeStorePort;
  httpClient: HttpClientPort;
  signer: WebhookSigner;
  headers: WebhookHeaderVocabulary;
  clock: Clock;
}

export interface ProcessDueDeliveriesRequired {
  deps: ProcessDueDeliveriesDeps;
}

export interface ProcessDueDeliveriesOptional {
  batchSize?: number;
  hooks?: readonly WebhookBeforeDispatchHook[];
  requestTimeoutMs?: number;
  maxAttempts?: number;
  random?: (() => number) | undefined;
}

export interface ProcessDueDeliveriesResult {
  processed: number;
  delivered: number;
  failed: number;
  dead: number;
}

// Throwing/rejecting redaction hooks and explicit vetoes fail this attempt before signing/sending;
// an unfiltered envelope must never fall through. Retry with normal backoff, then dead-letter.
/** Claim and process a bounded batch; hooks fail closed and unsuccessful attempts back off or dead-letter. */
export async function processDueDeliveries(
  required: ProcessDueDeliveriesRequired,
  optional: ProcessDueDeliveriesOptional = {}
): Promise<ProcessDueDeliveriesResult> {
  const { deliveryRepo, subscriptionRepo, envelopeStore, httpClient, signer, clock, headers } = required.deps;
  const { batchSize, hooks, requestTimeoutMs, maxAttempts, random } = resolveProcessDueDeliveriesOptions(optional);

  const claimedAt = nowIso({ clock });
  const claimed = await deliveryRepo.claimPending({ batchSize, nowIso: claimedAt });

  const result: ProcessDueDeliveriesResult = { processed: claimed.length, delivered: 0, failed: 0, dead: 0 };

  for (const row of claimed) {
    const outcome = await attemptOneDelivery(row, {
      subscriptionRepo,
      envelopeStore,
      httpClient,
      signer,
      headers,
      clock,
      hooks,
      requestTimeoutMs,
    });

    const disposition = await recordDeliveryOutcome(row, outcome, { deliveryRepo, clock, maxAttempts, random });
    result[disposition] += 1;
  }

  return result;
}

interface ResolvedProcessDueDeliveriesOptions {
  batchSize: number;
  hooks: readonly WebhookBeforeDispatchHook[];
  requestTimeoutMs: number;
  maxAttempts: number;
  random?: (() => number) | undefined;
}

function resolveProcessDueDeliveriesOptions(
  optional: ProcessDueDeliveriesOptional
): ResolvedProcessDueDeliveriesOptions {
  const {
    batchSize = 20,
    hooks = [],
    requestTimeoutMs = 10_000,
    maxAttempts = MAX_DELIVERY_ATTEMPTS,
    random,
  } = optional;
  return { batchSize, hooks, requestTimeoutMs, maxAttempts, random };
}

type DeliveryDisposition = "delivered" | "failed" | "dead";

async function recordDeliveryOutcome(
  row: WebhookDeliveryRecord,
  outcome: DeliveryAttemptOutcome,
  deps: { deliveryRepo: WebhookDeliveryRepoPort; clock: Clock; maxAttempts: number; random?: (() => number) | undefined }
): Promise<DeliveryDisposition> {
  if (outcome.ok) {
    await deps.deliveryRepo.markDelivered({
      workspaceId: row.workspaceId,
      id: row.id,
      responseStatus: outcome.responseStatus,
      deliveredAtIso: nowIso({ clock: deps.clock }),
    });
    return "delivered";
  }

  const isExhausted = row.attempts >= deps.maxAttempts;
  const nextStatus = isExhausted ? "dead" : "failed";
  const failedAtIso = nowIso({ clock: deps.clock });
  const nextAttemptAt = isExhausted
    ? failedAtIso
    : addMsToIso(failedAtIso, computeBackoffMs({ attempts: row.attempts }, { random: deps.random }));

  await deps.deliveryRepo.markFailed({
    workspaceId: row.workspaceId,
    id: row.id,
    error: outcome.error,
    responseStatus: outcome.responseStatus,
    nextStatus,
    nextAttemptAt,
  }, isExhausted ? { deadAtIso: failedAtIso } : {});

  return isExhausted ? "dead" : "failed";
}

type DeliveryAttemptOutcome =
  | { ok: true; responseStatus: number }
  | { ok: false; error: string; responseStatus: number | null };

// Missing/inactive subscriptions, missing envelopes, hook failures, transport failures and
// non-2xx responses all use one failed-attempt outcome so retry/dead-letter policy cannot drift.
async function attemptOneDelivery(
  row: WebhookDeliveryRecord,
  deps: {
    subscriptionRepo: WebhookSubscriptionRepoPort;
    envelopeStore: DeliveryEnvelopeStorePort;
    httpClient: HttpClientPort;
    signer: WebhookSigner;
    headers: WebhookHeaderVocabulary;
    hooks: readonly WebhookBeforeDispatchHook[];
    requestTimeoutMs: number;
    clock: Clock;
  }
): Promise<DeliveryAttemptOutcome> {
  try {
    const subscription = await deps.subscriptionRepo.findById({
      workspaceId: row.workspaceId,
      id: row.subscriptionId,
    });
    if (!subscription) {
      return { ok: false, error: `subscription '${row.subscriptionId}' was not found`, responseStatus: null };
    }
    if (subscription.status !== "active") {
      return {
        ok: false,
        error: `subscription '${row.subscriptionId}' is '${subscription.status}', not active`,
        responseStatus: null,
      };
    }

    const storedEnvelope = await deps.envelopeStore.find({ deliveryId: row.id });
    if (!storedEnvelope) {
      return { ok: false, error: `no envelope recorded for delivery '${row.id}'`, responseStatus: null };
    }
    const envelope = await runBeforeDispatchHooks(deps.hooks, { subscription, envelope: storedEnvelope });

    const rawBody = JSON.stringify(envelope);
    const timestampSeconds = Math.floor(Date.parse(nowIso({ clock: deps.clock })) / 1000);
    const signatureHeader = await deps.signer.signForSubscription({
      subscription,
      rawBody,
      timestampSeconds,
    });

    const response = await deps.httpClient.send({ request: {
      method: "POST",
      url: subscription.targetUrl,
      headers: {
        "content-type": "application/json",
        [deps.headers.signature]: signatureHeader,
        [deps.headers.deliveryId]: row.id,
        [deps.headers.eventId]: row.eventId,
      },
      timeoutMs: deps.requestTimeoutMs,
      body: rawBody,
    } });

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, responseStatus: response.status };
    }
    return {
      ok: false,
      error: `non-2xx response: ${response.status}`,
      responseStatus: response.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown webhook delivery error";
    return { ok: false, error: message, responseStatus: null };
  }
}

/**
 * Thread replacements through lower-priority-first hooks. A veto throws, as does a failing hook;
 * the delivery port has no separate veto terminal state, so both follow normal retry -> dead.
 */
async function runBeforeDispatchHooks(
  hooks: readonly WebhookBeforeDispatchHook[],
  input: { subscription: WebhookSubscriptionRecord; envelope: WebhookEventEnvelope }
): Promise<WebhookEventEnvelope> {
  const ordered = [...hooks].sort((a, b) => a.priority - b.priority);
  let envelope = input.envelope;

  for (const hook of ordered) {
    const result = await hook.handle({ subscription: input.subscription, envelope });
    if (!result.send) {
      throw new WebhookDeliveryVetoedError({ message: `webhooks.beforeDispatch hook vetoed delivery for subscription '${input.subscription.id}'` });
    }
    if (result.envelope) envelope = result.envelope;
  }

  return envelope;
}
