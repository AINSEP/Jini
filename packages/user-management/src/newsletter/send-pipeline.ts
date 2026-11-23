/**
 * @file `send-pipeline.ts` — `NewsletterSendPipeline` (ADR-PIPE-011 C-017, orchestrator.spec.md §4,
 * REQ-16/17/18/19/20/24/28/29, INV-02/06/08/10).
 *
 * `authorizeSend` calls `launch-gate.ts`'s `evaluateLaunchGate` (T018, CERTIFIED FIRST in Phase 2)
 * EXACTLY ONCE, inside its own transaction — no other call site may duplicate or bypass it (INV-05).
 * `dispatchRow` never constructs, stores, or imports a concrete `MailerPort` adapter (INV-08) — it
 * only ever receives one as a call-time dependency. `claimBatch` delegates to the EXISTING generic
 * `processOutbox` primitive unmodified (W-003) — Newsletter does not fork the claim loop; the actual
 * per-row fan-out happens in `handleSendBatchClaimed`, the bus-subscriber handler the host's
 * composition root wires onto `newsletter.send.batch.claimed` (T040), mirroring the existing
 * `bus.subscribe("workspace.created", ...)` demonstration.
 */
import type { DomainEvent, EventBusPort, OutboxPort } from "@jini-ai/core/contracts/events";
import type { MailerSendResult, PositionalMailer as MailerPort } from "@jini-ai/core/contracts/mail";
import { transitionCampaignStatus } from "./campaign.js";
import {
  NewsletterCampaignNotEditableError,
  NewsletterCampaignNotFoundError,
  NewsletterLaunchGateBlockedError,
  NewsletterValidationError,
} from "./errors.js";
import type { HookRegistry } from "./hooks.js";
import { evaluateLaunchGate, type LaunchGateDeps } from "./launch-gate.js";
import type {
  NewsletterAudienceSnapshotRepoPort,
  NewsletterCampaignRepoPort,
  NewsletterSendRepoPort,
  NewsletterSubscriptionRepoPort,
  SendBatchJob,
  SubscriberDirectoryPort,
} from "./ports.js";
import type { AudienceSnapshotRow, CampaignRecord, SendRow } from "./types.js";
import { buildUnsubscribeLink, type UnsubscribeDeps } from "./unsubscribe.js";

const TEST_SEND_MIN = 1;
const TEST_SEND_MAX = 10;
export const SEND_BATCH_CLAIMED_EVENT = "newsletter.send.batch.claimed";

/**
 * How long one run holds a send row while it dispatches it (2026-09-16). Must outlast one row's hooks + `mailer.send`
 * + `recordResult` (the hosted mail adapter caps a call at 10s). A run that throws after leasing a row keeps the lease, so
 * the lease must also expire before the batch event's LAST attempt, whichever attempt took it. The tightest case is a
 * lease taken on attempt `MAX_OUTBOX_ATTEMPTS - 1`: the last attempt can follow after only
 * computeOutboxBackoffMs({ attempts: MAX_OUTBOX_ATTEMPTS - 1 }, { random: () => 0 }) = 240s. A lease still live then fails that attempt, the
 * outbox seals the event "failed", and the row stays "pending" forever. Hence 2 minutes, not the first draft's 5
 * (review fix, 2026-09-16). `send-pipeline.test.ts` pins both bounds.
 */
export const NEWSLETTER_SEND_ROW_LEASE_MS = 2 * 60 * 1000;

export interface SendPipelineDeps {
  campaignRepo: NewsletterCampaignRepoPort;
  subscriptionRepo: NewsletterSubscriptionRepoPort;
  audienceSnapshotRepo: NewsletterAudienceSnapshotRepoPort;
  sendRepo: NewsletterSendRepoPort;
  subscriberDirectory: SubscriberDirectoryPort;
  hooks: HookRegistry;
  mailer: MailerPort;
  launchGateDeps: LaunchGateDeps;
  /** Mints each recipient's signed one-click unsubscribe URL (RFC 8058 `List-Unsubscribe`). Absent,
   *  campaign mail carries no unsubscribe headers and the delivery policy refuses it as bulk. */
  unsubscribe?: UnsubscribeDeps;
  outbox: OutboxPort;
  bus: EventBusPort;
  clock: { nowIso(): string };
  ids: { newId(): string };
  /** Waits out a short provider quota hint inside the batch (see {@link NEWSLETTER_INLINE_DEFER_MAX_MS}). Absent, every
   *  quota wait reschedules the rest of the batch as a fresh outbox event instead. */
  sleep?: (required: { ms: number }, optional?: Record<string, never>) => Promise<void>;
  /** The host's generic outbox claim loop, with its own retry policies bound. `claimBatch` delegates to it unmodified (W-003). */
  processOutbox: (
    required: { outbox: OutboxPort; bus: EventBusPort; clock: { nowMs(): number } },
    optional: { batchSize?: number },
  ) => Promise<number>;
  /** True when a failed send result is the shared mail rate-limit code (back-pressure, not a failure). */
  isMailRateLimited: (required: { result: MailerSendResult }, optional?: Record<string, never>) => boolean;
  /** Host error reporter. Receives the raw error; the host decides how much of it is safe to log. */
  reportError: (required: { message: string; error: unknown }, optional?: Record<string, never>) => void;
}

/**
 * Quota waits (2026-10-21, review email#4). A rate limit is back-pressure, not a failure, so it must never spend the
 * outbox's failure budget: a batch of 20 against a provider's small (e.g. 2/s, burst-2) bucket defers on almost every other row, which
 * used to fail the batch each time and exhaust `MAX_OUTBOX_ATTEMPTS` with recipients still pending. A short hint is
 * waited out inline (each wait at most 2s, at most 20s per run: far inside the 60s outbox delivery timeout and the 2
 * minute row lease); a longer one reschedules the deferred row and the rest as a fresh event, due no earlier than the
 * hint and the deferred row's lease.
 */
export const NEWSLETTER_INLINE_DEFER_MAX_MS = 2_000;
export const NEWSLETTER_INLINE_DEFER_BUDGET_MS = 20_000;
/** Wait used when a rate-limited result carries no `retryAfterMs` hint. */
const DEFAULT_DEFER_MS = 1_000;

/** REQ-19/25 — only the pipeline (`authorizeSend`) may start a real send; compose/schedule-tier actors cannot (AC-25). */
export async function authorizeSend(required: {
  deps: SendPipelineDeps;
  input: { workspaceId: string; campaignId: string };
}, _optional: Record<string, never> = {}): Promise<{ campaign: CampaignRecord; launchGateSnapshot: Awaited<ReturnType<typeof evaluateLaunchGate>> }> {
  const { deps, input } = required;
  return deps.campaignRepo.transaction({ fn: async () => {
    const campaign = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id: input.campaignId });
    if (!campaign) throw new NewsletterCampaignNotFoundError(`campaign ${input.campaignId} was not found`);

    // evaluateLaunchGate (T018) called EXACTLY ONCE, inside this transaction (INV-05).
    const launchGateSnapshot = await evaluateLaunchGate({ deps: deps.launchGateDeps, workspaceId: input.workspaceId, isTestSend: false });
    if (!launchGateSnapshot.met) {
      throw new NewsletterLaunchGateBlockedError({ message: "the Launch Readiness Gate is not satisfied", unmetPreconditions: launchGateSnapshot.unmetPreconditions });
    }

    const decision = transitionCampaignStatus({ from: campaign.status, to: "sending", actorTier: "pipeline" });
    if (!decision.allowed) {
      throw new NewsletterCampaignNotEditableError({ message: decision.reason, currentStatus: campaign.status, attemptedAction: "send" });
    }

    const now = deps.clock.nowIso();
    const updated: CampaignRecord = { ...campaign, status: "sending", sendStartedAt: now, updatedAt: now };
    await deps.campaignRepo.saveCampaignRow(updated);
    const revisions = await deps.campaignRepo.listRevisions({ workspaceId: input.workspaceId, campaignId: input.campaignId });
    const seq = revisions.length > 0 ? Math.max(...revisions.map((r) => r.seq)) + 1 : 1;
    await deps.campaignRepo.appendRevision({ campaignId: updated.id, workspaceId: updated.workspaceId, seq, state: updated, actorId: "system:send-pipeline", recordedAt: now });

    return { campaign: updated, launchGateSnapshot };
  } });
}

async function materializeAudience({ deps, input }: {
  deps: SendPipelineDeps; input: Parameters<typeof freezeAudience>[0]["input"];
}) {
  const subscribed = await deps.subscriptionRepo.listSubscribed({ workspaceId: input.workspaceId, listId: input.listId });
  const contacts = await deps.subscriberDirectory.getContacts({
    workspaceId: input.workspaceId,
    subscriberIds: subscribed.map((s) => s.subscriberId),
  });
  const contactBySubscriberId = new Map(contacts.map((c) => [c.subscriberId, c] as const));

  const now = deps.clock.nowIso();
  const snapshotId = deps.ids.newId();
  const snapshot: AudienceSnapshotRow = {
    id: snapshotId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    listId: input.listId,
    recipientCount: 0,
    createdAt: now,
  };

  const sendRows: SendRow[] = [];
  for (const subscription of subscribed) {
    const contact = contactBySubscriberId.get(subscription.subscriberId);
    if (!contact || !contact.emailDeliverable) continue; // Missing or undeliverable contacts are excluded.
    sendRows.push({
      id: deps.ids.newId(),
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      audienceSnapshotId: snapshotId,
      subscriberId: subscription.subscriberId,
      recipientEmail: contact.email,
      status: "pending",
      attempts: 0,
      idempotencyKey: `newsletter:${input.campaignId}:${subscription.subscriberId}:${snapshotId}`,
      providerMessageId: null,
      lastError: null,
      nextAttemptAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { now, snapshotId, snapshot, sendRows };
}

/**
 * REQ-16 — materialize `subscribed` subscriptions into 1 snapshot + N send rows. Idempotent by
 * presence-check (INV-06/orchestrator.spec §6): a retry for a campaign that already has
 * `audienceSnapshotId` set is a no-op returning the existing snapshot, never a second snapshot.
 * Unresolvable subscribers are silently excluded (AC-22, EC-07) — never an error.
 */
export async function freezeAudience(required: {
  deps: SendPipelineDeps;
  input: { workspaceId: string; campaignId: string; listId: string };
}, _optional: Record<string, never> = {}): Promise<{ snapshot: AudienceSnapshotRow; sendIds: readonly string[] }> {
  const { deps, input } = required;
  const campaign = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id: input.campaignId });
  if (!campaign) throw new NewsletterCampaignNotFoundError(`campaign ${input.campaignId} was not found`);

  if (campaign.audienceSnapshotId) {
    const existing = await deps.audienceSnapshotRepo.findById({ workspaceId: input.workspaceId, id: campaign.audienceSnapshotId });
    if (existing) {
      const rows = await deps.sendRepo.listByCampaign({ workspaceId: input.workspaceId, campaignId: input.campaignId, limit: 100000 });
      return { snapshot: existing, sendIds: rows.map((r) => r.id) };
    }
  }

  const { now, snapshotId, snapshot, sendRows } = await materializeAudience({ deps, input });
  const finalSnapshot: AudienceSnapshotRow = { ...snapshot, recipientCount: sendRows.length };
  await deps.audienceSnapshotRepo.save(finalSnapshot);
  if (sendRows.length > 0) await deps.sendRepo.saveBatch({ rows: sendRows });

  // Contact lookup can overlap a human pause. Attach the snapshot to the current row without
  // restoring an earlier status; paused batches remain pending until an approved resume.
  const updatedCampaign = await deps.campaignRepo.transaction({ fn: async () => {
    const current = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id: input.campaignId });
    if (!current) throw new NewsletterCampaignNotFoundError(`campaign ${input.campaignId} was not found`);
    const updated: CampaignRecord = { ...current, audienceSnapshotId: snapshotId, updatedAt: now };
    await deps.campaignRepo.saveCampaignRow(updated);
    return updated;
  } });

  const sendIds = sendRows.map((row) => row.id);
  await enqueueSendBatches({ deps, campaign: updatedCampaign, audienceSnapshotId: snapshotId, sendIds });

  return { snapshot: finalSnapshot, sendIds };
}

/** Queues existing ledger ids in the same bounded outbox batches for initial launch and resume.
 * @complexity O(n) ids and O(n/20) outbox writes; no addresses are embedded in events. */
async function enqueueSendBatches(required: { deps: SendPipelineDeps; campaign: CampaignRecord; audienceSnapshotId: string; sendIds: readonly string[] }): Promise<void> {
  const { deps, campaign, audienceSnapshotId, sendIds } = required;
  for (let i = 0; i < sendIds.length; i += 20) {
    const job: SendBatchJob = { workspaceId: campaign.workspaceId, campaignId: campaign.id, audienceSnapshotId, sendIds: sendIds.slice(i, i + 20) };
    const event: DomainEvent<SendBatchJob> = { id: deps.ids.newId(), name: SEND_BATCH_CLAIMED_EVENT, occurredAt: deps.clock.nowIso(), workspaceId: campaign.workspaceId, payload: job };
    await deps.outbox.enqueue(event as unknown as DomainEvent);
  }
}

/** `claimBatch` — delegates to the EXISTING generic `processOutbox` primitive, unmodified (W-003). */
export function claimBatch(
  required: { deps: Pick<SendPipelineDeps, "outbox" | "bus" | "clock" | "processOutbox"> },
  optional: { batchSize?: number } = {}
): Promise<number> {
  const { deps } = required;
  const { batchSize = 20 } = optional;
  return deps.processOutbox({ outbox: deps.outbox, bus: deps.bus, clock: { nowMs: () => Date.parse(deps.clock.nowIso()) } }, { batchSize });
}

/** The `runHookChain` input for one row: both hook contexts plus the base message (REQ-17). @complexity O(1). */
function hookChainInput(required: Parameters<typeof dispatchRow>[0]): Parameters<SendPipelineDeps["hooks"]["runHookChain"]>[0] {
  const { row } = required;
  return {
    recipientFilterContext: {
      workspaceId: row.workspaceId,
      campaignId: required.campaignId,
      listId: required.listId,
      subscriberId: row.subscriberId,
      recipientEmail: row.recipientEmail,
      status: required.status,
    },
    beforeSendContext: { workspaceId: row.workspaceId, campaignId: required.campaignId, sendId: row.id, subscriberId: row.subscriberId },
    message: {
      workspaceId: row.workspaceId,
      to: { email: row.recipientEmail },
      from: { email: required.message.fromEmail, name: required.message.fromName },
      replyTo: { email: required.message.replyTo },
      subject: required.message.subject,
      ...(required.message.text === undefined ? {} : { text: required.message.text }),
      ...(required.message.html === undefined ? {} : { html: required.message.html }),
    },
  };
}

/**
 * REQ-17/22/23 — recipient.filter -> beforeSend -> `MailerPort.send()`, in that fixed order
 * (`hooks.ts`'s `runHookChain`). Never constructs/imports a concrete `MailerPort` (INV-08) — always
 * receives `deps.mailer` as a call-time dependency.
 */
export async function dispatchRow(required: {
  deps: SendPipelineDeps;
  row: SendRow;
  campaignId: string;
  listId: string;
  status: "subscribed" | "unsubscribed" | "pending" | "bounced" | "complained";
  message: { subject: string; text?: string; html?: string; fromName: string; fromEmail: string; replyTo: string };
  /** The subscription's consent revision, bound into the unsubscribe token (INV-04). */
  consentRevisionId?: string | null;
}, _optional: Record<string, never> = {}): Promise<{ outcome: "sent" | "suppressed" | "failed" | "deferred"; providerMessageId: string | null; error: string | null; retryAfterMs?: number }> {
  const { deps, row } = required;

  // REQ-10: crash-recovery / redelivery idempotency (INV-10, EC-04) — a row already terminal is
  // never re-dispatched (the outbox's own redelivery must not double-send). Defense in depth
  // (2026-09-16): `handleSendBatchClaimed` leases the row (`claimForDispatch`) before calling this,
  // which is what actually stops overlapping runs.
  if (row.status !== "pending") {
    return { outcome: row.status === "delivered" || row.status === "sent" ? "sent" : "failed", providerMessageId: row.providerMessageId, error: row.lastError };
  }

  const hookResult = await deps.hooks.runHookChain(hookChainInput(required));

  if (!hookResult.keep) {
    return { outcome: "suppressed", providerMessageId: null, error: hookResult.reason };
  }

  const headers = await unsubscribeHeaders({ deps, row, listId: required.listId, campaignId: required.campaignId, consentRevisionId: required.consentRevisionId ?? null });
  const result = await deps.mailer.send({ ...hookResult.message, headers: { ...hookResult.message.headers, ...headers } }, {
    idempotencyKey: row.idempotencyKey,
    workspaceId: row.workspaceId,
    sourceContext: { module: "newsletter", ref: row.id },
    // The bulk lane: suppression honours complaints, the provider's reserved transactional capacity
    // is never consumed, and the policy refuses a message without the unsubscribe headers above.
    purpose: "bulk",
  });

  if (result.ok) {
    return { outcome: "sent", providerMessageId: result.providerMessageId, error: null };
  }
  // A rate limit is back-pressure, not a failure: the row stays pending for the retried batch. The
  // shared code covers the local token bucket AND provider throttling (adapters normalize a 429 to it).
  if (deps.isMailRateLimited({ result })) return { outcome: "deferred", providerMessageId: null, error: result.message, retryAfterMs: result.retryAfterMs ?? DEFAULT_DEFER_MS };
  return { outcome: "failed", providerMessageId: null, error: result.message };
}

/**
 * RFC 8058 one-click headers for one recipient: the signed, origin-anchored link from
 * `buildUnsubscribeLink` (REQ-30/INV-09), answered by the public `POST /newsletter/unsubscribe`.
 * @complexity One key derivation and one origin read.
 */
async function unsubscribeHeaders(required: {
  deps: SendPipelineDeps; row: SendRow; listId: string; campaignId: string; consentRevisionId: string | null;
}): Promise<Record<string, string>> {
  const { deps, row } = required;
  if (!deps.unsubscribe) return {};
  const url = await buildUnsubscribeLink({ deps: deps.unsubscribe, claims: {
    workspaceId: row.workspaceId, subscriberId: row.subscriberId, listId: required.listId, campaignId: required.campaignId, consentRevisionId: required.consentRevisionId,
  } });
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/**
 * REQ-24/INV-02 — records one send row's outcome with the atomic `recordOutcome` (2026-09-16; it was a read-then-write
 * that let two concurrent results for the SAME row both pass the pending check and both count, H4), then counts it with
 * the atomic `incrementCounter` (it was a read-modify-write of the campaign row, which lost concurrent counts and could
 * write back a stale status over a pause). Still two writes, not one transaction: a crash between them leaves the row
 * terminal and uncounted; counters stay rebuildable from the sends ledger.
 */
export async function recordResult(required: {
  deps: SendPipelineDeps;
  input: { workspaceId: string; sendId: string; campaignId: string; outcome: "sent" | "suppressed" | "failed"; providerMessageId: string | null; error: string | null };
}, _optional: Record<string, never> = {}): Promise<{ sendRow: SendRow }> {
  const { deps, input } = required;
  const now = deps.clock.nowIso();
  const status = input.outcome === "sent" ? "delivered" : "failed";
  const recorded = await deps.sendRepo.recordOutcome({
    workspaceId: input.workspaceId,
    id: input.sendId,
    status,
    providerMessageId: input.providerMessageId,
    lastError: input.error,
    updatedAt: now,
  });
  if (!recorded) {
    // Missing, or another run already recorded it: never re-written or counted twice.
    const row = await deps.sendRepo.findById({ workspaceId: input.workspaceId, id: input.sendId });
    if (!row) throw new Error(`send row ${input.sendId} was not found`);
    return { sendRow: row };
  }

  await deps.campaignRepo.incrementCounter({ workspaceId: input.workspaceId, id: input.campaignId, counter: status, updatedAt: now });
  return { sendRow: recorded };
}

/** REQ-18 — flips to `sent` when 0 pending remain. Naturally idempotent — safe to call redundantly. */
export async function completeIfDrained(required: {
  deps: SendPipelineDeps;
  input: { workspaceId: string; campaignId: string };
}, _optional: Record<string, never> = {}): Promise<{ campaign: CampaignRecord | null }> {
  const { deps, input } = required;
  const campaign = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id: input.campaignId });
  if (!campaign) return { campaign: null };

  // The state machine is the single guard: for the pipeline tier, `-> sent` is allowed only from
  // `sending`, so a draft/paused/already-sent campaign returns null here before any ledger read.
  const decision = transitionCampaignStatus({ from: campaign.status, to: "sent", actorTier: "pipeline" });
  if (!decision.allowed) return { campaign: null };

  const pending = await deps.sendRepo.countPendingByCampaign({ workspaceId: input.workspaceId, campaignId: input.campaignId });
  if (pending > 0) return { campaign: null };

  const now = deps.clock.nowIso();
  const updated: CampaignRecord = { ...campaign, status: "sent", updatedAt: now };
  await deps.campaignRepo.saveCampaignRow(updated);
  return { campaign: updated };
}

/** REQ-19 — admin-triggered pause/resume (`admin.newsletter.campaign.send` tier). `claimBatch` no-ops while paused (checked by the caller before invoking `claimBatch`). */
export async function pauseCampaign(required: {
  deps: SendPipelineDeps;
  input: { workspaceId: string; campaignId: string };
}, _optional: Record<string, never> = {}): Promise<{ campaign: CampaignRecord }> {
  return transitionAndSave({ deps: required.deps, input: required.input, to: "paused" });
}

/**
 * Commits paused -> sending, then requeues only pending rows of the frozen audience.
 * @returns The resumed campaign; requeueFailed means the transition succeeded but fan-out needs attention.
 * @throws NewsletterCampaignNotFoundError or NewsletterCampaignNotEditableError before any transition.
 * @complexity O(n) ledger reads and O(n/20) outbox writes, O(1000) auxiliary space.
 */
export async function resumeCampaign(required: {
  deps: SendPipelineDeps;
  input: { workspaceId: string; campaignId: string };
}, _optional: Record<string, never> = {}): Promise<{ campaign: CampaignRecord; requeueFailed?: true }> {
  const result = await transitionAndSave({ deps: required.deps, input: required.input, to: "sending" });
  // A paused batch may already have been acknowledged. Requeue its remaining ledger rows;
  // the existing per-row leases and idempotency keys make overlapping/redelivered jobs safe.
  if (!result.campaign.audienceSnapshotId) return result;
  try {
    await requeuePendingSends({ deps: required.deps, campaign: result.campaign, audienceSnapshotId: result.campaign.audienceSnapshotId });
  } catch (error) {
    // Do not expose repository/provider diagnostics or turn an already-committed resume into a refusal.
    required.deps.reportError({ message: "[newsletter] pending delivery requeue failed after resume; inspect the send log before retrying", error });
    return { ...result, requeueFailed: true };
  }
  return result;
}

/** Requeues the current snapshot's pending rows in bounded pages. @complexity O(n) time, O(1000) space. */
async function requeuePendingSends(required: { deps: SendPipelineDeps; campaign: CampaignRecord; audienceSnapshotId: string }): Promise<void> {
  const { deps, campaign, audienceSnapshotId } = required;
  let afterId: string | undefined;
  for (;;) {
    const rows = await deps.sendRepo.listByCampaign({ workspaceId: campaign.workspaceId, campaignId: campaign.id, ...(afterId === undefined ? {} : { afterId }), limit: 1000 });
    const pendingIds = rows.filter((row) => row.status === "pending" && row.audienceSnapshotId === audienceSnapshotId).map((row) => row.id);
    await enqueueSendBatches({ deps, campaign, audienceSnapshotId, sendIds: pendingIds });
    const last = rows.at(-1);
    if (rows.length < 1000 || last === undefined) return;
    afterId = last.id;
  }
}

async function transitionAndSave(
  { deps, input, to }: { deps: SendPipelineDeps; input: { workspaceId: string; campaignId: string }; to: "paused" | "sending" },
  _options = {},
): Promise<{ campaign: CampaignRecord }> {
  return deps.campaignRepo.transaction({ fn: async () => {
    const campaign = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id: input.campaignId });
    if (!campaign) throw new NewsletterCampaignNotFoundError(`campaign ${input.campaignId} was not found`);
    const decision = transitionCampaignStatus({ from: campaign.status, to, actorTier: "send" });
    if (!decision.allowed) throw new NewsletterCampaignNotEditableError({ message: decision.reason, currentStatus: campaign.status, attemptedAction: to });
    const now = deps.clock.nowIso();
    const updated: CampaignRecord = { ...campaign, status: to, updatedAt: now };
    await deps.campaignRepo.saveCampaignRow(updated);
    return { campaign: updated };
  } });
}

/** SEND_TEST_CAMPAIGN — hits only the 1-10 given addresses, no snapshot/send-ledger rows created (AC-26). */
export async function sendTestCampaign(required: {
  deps: SendPipelineDeps;
  input: { workspaceId: string; campaignId: string; testAddresses: readonly string[] };
}): Promise<{ results: { email: string; outcome: "sent" | "failed"; error: string | null; errorCode?: string }[] }> {
  const { deps, input } = required;
  if (input.testAddresses.length < TEST_SEND_MIN || input.testAddresses.length > TEST_SEND_MAX) {
    throw new NewsletterValidationError({ message: `test-send address count must be between ${TEST_SEND_MIN} and ${TEST_SEND_MAX}`, field: "testAddresses", reason: "length" });
  }
  const campaign = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id: input.campaignId });
  if (!campaign) throw new NewsletterCampaignNotFoundError(`campaign ${input.campaignId} was not found`);

  const launchGateSnapshot = await evaluateLaunchGate({ deps: deps.launchGateDeps, workspaceId: input.workspaceId, isTestSend: true });
  if (!launchGateSnapshot.met) {
    throw new NewsletterLaunchGateBlockedError({ message: "the Launch Readiness Gate is not satisfied for a test send", unmetPreconditions: launchGateSnapshot.unmetPreconditions });
  }

  const results: { email: string; outcome: "sent" | "failed"; error: string | null; errorCode?: string }[] = [];
  for (const email of input.testAddresses) {
    const result = await deps.mailer.send(
      {
        workspaceId: input.workspaceId,
        to: { email },
        from: { email: campaign.fromEmail, name: campaign.fromName },
        replyTo: { email: campaign.replyTo },
        subject: `[TEST] ${campaign.subject}`,
        ...(campaign.preheader == null ? {} : { text: campaign.preheader }),
      },
      { idempotencyKey: `newsletter:test:${campaign.id}:${email}:${deps.clock.nowIso()}`, workspaceId: input.workspaceId, sourceContext: { module: "newsletter", ref: campaign.id } }
    );
    results.push(result.ok ? { email, outcome: "sent", error: null } : { email, outcome: "failed", error: result.message, errorCode: result.errorCode });
  }
  return { results };
}

/**
 * Leases one send row for this run through `NewsletterSendRepoPort.claimForDispatch` (2026-09-16):
 * the leased row, `"leased-elsewhere"` when another live run already holds its lease, or `null` when
 * it is missing or already terminal (nothing left to dispatch).
 *
 * @complexity O(1) beyond the two repo calls it may make.
 */
async function claimSendRow(required: { deps: SendPipelineDeps; workspaceId: string; sendId: string }): Promise<SendRow | "leased-elsewhere" | null> {
  const { deps, workspaceId, sendId } = required;
  const nowIso = deps.clock.nowIso();
  const leaseUntilIso = new Date(Date.parse(nowIso) + NEWSLETTER_SEND_ROW_LEASE_MS).toISOString();
  const leased = await deps.sendRepo.claimForDispatch({ workspaceId, id: sendId, nowIso, leaseUntilIso });
  if (leased) return leased;
  const current = await deps.sendRepo.findById({ workspaceId, id: sendId });
  return current?.status === "pending" ? "leased-elsewhere" : null;
}

/**
 * Dispatches one already-leased row through the fixed `recipient.filter` -> `beforeSend` -> `send()`
 * -> `recordResult` chain. Extracted from `handleSendBatchClaimed` (2026-09-16) to keep that
 * function's branching under the repo's complexity ceiling.
 *
 * @complexity O(1) beyond the hook chain, the mailer call, and `recordResult`.
 */
async function dispatchAndRecord(required: { deps: SendPipelineDeps; job: SendBatchJob; campaign: CampaignRecord; row: SendRow }): Promise<{ kind: "recorded" } | { kind: "deferred"; retryAfterMs: number }> {
  const { deps, job, campaign, row } = required;
  const subscription = await deps.subscriptionRepo.findBySubscriberAndList({
    workspaceId: job.workspaceId,
    listId: campaign.listId,
    subscriberId: row.subscriberId,
  });
  const status = subscription?.status ?? "unsubscribed";
  const dispatchResult = await dispatchRow({
    deps,
    row,
    campaignId: job.campaignId,
    listId: campaign.listId,
    status,
    message: { subject: campaign.subject, ...(campaign.preheader == null ? {} : { text: campaign.preheader }), fromName: campaign.fromName, fromEmail: campaign.fromEmail, replyTo: campaign.replyTo },
    consentRevisionId: subscription?.consentRevisionIdAtSubscribe ?? null,
  });
  // Rate limited: leave the row pending (its lease expires) so the retried batch sends it later.
  if (dispatchResult.outcome === "deferred") return { kind: "deferred", retryAfterMs: dispatchResult.retryAfterMs ?? DEFAULT_DEFER_MS };
  // BUG FIX: `recordResult` is the ONLY place a send row's status ever leaves "pending" --
  // `dispatchRow` above never writes. Previously this call was skipped for a "suppressed"
  // outcome, which left the row at "pending" forever: `countPendingByCampaign` could never reach
  // 0 for that campaign, so `completeIfDrained` (below) could never fire once any recipient was
  // suppressed. `recordResult` already maps any non-"sent" outcome (including "suppressed") to a
  // terminal "failed" status, so calling it unconditionally is sufficient -- no new status value
  // is needed.
  await recordResult({
    deps,
    input: {
      workspaceId: job.workspaceId,
      sendId: row.id,
      campaignId: job.campaignId,
      outcome: dispatchResult.outcome,
      providerMessageId: dispatchResult.providerMessageId,
      error: dispatchResult.error,
    },
  });
  return { kind: "recorded" };
}

/** Whether the campaign is still `sending`; re-read because a pause can land during any provider call or wait. */
async function stillSending(required: { deps: SendPipelineDeps; job: SendBatchJob }): Promise<boolean> {
  const current = await required.deps.campaignRepo.findById({ workspaceId: required.job.workspaceId, id: required.job.campaignId });
  return current?.status === "sending";
}

type RowStep = { kind: "next" } | { kind: "stopped" } | { kind: "leased-elsewhere" } | { kind: "deferred"; retryAfterMs: number; leaseUntilIso: string };

/**
 * Dispatches one leased row, waiting out short quota hints inline while this run's wait budget allows.
 * @complexity O(waits) dispatch attempts, each bounded by {@link NEWSLETTER_INLINE_DEFER_BUDGET_MS} in total.
 */
async function dispatchWithinBudget(required: { deps: SendPipelineDeps; job: SendBatchJob; campaign: CampaignRecord; row: SendRow; budget: { waitedMs: number } }): Promise<RowStep> {
  const { deps, budget } = required;
  for (;;) {
    const outcome = await dispatchAndRecord(required);
    if (outcome.kind === "recorded") return { kind: "next" };
    const wait = outcome.retryAfterMs;
    const fits = wait <= NEWSLETTER_INLINE_DEFER_MAX_MS && budget.waitedMs + wait <= NEWSLETTER_INLINE_DEFER_BUDGET_MS;
    if (!deps.sleep || !fits) return { kind: "deferred", retryAfterMs: wait, leaseUntilIso: required.row.nextAttemptAt ?? deps.clock.nowIso() };
    budget.waitedMs += wait;
    await deps.sleep({ ms: wait });
    if (!(await stillSending(required))) return { kind: "stopped" };
  }
}

/** One recipient of a batch: pause check, lease, dispatch. @complexity O(1) repo calls beyond the dispatch. */
async function runBatchRow(required: { deps: SendPipelineDeps; job: SendBatchJob; campaign: CampaignRecord; sendId: string; budget: { waitedMs: number } }): Promise<RowStep> {
  const { deps, job, sendId } = required;
  // Re-read before each recipient: pause can arrive while the prior provider request is in flight.
  // Resume requeues pending rows, so acknowledging this stopped batch does not strand them.
  if (!(await stillSending({ deps, job }))) return { kind: "stopped" };
  const row = await claimSendRow({ deps, workspaceId: job.workspaceId, sendId });
  if (row === "leased-elsewhere") return { kind: "leased-elsewhere" };
  if (!row) return { kind: "next" };
  return dispatchWithinBudget({ ...required, row });
}

/**
 * Reschedules the deferred row and every row after it as a fresh batch event, so a quota wait spends
 * no outbox attempt. Both outbox adapters take an event's `occurredAt` as its first due time, so the
 * continuation's `occurredAt` is when it may run: the later of the provider's hint and the deferred
 * row's own lease (an earlier run would find that row leased and fail the batch).
 */
async function continueLater(required: { deps: SendPipelineDeps; job: SendBatchJob; sendIds: readonly string[]; step: { retryAfterMs: number; leaseUntilIso: string } }): Promise<void> {
  const { deps, job, step } = required;
  const hinted = new Date(Date.parse(deps.clock.nowIso()) + step.retryAfterMs).toISOString();
  const dueIso = hinted > step.leaseUntilIso ? hinted : step.leaseUntilIso;
  const event: DomainEvent<SendBatchJob> = { id: deps.ids.newId(), name: SEND_BATCH_CLAIMED_EVENT, occurredAt: dueIso, workspaceId: job.workspaceId, payload: { ...job, sendIds: required.sendIds } };
  await deps.outbox.enqueue(event as unknown as DomainEvent);
}

/**
 * The bus-subscriber handler the host's composition root wires onto `newsletter.send.batch.claimed` (T040).
 * Per-row fixed order: `recipient.filter` -> `beforeSend` -> `send()` -> `recordResult`; one row's
 * failure never aborts sibling rows in the same batch.
 *
 * Each row is leased (`claimSendRow`) before any hook or send (2026-09-16), so overlapping runs of
 * the same batch never send one row twice. A terminal or missing row is skipped without
 * re-recording. A row leased by another live run is skipped here, and once every row in the job has
 * been attempted, the whole batch fails so the outbox retries it after backoff — that is what lets a
 * run that died mid-batch (holding a lease) release its rows once the lease expires, instead of
 * stranding them.
 */
export async function handleSendBatchClaimed(required: { deps: SendPipelineDeps; job: SendBatchJob }, _optional: Record<string, never> = {}): Promise<void> {
  const { deps, job } = required;
  const campaign = await deps.campaignRepo.findById({ workspaceId: job.workspaceId, id: job.campaignId });
  if (!campaign) return;

  let leasedElsewhere = 0;
  const budget = { waitedMs: 0 };
  for (const [index, sendId] of job.sendIds.entries()) {
    const step = await runBatchRow({ deps, job, campaign, sendId, budget });
    if (step.kind === "stopped") return;
    if (step.kind === "leased-elsewhere") leasedElsewhere += 1;
    if (step.kind === "deferred") {
      // The provider's bucket is empty: further rows would only be deferred too. Reschedule them
      // (a quota wait, not a failure) instead of marking anyone failed or spending an outbox attempt.
      await continueLater({ deps, job, sendIds: job.sendIds.slice(index), step });
      break;
    }
  }

  await completeIfDrained({ deps, input: { workspaceId: job.workspaceId, campaignId: job.campaignId } });

  if (leasedElsewhere > 0) {
    throw new Error(`${leasedElsewhere} send row(s) of campaign ${job.campaignId} are leased by another run; the batch will be retried`);
  }
}

