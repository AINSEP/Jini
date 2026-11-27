/**
 * @file Behaviour of `send-pipeline.ts` against the real in-memory Newsletter repos: send
 * authorization, audience freezing, per-row dispatch, outcome recording, drain completion,
 * pause/resume requeue, test sends and the batch handler's lease/quota-wait rules. Only the
 * host-supplied collaborators (mailer, outbox, directory, keyring, origin) are typed fakes.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { DomainEvent, EventBusPort, OutboxPort } from "@jini-ai/core/contracts/events";
import type { MailerSendOptions, MailerSendResult, OutboundEmail, PositionalMailer } from "@jini-ai/core/contracts/mail";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { OriginRegistryPort, VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import {
  NewsletterCampaignNotEditableError,
  NewsletterCampaignNotFoundError,
  NewsletterLaunchGateBlockedError,
  NewsletterValidationError,
} from "../errors.js";
import { createHookRegistry } from "../hooks.js";
import type { LaunchGateDeps } from "../launch-gate.js";
import type { MembersConsentCapability, SendBatchJob, SubscriberContact, SubscriberDirectoryPort } from "../ports.js";
import {
  InMemoryNewsletterAudienceSnapshotRepo,
  InMemoryNewsletterCampaignRepo,
  InMemoryNewsletterSendRepo,
  InMemoryNewsletterSubscriptionRepo,
} from "../repo.memory.js";
import {
  authorizeSend, completeIfDrained, dispatchRow, freezeAudience, handleSendBatchClaimed, pauseCampaign,
  recordResult, resumeCampaign, sendTestCampaign, SEND_BATCH_CLAIMED_EVENT, type SendPipelineDeps,
} from "../send-pipeline.js";
import type { AudienceSnapshotRow, CampaignRecord, SendRow, SubscriptionRow } from "../types.js";
import type { UnsubscribeDeps } from "../unsubscribe.js";

const WS = "ws-1";
const NOW = "2026-01-02T03:04:00.000Z";
const LEASE_UNTIL = "2026-01-02T03:06:00.000Z";
const ORIGIN: VerifiedOrigin = { scheme: "https", host: "news.example.test", verifiedAt: NOW, source: "workspace-setting" };
const OK: MailerSendResult = { ok: true, providerMessageId: "pm-1", acceptedAt: NOW };

function campaign(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: "camp-1", workspaceId: WS, status: "sending", subject: "Hello", preheader: null,
    fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test", listId: "list-1",
    scheduledAt: null, sendStartedAt: NOW, audienceSnapshotId: "snap-1",
    counters: { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 },
    version: 1, createdByPrincipal: "actor-1", createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function sendRow(overrides: Partial<SendRow> = {}): SendRow {
  return {
    id: "send-1", workspaceId: WS, campaignId: "camp-1", audienceSnapshotId: "snap-1", subscriberId: "sub-1",
    recipientEmail: "reader@example.test", status: "pending", attempts: 0, idempotencyKey: "key-1",
    providerMessageId: null, lastError: null, nextAttemptAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function subscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "subn-1", workspaceId: WS, listId: "list-1", subscriberId: "sub-1", status: "subscribed", source: "admin",
    consentRevisionIdAtSubscribe: "rev-1", subscribedAt: NOW, unsubscribedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function contact(subscriberId: string, emailDeliverable = true): SubscriberContact {
  return { subscriberId, workspaceId: WS, email: `${subscriberId}@example.test`, emailDeliverable };
}

const consentCapability: MembersConsentCapability = {
  request: async () => { throw new Error("consent request is not used by the send pipeline"); },
  confirm: async () => { throw new Error("consent confirm is not used by the send pipeline"); },
  revoke: async () => { throw new Error("consent revoke is not used by the send pipeline"); },
};

const unusedBus: EventBusPort = {
  publish: async () => { throw new Error("bus is not used"); },
  publishBatch: async () => { throw new Error("bus is not used"); },
  subscribe: async () => { throw new Error("bus is not used"); },
  subscribeAll: async () => { throw new Error("bus is not used"); },
};

function originRegistry(required: { fails: boolean }, _optional = {}): OriginRegistryPort {
  return {
    canonicalOrigin: async () => { if (required.fails) throw new Error("origin unset"); return ORIGIN; },
    isAllowedRedirectTarget: async () => true,
    isAllowedEgressTarget: async () => true,
  };
}

/** A scripted mailer: each send takes the next result; the last one repeats. */
function scriptedMailer(required: { results: readonly MailerSendResult[]; driver: string }, _optional = {}) {
  const calls: { message: OutboundEmail; options: MailerSendOptions }[] = [];
  const queue = [...required.results];
  const mailer: PositionalMailer = {
    capabilities: () => ({ driver: required.driver, supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
    send: async (message, options) => {
      calls.push({ message, options });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (!next) throw new Error("no scripted mail result");
      return next;
    },
    sendBatch: async () => { throw new Error("sendBatch is not used by the send pipeline"); },
  };
  return { mailer, calls };
}

interface HarnessInput {
  campaigns?: CampaignRecord[]; sends?: SendRow[]; subscriptions?: SubscriptionRow[]; snapshots?: AudienceSnapshotRow[];
  contacts?: SubscriberContact[]; results?: MailerSendResult[]; driver?: string; sendingEnabled?: boolean; originFails?: boolean;
  campaignRepo?: InMemoryNewsletterCampaignRepo; sendRepo?: InMemoryNewsletterSendRepo;
  sleep?: SendPipelineDeps["sleep"]; unsubscribe?: UnsubscribeDeps;
}

function harness(required: HarnessInput, _optional = {}) {
  const campaigns = required.campaignRepo ?? new InMemoryNewsletterCampaignRepo({ campaigns: required.campaigns ?? [campaign()] });
  const sends = required.sendRepo ?? new InMemoryNewsletterSendRepo({}, { initialRows: required.sends ?? [] });
  const subscriptions = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: required.subscriptions ?? [] });
  const snapshots = new InMemoryNewsletterAudienceSnapshotRepo({}, { initialRows: required.snapshots ?? [] });
  const { mailer, calls: mail } = scriptedMailer({ results: required.results ?? [OK], driver: required.driver ?? "smtp" });
  const events: DomainEvent[] = [];
  const outbox: OutboxPort = {
    enqueue: async (event) => { events.push(event); },
    claimPending: async () => [], markDelivered: async () => undefined, markFailed: async () => undefined,
  };
  const directoryCalls: (readonly string[])[] = [];
  const subscriberDirectory: SubscriberDirectoryPort = {
    getContact: async ({ subscriberId }) => (required.contacts ?? []).find((c) => c.subscriberId === subscriberId) ?? null,
    getContacts: async ({ subscriberIds }) => { directoryCalls.push(subscriberIds); return (required.contacts ?? []).filter((c) => subscriberIds.includes(c.subscriberId)); },
  };
  const launchGateDeps: LaunchGateDeps = {
    isSendingEnabled: async () => required.sendingEnabled ?? true, consentCapability, mailer,
    originRegistry: originRegistry({ fails: required.originFails ?? false }),
    orFallback: async ({ work, fallback }) => { try { return await work(); } catch { return fallback; } },
  };
  let seq = 0;
  const deps: SendPipelineDeps = {
    campaignRepo: campaigns, subscriptionRepo: subscriptions, audienceSnapshotRepo: snapshots, sendRepo: sends,
    subscriberDirectory, hooks: createHookRegistry(), mailer, launchGateDeps, outbox, bus: unusedBus,
    clock: { nowIso: () => NOW }, ids: { newId: () => `id-${String(++seq).padStart(3, "0")}` },
    processOutbox: async () => 0,
    isMailRateLimited: ({ result }) => !result.ok && result.errorCode === "RATE_LIMITED",
    reportError: () => undefined,
    ...(required.sleep ? { sleep: required.sleep } : {}),
    ...(required.unsubscribe ? { unsubscribe: required.unsubscribe } : {}),
  };
  return { deps, campaigns, sends, subscriptions, snapshots, mail, events, directoryCalls };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error) { return error; }
  throw new Error("expected a rejection");
}

function rateLimited(retryAfterMs?: number): MailerSendResult {
  return { ok: false, retryable: true, errorCode: "RATE_LIMITED", message: "slow down", ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}

function jobOf(event: DomainEvent): SendBatchJob {
  const { workspaceId, campaignId, audienceSnapshotId, sendIds } = event.payload;
  if (typeof workspaceId !== "string" || typeof campaignId !== "string" || typeof audienceSnapshotId !== "string"
    || !Array.isArray(sendIds) || !sendIds.every((id): id is string => typeof id === "string")) {
    throw new Error(`event ${event.id} does not carry a send batch job`);
  }
  return { workspaceId, campaignId, audienceSnapshotId, sendIds };
}

const input = { workspaceId: WS, campaignId: "camp-1" };

// ---------------------------------------------------------------- authorizeSend

test("authorizeSend refuses an unknown campaign", async () => {
  const h = harness({ campaigns: [] });
  const error = await rejectionOf(authorizeSend({ deps: h.deps, input }));
  assert.ok(error instanceof NewsletterCampaignNotFoundError);
  assert.equal(error.message, "campaign camp-1 was not found");
});

test("authorizeSend reports every unmet gate precondition and leaves the campaign untouched", async () => {
  const h = harness({ campaigns: [campaign({ status: "scheduled" })], sendingEnabled: false, driver: "memory" });
  const error = await rejectionOf(authorizeSend({ deps: h.deps, input }));
  assert.ok(error instanceof NewsletterLaunchGateBlockedError);
  assert.equal(error.message, "the Launch Readiness Gate is not satisfied");
  assert.deepEqual(error.unmetPreconditions, ["sending_enabled_false", "mailer_adapter_not_production"]);
  assert.equal((await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.status, "scheduled");
});

test("authorizeSend refuses a campaign the pipeline may not start", async () => {
  const h = harness({ campaigns: [campaign({ status: "sent" })] });
  const error = await rejectionOf(authorizeSend({ deps: h.deps, input }));
  assert.ok(error instanceof NewsletterCampaignNotEditableError);
  assert.equal(error.currentStatus, "sent");
  assert.equal(error.attemptedAction, "send");
});

test("authorizeSend starts a scheduled campaign and appends the next revision after the highest seq", async () => {
  const scheduled = campaign({ status: "scheduled", sendStartedAt: null, updatedAt: "2025-12-31T00:00:00.000Z" });
  const old = (seq: number) => ({ campaignId: "camp-1", workspaceId: WS, seq, state: scheduled, actorId: "actor-1", recordedAt: NOW });
  const campaignRepo = new InMemoryNewsletterCampaignRepo({ campaigns: [scheduled], revisions: [old(3), old(1)] });
  const h = harness({ campaignRepo });
  const result = await authorizeSend({ deps: h.deps, input });
  const started = { ...scheduled, status: "sending" as const, sendStartedAt: NOW, updatedAt: NOW };
  assert.deepEqual(result, { campaign: started, launchGateSnapshot: { met: true, unmetPreconditions: [] } });
  assert.deepEqual(await campaignRepo.findById({ workspaceId: WS, id: "camp-1" }), started);
  const revisions = await campaignRepo.listRevisions(input);
  assert.deepEqual(revisions.at(-1), { campaignId: "camp-1", workspaceId: WS, seq: 4, state: started, actorId: "system:send-pipeline", recordedAt: NOW });
});

test("authorizeSend records revision 1 for a campaign without revisions", async () => {
  const h = harness({ campaigns: [campaign({ status: "scheduled" })] });
  await authorizeSend({ deps: h.deps, input });
  assert.deepEqual((await h.campaigns.listRevisions(input)).map((r) => r.seq), [1]);
});

// ---------------------------------------------------------------- freezeAudience

test("freezeAudience refuses an unknown campaign", async () => {
  const h = harness({ campaigns: [] });
  const error = await rejectionOf(freezeAudience({ deps: h.deps, input: { ...input, listId: "list-1" } }));
  assert.ok(error instanceof NewsletterCampaignNotFoundError);
  assert.equal(error.message, "campaign camp-1 was not found");
});

test("freezeAudience is a no-op returning the stored snapshot and its send ids on retry", async () => {
  const snapshot: AudienceSnapshotRow = { id: "snap-1", workspaceId: WS, campaignId: "camp-1", listId: "list-1", recipientCount: 2, createdAt: NOW };
  const h = harness({ snapshots: [snapshot], sends: [sendRow({ id: "send-2" }), sendRow({ id: "send-1" })], subscriptions: [subscription()], contacts: [contact("sub-1")] });
  const result = await freezeAudience({ deps: h.deps, input: { ...input, listId: "list-1" } });
  assert.deepEqual(result, { snapshot, sendIds: ["send-1", "send-2"] });
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.directoryCalls, []);
});

test("freezeAudience snapshots only deliverable, resolvable subscribers and queues one batch event", async () => {
  const subs = [subscription({ id: "a", subscriberId: "sub-1" }), subscription({ id: "b", subscriberId: "sub-2" }), subscription({ id: "c", subscriberId: "sub-3" })];
  // snap-gone is referenced by the campaign but no longer stored: a fresh snapshot is materialized.
  const h = harness({ campaigns: [campaign({ audienceSnapshotId: "snap-gone", updatedAt: "2025-01-01T00:00:00.000Z" })], subscriptions: subs, contacts: [contact("sub-1"), contact("sub-2", false)] });
  const result = await freezeAudience({ deps: h.deps, input: { ...input, listId: "list-1" } });
  const snapshot = { id: "id-001", workspaceId: WS, campaignId: "camp-1", listId: "list-1", recipientCount: 1, createdAt: NOW };
  assert.deepEqual(result, { snapshot, sendIds: ["id-002"] });
  assert.deepEqual(h.directoryCalls, [["sub-1", "sub-2", "sub-3"]]);
  assert.deepEqual(await h.snapshots.findById({ workspaceId: WS, id: "id-001" }), snapshot);
  assert.deepEqual(await h.sends.findById({ workspaceId: WS, id: "id-002" }), sendRow({
    id: "id-002", audienceSnapshotId: "id-001", recipientEmail: "sub-1@example.test", idempotencyKey: "newsletter:camp-1:sub-1:id-001",
  }));
  assert.equal((await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.audienceSnapshotId, "id-001");
  assert.equal((await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.updatedAt, NOW);
  assert.deepEqual(h.events, [{ id: "id-003", name: SEND_BATCH_CLAIMED_EVENT, occurredAt: NOW, workspaceId: WS,
    payload: { workspaceId: WS, campaignId: "camp-1", audienceSnapshotId: "id-001", sendIds: ["id-002"] } }]);
});

test("freezeAudience splits the ledger into outbox batches of 20 and keeps an empty audience event-free", async () => {
  const subs = Array.from({ length: 25 }, (_, i) => subscription({ id: `subn-${i}`, subscriberId: `sub-${i}` }));
  const h = harness({ campaigns: [campaign({ audienceSnapshotId: null })], subscriptions: subs, contacts: subs.map((s) => contact(s.subscriberId)) });
  const result = await freezeAudience({ deps: h.deps, input: { ...input, listId: "list-1" } });
  assert.equal(result.snapshot.recipientCount, 25);
  assert.deepEqual(h.events.map((e) => jobOf(e).sendIds.length), [20, 5]);
  assert.deepEqual(h.events.flatMap((e) => jobOf(e).sendIds), result.sendIds);

  const empty = harness({ campaigns: [campaign({ audienceSnapshotId: null })] });
  const none = await freezeAudience({ deps: empty.deps, input: { ...input, listId: "list-1" } });
  assert.deepEqual(none, { snapshot: { id: "id-001", workspaceId: WS, campaignId: "camp-1", listId: "list-1", recipientCount: 0, createdAt: NOW }, sendIds: [] });
  assert.deepEqual(empty.events, []);
  assert.equal(await empty.sends.countPendingByCampaign(input), 0);
});

test("freezeAudience refuses to attach the snapshot when the campaign disappears mid-materialization", async () => {
  class VanishingCampaignRepo extends InMemoryNewsletterCampaignRepo {
    private reads = 0;
    override async findById(required: { workspaceId: string; id: string }): Promise<CampaignRecord | null> {
      this.reads += 1;
      return this.reads > 1 ? null : super.findById(required);
    }
  }
  const h = harness({ campaignRepo: new VanishingCampaignRepo({ campaigns: [campaign({ audienceSnapshotId: null })] }) });
  const error = await rejectionOf(freezeAudience({ deps: h.deps, input: { ...input, listId: "list-1" } }));
  assert.ok(error instanceof NewsletterCampaignNotFoundError);
  assert.equal(error.message, "campaign camp-1 was not found");
  assert.deepEqual(h.events, []);
});

// ---------------------------------------------------------------- dispatchRow

const dispatchArgs = { campaignId: "camp-1", listId: "list-1", status: "subscribed" as const,
  message: { subject: "Hello", text: "Preview", fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test" } };

test("dispatchRow never re-sends a terminal row and reports its stored outcome", async () => {
  const h = harness({});
  for (const [status, outcome] of [["delivered", "sent"], ["sent", "sent"], ["failed", "failed"], ["bounced", "failed"]] as const) {
    const row = sendRow({ status, providerMessageId: "pm-old", lastError: "old" });
    assert.deepEqual(await dispatchRow({ deps: h.deps, row, ...dispatchArgs }), { outcome, providerMessageId: "pm-old", error: "old" });
  }
  assert.equal(h.mail.length, 0);
});

test("dispatchRow suppresses a recipient whose live subscription is not subscribed", async () => {
  const h = harness({});
  const result = await dispatchRow({ deps: h.deps, row: sendRow(), ...dispatchArgs, status: "unsubscribed" });
  assert.deepEqual(result, { outcome: "suppressed", providerMessageId: null, error: "subscription is 'unsubscribed'" });
  assert.equal(h.mail.length, 0);
});

test("dispatchRow sends on the bulk lane with merged hook headers and a signed one-click unsubscribe link", async () => {
  const derived: { workspaceId: string; purpose: string; info: string }[] = [];
  const keyring: KeyringPort = {
    activeKey: async () => { throw new Error("not used"); },
    deriveSigningSecret: async () => { throw new Error("not used"); },
    derive: async (args) => { derived.push(args); return new Uint8Array([0xab, 0x01]); },
  };
  const unsubscribe: UnsubscribeDeps = { subscriptionRepo: new InMemoryNewsletterSubscriptionRepo(), keyring,
    originRegistry: originRegistry({ fails: false }), consentCapability: null, clock: { nowIso: () => NOW } };
  const h = harness({ unsubscribe });
  h.deps.hooks.registerBeforeSendHook({ hook: (_ctx, message) => ({ ...message, headers: { "X-Campaign": "camp-1" } }) });
  const result = await dispatchRow({ deps: h.deps, row: sendRow(), ...dispatchArgs });
  assert.deepEqual(result, { outcome: "sent", providerMessageId: "pm-1", error: null });
  assert.equal(h.mail.length, 1);
  const sent = h.mail[0];
  assert.deepEqual(sent?.options, { idempotencyKey: "key-1", workspaceId: WS, sourceContext: { module: "newsletter", ref: "send-1" }, purpose: "bulk" });
  assert.equal(sent?.message.subject, "Hello");
  assert.equal(sent?.message.text, "Preview");
  assert.deepEqual(sent?.message.to, { email: "reader@example.test" });
  const headers = sent?.message.headers ?? {};
  assert.equal(headers["X-Campaign"], "camp-1");
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const match = /^<https:\/\/news\.example\.test\/newsletter\/unsubscribe\?token=([^.]+)\.ab01>$/.exec(headers["List-Unsubscribe"] ?? "");
  assert.ok(match?.[1], `unexpected List-Unsubscribe ${headers["List-Unsubscribe"]}`);
  const claims: unknown = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  // No consentRevisionId was passed: the token binds null, never a coerced value.
  assert.deepEqual(claims, { workspaceId: WS, subscriberId: "sub-1", listId: "list-1", campaignId: "camp-1", consentRevisionId: null });
  assert.deepEqual(derived, [{ workspaceId: WS, purpose: "newsletter-unsubscribe", info: "sub-1:list-1:null:camp-1" }]);
});

test("dispatchRow defers a rate-limited send by 1s when the provider gives no hint", async () => {
  const h = harness({ results: [rateLimited()] });
  assert.deepEqual(await dispatchRow({ deps: h.deps, row: sendRow(), ...dispatchArgs }),
    { outcome: "deferred", providerMessageId: null, error: "slow down", retryAfterMs: 1000 });
});

// ---------------------------------------------------------------- recordResult / completeIfDrained

test("recordResult marks a sent row delivered and counts it once", async () => {
  const h = harness({ sends: [sendRow()] });
  const recorded = await recordResult({ deps: h.deps, input: { ...input, sendId: "send-1", outcome: "sent", providerMessageId: "pm-9", error: null } });
  assert.deepEqual(recorded.sendRow, sendRow({ status: "delivered", attempts: 1, providerMessageId: "pm-9", updatedAt: NOW }));
  const again = await recordResult({ deps: h.deps, input: { ...input, sendId: "send-1", outcome: "failed", providerMessageId: null, error: "late" } });
  assert.deepEqual(again.sendRow, recorded.sendRow);
  const counters = (await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.counters;
  assert.equal(counters?.delivered, 1);
  assert.equal(counters?.failed, 0);
});

test("recordResult records a suppressed row as failed with its reason and counts a failure", async () => {
  const h = harness({ sends: [sendRow()] });
  const recorded = await recordResult({ deps: h.deps, input: { ...input, sendId: "send-1", outcome: "suppressed", providerMessageId: null, error: "filtered" } });
  assert.equal(recorded.sendRow.status, "failed");
  assert.equal(recorded.sendRow.lastError, "filtered");
  assert.equal((await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.counters.failed, 1);
});

test("recordResult refuses an unknown send row", async () => {
  const h = harness({});
  const error = await rejectionOf(recordResult({ deps: h.deps, input: { ...input, sendId: "send-x", outcome: "sent", providerMessageId: "pm", error: null } }));
  assert.ok(error instanceof Error);
  assert.equal(error.message, "send row send-x was not found");
});

test("completeIfDrained flips a drained sending campaign to sent and nothing else", async () => {
  assert.deepEqual(await completeIfDrained({ deps: harness({ campaigns: [] }).deps, input }), { campaign: null });
  const paused = harness({ campaigns: [campaign({ status: "paused" })] });
  assert.deepEqual(await completeIfDrained({ deps: paused.deps, input }), { campaign: null });
  const busy = harness({ sends: [sendRow()] });
  assert.deepEqual(await completeIfDrained({ deps: busy.deps, input }), { campaign: null });
  assert.equal((await busy.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.status, "sending");
  const drained = harness({ sends: [sendRow({ status: "delivered" })], campaigns: [campaign({ updatedAt: "2025-01-01T00:00:00.000Z" })] });
  const result = await completeIfDrained({ deps: drained.deps, input });
  assert.deepEqual(result, { campaign: campaign({ status: "sent" }) });
  assert.deepEqual(await drained.campaigns.findById({ workspaceId: WS, id: "camp-1" }), campaign({ status: "sent" }));
});

// ---------------------------------------------------------------- pause / resume

test("pauseCampaign pauses a sending campaign and refuses unknown or non-sending ones", async () => {
  const h = harness({ campaigns: [campaign({ updatedAt: "2025-01-01T00:00:00.000Z" })] });
  assert.deepEqual(await pauseCampaign({ deps: h.deps, input }), { campaign: campaign({ status: "paused" }) });
  const missing = await rejectionOf(pauseCampaign({ deps: harness({ campaigns: [] }).deps, input }));
  assert.ok(missing instanceof NewsletterCampaignNotFoundError);
  const draft = await rejectionOf(pauseCampaign({ deps: harness({ campaigns: [campaign({ status: "draft" })] }).deps, input }));
  assert.ok(draft instanceof NewsletterCampaignNotEditableError);
  assert.equal(draft.currentStatus, "draft");
  assert.equal(draft.attemptedAction, "paused");
});

test("resumeCampaign without a snapshot resumes without queueing anything", async () => {
  const h = harness({ campaigns: [campaign({ status: "paused", audienceSnapshotId: null })] });
  assert.deepEqual(await resumeCampaign({ deps: h.deps, input }), { campaign: campaign({ status: "sending", audienceSnapshotId: null }) });
  assert.deepEqual(h.events, []);
});

test("resumeCampaign requeues every pending row of the current snapshot, paging the ledger by 1000", async () => {
  const pages: (string | undefined)[] = [];
  class RecordingSendRepo extends InMemoryNewsletterSendRepo {
    override async listByCampaign(required: { workspaceId: string; campaignId: string; afterId?: string; limit?: number }): Promise<SendRow[]> {
      pages.push(required.afterId);
      return super.listByCampaign(required);
    }
  }
  const pending = Array.from({ length: 1001 }, (_, i) => sendRow({ id: `s-${String(i).padStart(4, "0")}` }));
  const others = [sendRow({ id: "s-0500a", status: "delivered" }), sendRow({ id: "s-0500b", audienceSnapshotId: "snap-old" })];
  const sendRepo = new RecordingSendRepo({}, { initialRows: [...pending, ...others] });
  const h = harness({ campaigns: [campaign({ status: "paused" })], sendRepo });
  const result = await resumeCampaign({ deps: h.deps, input });
  assert.deepEqual(result, { campaign: campaign({ status: "sending" }) });
  const queued = h.events.flatMap((e) => jobOf(e).sendIds);
  assert.deepEqual(queued, pending.map((r) => r.id));
  assert.ok(h.events.every((e) => jobOf(e).sendIds.length <= 20 && jobOf(e).audienceSnapshotId === "snap-1"));
  assert.equal(pages.length, 2);
  assert.equal(pages[0], undefined);
  assert.equal(pages[1], "s-0997");
});

// ---------------------------------------------------------------- sendTestCampaign

test("sendTestCampaign accepts only 1 to 10 addresses", async () => {
  const h = harness({});
  for (const testAddresses of [[], Array.from({ length: 11 }, (_, i) => `t${i}@example.test`)]) {
    const error = await rejectionOf(sendTestCampaign({ deps: h.deps, input: { ...input, testAddresses } }));
    assert.ok(error instanceof NewsletterValidationError);
    assert.equal(error.message, "test-send address count must be between 1 and 10");
    assert.equal(error.field, "testAddresses");
    assert.equal(error.reason, "length");
  }
  assert.equal(h.mail.length, 0);
});

test("sendTestCampaign refuses an unknown campaign and an unverified origin even for a test send", async () => {
  const missing = await rejectionOf(sendTestCampaign({ deps: harness({ campaigns: [] }).deps, input: { ...input, testAddresses: ["a@example.test"] } }));
  assert.ok(missing instanceof NewsletterCampaignNotFoundError);
  // Sending disabled is waived for a test send; the origin check never is.
  const h = harness({ originFails: true, sendingEnabled: false });
  const blocked = await rejectionOf(sendTestCampaign({ deps: h.deps, input: { ...input, testAddresses: ["a@example.test"] } }));
  assert.ok(blocked instanceof NewsletterLaunchGateBlockedError);
  assert.equal(blocked.message, "the Launch Readiness Gate is not satisfied for a test send");
  assert.deepEqual(blocked.unmetPreconditions, ["origin_not_verified"]);
  assert.equal(h.mail.length, 0);
});

test("sendTestCampaign mails each address a [TEST] copy and reports per-address outcomes", async () => {
  const failed: MailerSendResult = { ok: false, retryable: false, errorCode: "BOUNCED", message: "nope" };
  const h = harness({ campaigns: [campaign({ preheader: "Peek" })], results: [OK, failed] });
  const result = await sendTestCampaign({ deps: h.deps, input: { ...input, testAddresses: ["a@example.test", "b@example.test"] } });
  assert.deepEqual(result, { results: [
    { email: "a@example.test", outcome: "sent", error: null },
    { email: "b@example.test", outcome: "failed", error: "nope", errorCode: "BOUNCED" },
  ] });
  assert.deepEqual(h.mail[0], {
    message: { workspaceId: WS, to: { email: "a@example.test" }, from: { email: "sender@example.test", name: "Sender" },
      replyTo: { email: "reply@example.test" }, subject: "[TEST] Hello", text: "Peek" },
    options: { idempotencyKey: `newsletter:test:camp-1:a@example.test:${NOW}`, workspaceId: WS, sourceContext: { module: "newsletter", ref: "camp-1" } },
  });
  const plain = harness({});
  await sendTestCampaign({ deps: plain.deps, input: { ...input, testAddresses: ["a@example.test"] } });
  assert.equal("text" in (plain.mail[0]?.message ?? {}), false);
});

// ---------------------------------------------------------------- handleSendBatchClaimed

const job = (sendIds: string[]): SendBatchJob => ({ workspaceId: WS, campaignId: "camp-1", audienceSnapshotId: "snap-1", sendIds });

test("handleSendBatchClaimed ignores a batch for an unknown campaign and stops at once for a paused one", async () => {
  const gone = harness({ campaigns: [], sends: [sendRow()] });
  await handleSendBatchClaimed({ deps: gone.deps, job: job(["send-1"]) });
  assert.equal(gone.mail.length, 0);
  const paused = harness({ campaigns: [campaign({ status: "paused" })], sends: [sendRow()] });
  await handleSendBatchClaimed({ deps: paused.deps, job: job(["send-1"]) });
  assert.equal(paused.mail.length, 0);
  assert.equal((await paused.sends.findById({ workspaceId: WS, id: "send-1" }))?.status, "pending");
});

test("handleSendBatchClaimed delivers, suppresses, skips settled rows and completes the drained campaign", async () => {
  const h = harness({
    campaigns: [campaign({ preheader: "Peek" })],
    sends: [sendRow(), sendRow({ id: "send-2", subscriberId: "sub-2", idempotencyKey: "key-2" }), sendRow({ id: "send-3", status: "delivered" })],
    subscriptions: [subscription()],
  });
  await handleSendBatchClaimed({ deps: h.deps, job: job(["send-1", "send-2", "send-3", "send-missing"]) });
  assert.equal(h.mail.length, 1);
  assert.equal(h.mail[0]?.message.text, "Peek");
  assert.equal((await h.sends.findById({ workspaceId: WS, id: "send-1" }))?.status, "delivered");
  // sub-2 has no subscription row: treated as unsubscribed, recorded failed rather than left pending.
  const suppressed = await h.sends.findById({ workspaceId: WS, id: "send-2" });
  assert.equal(suppressed?.status, "failed");
  assert.equal(suppressed?.lastError, "subscription is 'unsubscribed'");
  const final = await h.campaigns.findById({ workspaceId: WS, id: "camp-1" });
  assert.equal(final?.status, "sent");
  assert.deepEqual([final?.counters.delivered, final?.counters.failed], [1, 1]);
});

test("handleSendBatchClaimed fails the batch for rows another run still leases, after sending the rest", async () => {
  const h = harness({ sends: [sendRow({ nextAttemptAt: "2026-01-02T03:05:00.000Z" }), sendRow({ id: "send-2", idempotencyKey: "key-2" })], subscriptions: [subscription()] });
  const error = await rejectionOf(handleSendBatchClaimed({ deps: h.deps, job: job(["send-1", "send-2"]) }));
  assert.ok(error instanceof Error);
  assert.equal(error.message, "1 send row(s) of campaign camp-1 are leased by another run; the batch will be retried");
  assert.equal((await h.sends.findById({ workspaceId: WS, id: "send-2" }))?.status, "delivered");
  assert.equal((await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.status, "sending");
});

test("handleSendBatchClaimed reschedules the deferred row and the rest, due no earlier than the row lease", async () => {
  const h = harness({ results: [OK, rateLimited(1000)], sends: [sendRow(), sendRow({ id: "send-2", idempotencyKey: "key-2" }), sendRow({ id: "send-3", idempotencyKey: "key-3" })], subscriptions: [subscription()] });
  await handleSendBatchClaimed({ deps: h.deps, job: job(["send-1", "send-2", "send-3"]) });
  assert.equal(h.mail.length, 2);
  assert.deepEqual(h.events, [{ id: "id-001", name: SEND_BATCH_CLAIMED_EVENT, occurredAt: LEASE_UNTIL, workspaceId: WS, payload: job(["send-2", "send-3"]) }]);
  assert.equal((await h.sends.findById({ workspaceId: WS, id: "send-2" }))?.status, "pending");
  assert.equal((await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.status, "sending");
});

test("handleSendBatchClaimed dues a rescheduled batch at the provider hint when it outlasts the lease", async () => {
  const h = harness({ results: [rateLimited(300_000)], sends: [sendRow()], subscriptions: [subscription()], sleep: async () => { throw new Error("a 5 minute hint must not be waited inline"); } });
  await handleSendBatchClaimed({ deps: h.deps, job: job(["send-1"]) });
  assert.deepEqual(h.events.map((e) => e.occurredAt), ["2026-01-02T03:09:00.000Z"]);
});

test("handleSendBatchClaimed falls back to now as the lease when the repo hands back an unleased row", async () => {
  class UnleasedSendRepo extends InMemoryNewsletterSendRepo {
    override async claimForDispatch(required: { workspaceId: string; id: string; nowIso: string; leaseUntilIso: string }): Promise<SendRow | null> {
      const leased = await super.claimForDispatch(required);
      return leased && { ...leased, nextAttemptAt: null };
    }
  }
  const h = harness({ results: [rateLimited(5000)], sendRepo: new UnleasedSendRepo({}, { initialRows: [sendRow()] }), subscriptions: [subscription()] });
  await handleSendBatchClaimed({ deps: h.deps, job: job(["send-1"]) });
  assert.deepEqual(h.events.map((e) => e.occurredAt), ["2026-01-02T03:04:05.000Z"]);
});

test("handleSendBatchClaimed waits short quota hints inline, within a 20s budget per run", async () => {
  const waits: number[] = [];
  const h = harness({ results: [rateLimited(2000)], sends: [sendRow()], subscriptions: [subscription()], sleep: async ({ ms }) => { waits.push(ms); } });
  await handleSendBatchClaimed({ deps: h.deps, job: job(["send-1"]) });
  assert.deepEqual(waits, Array.from({ length: 10 }, () => 2000));
  assert.equal(h.mail.length, 11);
  assert.deepEqual(h.events.map((e) => [e.occurredAt, jobOf(e).sendIds]), [[LEASE_UNTIL, ["send-1"]]]);
});

test("handleSendBatchClaimed retries after an inline wait and stops when a pause lands during it", async () => {
  const waits: number[] = [];
  const h = harness({ results: [rateLimited(), OK], sends: [sendRow()], subscriptions: [subscription()], sleep: async ({ ms }) => { waits.push(ms); } });
  await handleSendBatchClaimed({ deps: h.deps, job: job(["send-1"]) });
  assert.deepEqual(waits, [1000]);
  assert.equal((await h.sends.findById({ workspaceId: WS, id: "send-1" }))?.status, "delivered");
  assert.equal((await h.campaigns.findById({ workspaceId: WS, id: "camp-1" }))?.status, "sent");

  const campaignRepo = new InMemoryNewsletterCampaignRepo({ campaigns: [campaign()] });
  const paused = harness({ campaignRepo, results: [rateLimited(500), OK], sends: [sendRow()], subscriptions: [subscription()],
    sleep: async () => { await campaignRepo.saveCampaignRow(campaign({ status: "paused" })); } });
  await handleSendBatchClaimed({ deps: paused.deps, job: job(["send-1"]) });
  assert.equal(paused.mail.length, 1);
  assert.equal((await paused.sends.findById({ workspaceId: WS, id: "send-1" }))?.status, "pending");
  assert.equal((await campaignRepo.findById({ workspaceId: WS, id: "camp-1" }))?.status, "paused");
  assert.deepEqual(paused.events, []);
});
