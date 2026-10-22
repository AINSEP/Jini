import assert from "node:assert/strict";
import { test } from "vitest";

import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { DEFAULT_WEBHOOK_REQUEST_TOTAL_DEADLINE_MS, processDueDeliveries } from "../delivery.js";
import type { WebhookDeliveryRepoPort } from "../ports.js";
import { createFixedSecretSigner } from "../signing.js";
import type { WebhookDeliveryRecord, WebhookSubscriptionRecord } from "../types.js";
import { InMemoryDeliveryEnvelopeStore, InMemoryWebhookDeliveryRepo, InMemoryWebhookSubscriptionRepo } from "./memory-fixtures.js";

/**
 * @file Cancellation, total deadline and claim-lease behaviour of `processDueDeliveries`: a batch
 * cancelled by its host's shutdown signal settles the in-flight request, returns unattempted
 * claims to `pending`, and claims carry a lease so an abandoned batch is reclaimable.
 */

const NOW = "2026-07-10T00:00:00.000Z";
const headers = { signature: "x-signature", deliveryId: "x-delivery-id", eventId: "x-event-id" };

function delivery(id: string, overrides: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    id, workspaceId: "workspace-1", subscriptionId: "sub-1", eventId: `event-${id}`, topic: "post.published",
    status: "pending", attempts: 0, nextAttemptAt: NOW, lastResponseStatus: null, lastError: null,
    signedWithVersion: null, createdAt: NOW, deliveredAt: null, deadAt: null, ...overrides,
  };
}

const subscription: WebhookSubscriptionRecord = {
  id: "sub-1", workspaceId: "workspace-1", ownerPrincipalId: "principal-1", label: "Endpoint",
  targetUrl: "https://example.com/hooks", topics: ["post.published"], secretVersion: 1,
  previousSecretVersion: null, status: "active", createdByPrincipalId: "principal-1", createdByPluginId: null,
  createdAt: NOW, updatedAt: NOW, disabledAt: null,
};

async function rig(rows: WebhookDeliveryRecord[], httpClient: HttpClientPort, deliveryRepo: WebhookDeliveryRepoPort = new InMemoryWebhookDeliveryRepo(rows)) {
  const subscriptionRepo = new InMemoryWebhookSubscriptionRepo();
  await subscriptionRepo.save(subscription);
  const envelopeStore = new InMemoryDeliveryEnvelopeStore();
  for (const row of rows) {
    await envelopeStore.save({ deliveryId: row.id, envelope: { deliveryId: row.id, eventId: row.eventId, topic: row.topic, workspaceId: row.workspaceId, occurredAt: NOW, data: {} } });
  }
  const signer = createFixedSecretSigner({ secrets: new Map([["sub-1", Buffer.from("secret")]]), vocabulary: { timestampField: "t", signatureField: "v1" } });
  return { deliveryRepo, deps: { deliveryRepo, subscriptionRepo, envelopeStore, httpClient, signer, headers, clock: { nowMs: () => Date.parse(NOW) } } };
}

/** An HTTP client whose first request hangs until its signal aborts, as a guarded client does. */
function hangingClient(onFirstRequest: () => void) {
  const requests: HttpRequest[] = [];
  const client: HttpClientPort = {
    send: ({ request }) => {
      requests.push(request);
      const pending = new Promise<HttpResponse>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(request.signal!.reason as Error), { once: true });
      });
      onFirstRequest();
      return pending;
    },
  };
  return { client, requests };
}

test("every request carries the host signal and a bounded total deadline (default 30 s), beside the idle timeout", async () => {
  const requests: HttpRequest[] = [];
  const client: HttpClientPort = { send: async ({ request }) => { requests.push(request); return { status: 200, headers: {}, bodyText: "" }; } };
  const controller = new AbortController();
  const { deps } = await rig([delivery("d1"), delivery("d2")], client);

  await processDueDeliveries({ deps }, { signal: controller.signal });
  assert.equal(DEFAULT_WEBHOOK_REQUEST_TOTAL_DEADLINE_MS, 30_000);
  assert.deepEqual(requests.map((request) => [request.timeoutMs, request.totalDeadlineMs, request.signal]), [
    [10_000, 30_000, controller.signal],
    [10_000, 30_000, controller.signal],
  ]);

  const injected = await rig([delivery("d3")], client);
  await processDueDeliveries({ deps: injected.deps }, { requestTotalDeadlineMs: 5_000 });
  assert.equal(requests[2]!.totalDeadlineMs, 5_000);
  assert.equal(requests[2]!.signal, undefined, "no signal is invented when the host supplies none");
});

test("claims carry a lease covering the whole batch's deadlines (default) or an injected one", async () => {
  const seen: (number | undefined)[] = [];
  const spy = (repo: InMemoryWebhookDeliveryRepo): WebhookDeliveryRepoPort => Object.assign(repo, {
    claimPending: (required: { batchSize: number; nowIso: string }, optional: { claimLeaseMs?: number } = {}) => {
      seen.push(optional.claimLeaseMs);
      return InMemoryWebhookDeliveryRepo.prototype.claimPending.call(repo, required, optional);
    },
  });
  const ok: HttpClientPort = { send: async () => ({ status: 200, headers: {}, bodyText: "" }) };
  const first = await rig([], ok, spy(new InMemoryWebhookDeliveryRepo()));
  await processDueDeliveries({ deps: first.deps }, { batchSize: 4, requestTotalDeadlineMs: 1_000 });
  await processDueDeliveries({ deps: first.deps });
  await processDueDeliveries({ deps: first.deps }, { claimLeaseMs: 77 });
  assert.deepEqual(seen, [4 * 1_000 + 60_000, 20 * 30_000 + 60_000, 77]);
});

test("an aborted signal mid-batch settles the in-flight attempt and returns the unattempted claims to pending", async () => {
  const controller = new AbortController();
  const { client, requests } = hangingClient(() => controller.abort(new Error("host is shutting down")));
  const { deps, deliveryRepo } = await rig([delivery("d1"), delivery("d2"), delivery("d3", { attempts: 2 })], client);

  const result = await processDueDeliveries({ deps }, { signal: controller.signal, random: () => 0 });

  assert.equal(requests.length, 1, "no request starts after the signal aborts");
  assert.deepEqual(result, { processed: 3, delivered: 0, failed: 1, dead: 0 });
  const [d1, d2, d3] = await Promise.all(["d1", "d2", "d3"].map((id) => deliveryRepo.findById({ workspaceId: "workspace-1", id })));
  assert.deepEqual([d1!.status, d1!.attempts, d1!.lastError], ["pending", 1, "host is shutting down"], "the in-flight attempt was made and counts");
  assert.deepEqual([d2!.status, d2!.attempts, d2!.nextAttemptAt, d2!.lastError], ["pending", 0, NOW, null], "never attempted: released, attempts restored, due now");
  assert.deepEqual([d3!.status, d3!.attempts], ["pending", 2]);
});

test("a signal already aborted claims nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const { client, requests } = hangingClient(() => {});
  const { deps, deliveryRepo } = await rig([delivery("d1")], client);
  assert.deepEqual(await processDueDeliveries({ deps }, { signal: controller.signal }), { processed: 0, delivered: 0, failed: 0, dead: 0 });
  assert.equal(requests.length, 0);
  assert.equal((await deliveryRepo.findById({ workspaceId: "workspace-1", id: "d1" }))!.status, "pending");
});

test("a repo without releaseClaim keeps cancelled claims delivering until their lease expires, then reclaims them", async () => {
  const controller = new AbortController();
  const { client } = hangingClient(() => controller.abort(new Error("stop")));
  const repo = new InMemoryWebhookDeliveryRepo([delivery("d1"), delivery("d2")]);
  const noRelease: WebhookDeliveryRepoPort = {
    enqueue: (r) => repo.enqueue(r),
    claimPending: (r, o) => repo.claimPending(r, o),
    markDelivered: (r, o) => repo.markDelivered(r, o),
    markFailed: (r, o) => repo.markFailed(r, o),
    findById: (r) => repo.findById(r),
    listBySubscription: (r) => repo.listBySubscription(r),
  };
  const { deps } = await rig([delivery("d1"), delivery("d2")], client, noRelease);
  await processDueDeliveries({ deps }, { signal: controller.signal, claimLeaseMs: 1_000, random: () => 0 });
  const stranded = await repo.findById({ workspaceId: "workspace-1", id: "d2" });
  assert.deepEqual([stranded!.status, stranded!.attempts, stranded!.nextAttemptAt], ["delivering", 1, "2026-07-10T00:00:01.000Z"]);

  assert.deepEqual(await repo.claimPending({ batchSize: 5, nowIso: "2026-07-10T00:00:00.500Z" }, { claimLeaseMs: 1_000 }), [], "a live lease is not reclaimed");
  const reclaimed = await repo.claimPending({ batchSize: 5, nowIso: "2026-07-10T00:00:01.000Z" }, { claimLeaseMs: 1_000 });
  assert.deepEqual(reclaimed.map((row) => [row.id, row.attempts]), [["d2", 2]]);
});

test("outcomes are fenced on the claim's attempts, so a stale claimer cannot overwrite a newer claim", async () => {
  const calls: unknown[] = [];
  const repo = new InMemoryWebhookDeliveryRepo([delivery("d1", { attempts: 3 }), delivery("d2", { attempts: 8 })]);
  const recording: WebhookDeliveryRepoPort = Object.assign(Object.create(repo) as InMemoryWebhookDeliveryRepo, {
    markDelivered: (r: Parameters<WebhookDeliveryRepoPort["markDelivered"]>[0], o?: { claimedAttempts?: number }) => { calls.push(["delivered", r.id, o]); return repo.markDelivered(r, o); },
    markFailed: (r: Parameters<WebhookDeliveryRepoPort["markFailed"]>[0], o?: { claimedAttempts?: number; deadAtIso?: string }) => { calls.push(["failed", r.id, o]); return repo.markFailed(r, o); },
  });
  let n = 0;
  const client: HttpClientPort = { send: async () => ({ status: (n += 1) === 1 ? 200 : 500, headers: {}, bodyText: "" }) };
  const { deps } = await rig([delivery("d1"), delivery("d2")], client, recording);
  await processDueDeliveries({ deps }, { random: () => 0 });
  assert.deepEqual(calls, [
    ["delivered", "d1", { claimedAttempts: 4 }],
    ["failed", "d2", { deadAtIso: NOW, claimedAttempts: 9 }],
  ]);

  // The fixture honours the fence the way durable adapters must.
  await repo.markDelivered({ workspaceId: "workspace-1", id: "d2", responseStatus: 200, deliveredAtIso: NOW }, { claimedAttempts: 1 });
  assert.equal((await repo.findById({ workspaceId: "workspace-1", id: "d2" }))!.status, "dead");
  await repo.releaseClaim({ workspaceId: "workspace-1", id: "d1", claimedAttempts: 4, nextAttemptAt: NOW });
  assert.equal((await repo.findById({ workspaceId: "workspace-1", id: "d1" }))!.status, "delivered", "only a delivering claim is released");
  await repo.releaseClaim({ workspaceId: "workspace-1", id: "missing", claimedAttempts: 1, nextAttemptAt: NOW });
});

test("a non-Error abort reason is recorded as an unknown delivery error, never stringified", async () => {
  const controller = new AbortController();
  const { client } = hangingClient(() => controller.abort("bye"));
  const { deps, deliveryRepo } = await rig([delivery("d1")], client);
  await processDueDeliveries({ deps }, { signal: controller.signal, random: () => 0 });
  assert.equal((await deliveryRepo.findById({ workspaceId: "workspace-1", id: "d1" }))!.lastError, "unknown webhook delivery error");
});
