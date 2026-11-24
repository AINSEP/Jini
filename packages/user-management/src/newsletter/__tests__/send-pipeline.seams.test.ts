/**
 * @file Pins the host-injected collaborators of `send-pipeline.ts`: the outbox claim loop
 * (`processOutbox`), the shared mail rate-limit predicate (`isMailRateLimited`) and the error
 * reporter (`reportError`). The full pipeline suite runs in the host against its real outbox.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { EventBusPort, OutboxPort } from "@jini-ai/core/contracts/events";
import type { MailerSendResult, PositionalMailer } from "@jini-ai/core/contracts/mail";
import { createHookRegistry } from "../hooks.js";
import {
  InMemoryNewsletterAudienceSnapshotRepo,
  InMemoryNewsletterCampaignRepo,
  InMemoryNewsletterSendRepo,
  InMemoryNewsletterSubscriptionRepo,
} from "../repo.memory.js";
import { claimBatch, dispatchRow, resumeCampaign, type SendPipelineDeps } from "../send-pipeline.js";
import type { CampaignRecord, SendRow } from "../types.js";

const WS = "ws-1";
const NOW = "2026-01-02T03:04:05.000Z";

function campaign(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: "camp-1", workspaceId: WS, status: "paused", subject: "Hello", preheader: null,
    fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test", listId: "list-1",
    scheduledAt: null, sendStartedAt: NOW, audienceSnapshotId: "snap-1",
    counters: { recipients: 1, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 },
    version: 1, createdByPrincipal: "actor-1", createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function sendRow(): SendRow {
  return {
    id: "send-1", workspaceId: WS, campaignId: "camp-1", audienceSnapshotId: "snap-1", subscriberId: "sub-1",
    recipientEmail: "reader@example.test", status: "pending", attempts: 0, idempotencyKey: "key-1",
    providerMessageId: null, lastError: null, nextAttemptAt: null, createdAt: NOW, updatedAt: NOW,
  };
}

function mailerReturning(result: MailerSendResult): PositionalMailer {
  return { send: async () => result, sendBatch: async () => [result] } as unknown as PositionalMailer;
}

function makeDeps(overrides: Partial<SendPipelineDeps> = {}): SendPipelineDeps {
  return {
    campaignRepo: new InMemoryNewsletterCampaignRepo({ campaigns: [campaign()] }),
    subscriptionRepo: new InMemoryNewsletterSubscriptionRepo(),
    audienceSnapshotRepo: new InMemoryNewsletterAudienceSnapshotRepo(),
    sendRepo: new InMemoryNewsletterSendRepo({}, { initialRows: [sendRow()] }),
    subscriberDirectory: {} as SendPipelineDeps["subscriberDirectory"],
    hooks: createHookRegistry(),
    mailer: mailerReturning({ ok: true, providerMessageId: "pm-1", acceptedAt: NOW }),
    launchGateDeps: {} as SendPipelineDeps["launchGateDeps"],
    outbox: { enqueue: async () => undefined } as unknown as OutboxPort,
    bus: {} as EventBusPort,
    clock: { nowIso: () => NOW },
    ids: { newId: () => "id-1" },
    processOutbox: async () => 0,
    isMailRateLimited: () => false,
    reportError: () => undefined,
    ...overrides,
  };
}

test("claimBatch hands the injected outbox loop the outbox, bus, a millisecond clock and batchSize 20 by default", async () => {
  const calls: { required: Parameters<SendPipelineDeps["processOutbox"]>[0]; optional: Parameters<SendPipelineDeps["processOutbox"]>[1] }[] = [];
  const deps = makeDeps({ processOutbox: async (required, optional) => { calls.push({ required, optional }); return 7; } });
  assert.equal(await claimBatch({ deps }), 7);
  assert.equal(await claimBatch({ deps }, { batchSize: 5 }), 7);
  assert.equal(calls[0]?.required.outbox, deps.outbox);
  assert.equal(calls[0]?.required.bus, deps.bus);
  assert.equal(calls[0]?.required.clock.nowMs(), Date.parse(NOW));
  assert.deepEqual(calls.map((call) => call.optional), [{ batchSize: 20 }, { batchSize: 5 }]);
});

test("dispatchRow defers a failed send only when the injected predicate calls it rate limited", async () => {
  const failed: MailerSendResult = { ok: false, retryable: true, errorCode: "SOME_CODE", message: "slow down", retryAfterMs: 1500 };
  const seen: MailerSendResult[] = [];
  const args = { row: sendRow(), campaignId: "camp-1", listId: "list-1", status: "subscribed" as const,
    message: { subject: "Hello", fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test" } };
  const limited = makeDeps({ mailer: mailerReturning(failed), isMailRateLimited: ({ result }) => { seen.push(result); return true; } });
  assert.deepEqual(await dispatchRow({ deps: limited, ...args }), { outcome: "deferred", providerMessageId: null, error: "slow down", retryAfterMs: 1500 });
  assert.deepEqual(seen, [failed]);
  const notLimited = makeDeps({ mailer: mailerReturning(failed), isMailRateLimited: () => false });
  assert.deepEqual(await dispatchRow({ deps: notLimited, ...args }), { outcome: "failed", providerMessageId: null, error: "slow down" });
});

test("resumeCampaign reports a failed requeue through the injected reporter and still returns the committed resume", async () => {
  const boom = new Error("enqueue failed");
  const reports: { message: string; error: unknown }[] = [];
  const deps = makeDeps({
    outbox: { enqueue: async () => { throw boom; } } as unknown as OutboxPort,
    reportError: (report) => { reports.push(report); },
  });
  const result = await resumeCampaign({ deps, input: { workspaceId: WS, campaignId: "camp-1" } });
  assert.deepEqual(result, { campaign: campaign({ status: "sending" }), requeueFailed: true });
  assert.deepEqual(reports, [{ message: "[newsletter] pending delivery requeue failed after resume; inspect the send log before retrying", error: boom }]);
});

test("dispatchRow hands in-process hooks a message whose text and html keys are present even when undefined", async () => {
  const hooks = createHookRegistry();
  const seenKeys: string[][] = [];
  hooks.registerBeforeSendHook({ hook: (_ctx, message) => { seenKeys.push(Object.keys(message)); return message; } });
  const deps = makeDeps({ hooks });
  await dispatchRow({ deps, row: sendRow(), campaignId: "camp-1", listId: "list-1", status: "subscribed",
    message: { subject: "Hello", fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test" } });
  assert.equal(seenKeys.length, 1);
  assert.ok(seenKeys[0]?.includes("text") && seenKeys[0]?.includes("html"), `hook saw keys ${JSON.stringify(seenKeys[0])}`);
});
