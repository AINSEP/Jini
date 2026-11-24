import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  InMemoryDeliveryEnvelopeStore,
  InMemoryWebhookDeliveryRepo,
  InMemoryWebhookSubscriptionRepo,
} from "../repo.memory.js";
import type { WebhookDeliveryRecord, WebhookSubscriptionRecord } from "../../types.js";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";

function makeSubscription(overrides: Partial<WebhookSubscriptionRecord> = {}): WebhookSubscriptionRecord {
  return {
    id: "sub-1",
    workspaceId: "workspace-1",
    ownerPrincipalId: "principal-1",
    label: "Endpoint",
    targetUrl: "https://example.com/hooks",
    topics: ["post.published"],
    secretVersion: 1,
    previousSecretVersion: null,
    status: "active",
    createdByPrincipalId: "principal-1",
    createdByPluginId: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    disabledAt: null,
    version: 1,
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    id: "delivery-1",
    workspaceId: "workspace-1",
    subscriptionId: "sub-1",
    eventId: "event-1",
    topic: "post.published",
    status: "pending",
    attempts: 0,
    nextAttemptAt: "2026-07-10T00:00:00.000Z",
    lastResponseStatus: null,
    lastError: null,
    signedWithVersion: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    deliveredAt: null,
    deadAt: null,
    ...overrides,
  };
}

test("findMatching matches exact topic, entity wildcard, and owner wildcard, but not other workspaces or inactive rows", async () => {
  const repo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite }, { initialRows: [
    makeSubscription({ id: "exact", topics: ["post.published"] }),
    makeSubscription({ id: "entity-wildcard", topics: ["post.*"] }),
    makeSubscription({ id: "owner-wildcard", topics: ["*"] }),
    makeSubscription({ id: "no-match", topics: ["comment.created"] }),
    makeSubscription({ id: "paused", topics: ["post.published"], status: "paused" }),
    makeSubscription({ id: "other-workspace", topics: ["post.published"], workspaceId: "workspace-2" }),
  ] });

  const matches = await repo.findMatching({ workspaceId: "workspace-1", topic: "post.published" });
  const ids = matches.map((m) => m.id).sort();

  assert.deepEqual(ids, ["entity-wildcard", "exact", "owner-wildcard"]);
  assert.deepEqual((await repo.findMatching({ workspaceId: "workspace-1", topic: "postage.created" })).map((row) => row.id), ["owner-wildcard"]);
});

test("findMatching treats an empty topic list as fail-closed (never matches)", async () => {
  const repo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite }, { initialRows: [makeSubscription({ id: "empty-topics", topics: [] })] });

  const matches = await repo.findMatching({ workspaceId: "workspace-1", topic: "post.published" });
  assert.deepEqual(matches, []);
});

test("claimPending only returns pending rows due at or before nowIso, and increments attempts", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [
    makeDelivery({ id: "due", nextAttemptAt: "2026-07-10T00:00:00.000Z" }),
    makeDelivery({ id: "future", nextAttemptAt: "2026-07-11T00:00:00.000Z" }),
    makeDelivery({ id: "already-delivering", status: "delivering" }),
  ] });

  const claimed = await repo.claimPending({ batchSize: 10, nowIso: "2026-07-10T12:00:00.000Z" });

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]!.id, "due");
  assert.equal(claimed[0]!.attempts, 1);

  const stored = await repo.findById({ workspaceId: "workspace-1", id: "due" });
  assert.equal(stored?.status, "delivering");
  assert.equal(stored?.attempts, 1);
});

test("markFailed with nextStatus 'failed' re-enters pending; 'dead' stays terminal with deadAt set", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [makeDelivery({ id: "d1" })] });
  await repo.claimPending({ batchSize: 10, nowIso: "2026-07-10T00:00:00.000Z" });

  await repo.markFailed({
    workspaceId: "workspace-1",
    id: "d1",
    error: "boom",
    responseStatus: 500,
    nextStatus: "failed",
    nextAttemptAt: "2026-07-10T00:05:00.000Z",
  });

  let row = await repo.findById({ workspaceId: "workspace-1", id: "d1" });
  assert.equal(row?.status, "pending");
  assert.equal(row?.lastError, "boom");
  assert.equal(row?.nextAttemptAt, "2026-07-10T00:05:00.000Z");
  assert.equal(row?.deadAt, null);

  await repo.markFailed({ workspaceId: "workspace-1", id: "d1", error: "still failing", responseStatus: 500, nextStatus: "dead", nextAttemptAt: "2026-07-10T00:05:00.000Z" }, { deadAtIso: "2026-07-10T00:05:00.000Z" });

  row = await repo.findById({ workspaceId: "workspace-1", id: "d1" });
  assert.equal(row?.status, "dead");
  assert.equal(row?.deadAt, "2026-07-10T00:05:00.000Z");
});

test("markDelivered clears lastError and stamps deliveredAt", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [makeDelivery({ id: "d1", lastError: "previous failure" })] });

  await repo.markDelivered({
    workspaceId: "workspace-1",
    id: "d1",
    responseStatus: 204,
    deliveredAtIso: "2026-07-10T00:10:00.000Z",
  });

  const row = await repo.findById({ workspaceId: "workspace-1", id: "d1" });
  assert.equal(row?.status, "delivered");
  assert.equal(row?.lastError, null);
  assert.equal(row?.lastResponseStatus, 204);
  assert.equal(row?.deliveredAt, "2026-07-10T00:10:00.000Z");
});

test("InMemoryDeliveryEnvelopeStore round-trips save/find and returns null for unknown ids", async () => {
  const store = new InMemoryDeliveryEnvelopeStore();
  const envelope = {
    deliveryId: "delivery-1",
    eventId: "event-1",
    topic: "post.published",
    workspaceId: "workspace-1",
    occurredAt: "2026-07-10T00:00:00.000Z",
    data: { id: "post-1" },
  };

  await store.save({ deliveryId: "delivery-1", envelope });
  const found = await store.find({ deliveryId: "delivery-1" });
  assert.deepEqual(found, envelope);

  const missing = await store.find({ deliveryId: "unknown" });
  assert.equal(missing, null);
});

test("InMemoryWebhookSubscriptionRepo seeds initial rows and findMatching filters them by workspace and status", async () => {
  const repo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite }, { initialRows: [
    makeSubscription(),
    makeSubscription({ id: "sub-other", workspaceId: "workspace-2" }),
    makeSubscription({ id: "sub-paused", status: "paused" }),
  ] });
  assert.deepEqual((await repo.findMatching({ workspaceId: "workspace-1", topic: "post.published" })).map((row) => row.id), ["sub-1"]);
  assert.equal((await repo.findById({ workspaceId: "workspace-2", id: "sub-other" }))?.id, "sub-other");
});

test("InMemoryWebhookSubscriptionRepo seeds initial rows, rejects a duplicate insert, and save overwrites in place", async () => {
  const seeded = makeSubscription();
  const repo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite }, { initialRows: [seeded] });

  assert.deepEqual(await repo.findById({ workspaceId: "workspace-1", id: "sub-1" }), seeded);
  assert.equal(await repo.findById({ workspaceId: "workspace-2", id: "sub-1" }), null);
  await assert.rejects(repo.insert(makeSubscription({ label: "Dup" })), /webhook subscription 'sub-1' already exists/);

  await repo.insert(makeSubscription({ workspaceId: "workspace-2" }));
  await repo.save(makeSubscription({ label: "Renamed" }));
  assert.equal((await repo.findById({ workspaceId: "workspace-1", id: "sub-1" }))?.label, "Renamed");
  assert.deepEqual((await repo.listByWorkspace({ workspaceId: "workspace-2" })).map((row) => row.workspaceId), ["workspace-2"]);
});

test("enqueue is idempotent per (workspace, subscription, event) and markDelivered/markFailed ignore unknown ids", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [makeDelivery()] });

  await repo.enqueue({ record: makeDelivery({ id: "delivery-dup" }) });
  await repo.enqueue({ record: makeDelivery({ id: "delivery-2", eventId: "event-2" }) });
  await repo.markDelivered({ workspaceId: "workspace-1", id: "missing", responseStatus: 200, deliveredAtIso: "2026-07-10T00:00:01.000Z" });
  await repo.markFailed({ workspaceId: "workspace-1", id: "missing", error: "x", responseStatus: null, nextStatus: "dead", nextAttemptAt: "2026-07-10T00:00:01.000Z" });

  assert.equal(await repo.findById({ workspaceId: "workspace-1", id: "delivery-dup" }), null);
  assert.equal(await repo.findById({ workspaceId: "workspace-1", id: "missing" }), null);
  const listed = await repo.listBySubscription({ workspaceId: "workspace-1", subscriptionId: "sub-1", limit: 10 });
  assert.deepEqual(listed.map((row) => [row.id, row.status]), [["delivery-2", "pending"], ["delivery-1", "pending"]]);
});

test("markFailed 'dead' without deadAtIso keeps the row's existing deadAt", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [makeDelivery({ deadAt: "2026-07-09T00:00:00.000Z" })] });

  await repo.markFailed({ workspaceId: "workspace-1", id: "delivery-1", error: "gone", responseStatus: 410, nextStatus: "dead", nextAttemptAt: "2026-07-11T00:00:00.000Z" });

  const row = await repo.findById({ workspaceId: "workspace-1", id: "delivery-1" });
  assert.equal(row?.status, "dead");
  assert.equal(row?.deadAt, "2026-07-09T00:00:00.000Z");
  assert.equal(row?.lastError, "gone");
});

test("listBySubscription orders newest createdAt first, breaks ties by id descending, and honours limit", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [
    makeDelivery({ id: "b", eventId: "e-b", createdAt: "2026-07-10T00:00:00.000Z" }),
    makeDelivery({ id: "a", eventId: "e-a", createdAt: "2026-07-10T00:00:00.000Z" }),
    makeDelivery({ id: "c", eventId: "e-c", createdAt: "2026-07-10T00:00:00.000Z" }),
    makeDelivery({ id: "new", eventId: "e-new", createdAt: "2026-07-11T00:00:00.000Z" }),
    makeDelivery({ id: "old", eventId: "e-old", createdAt: "2026-07-09T00:00:00.000Z" }),
    makeDelivery({ id: "other-sub", subscriptionId: "sub-2", eventId: "e-o" }),
    makeDelivery({ id: "other-ws", workspaceId: "workspace-2", eventId: "e-w" }),
  ] });

  const all = await repo.listBySubscription({ workspaceId: "workspace-1", subscriptionId: "sub-1", limit: 10 });
  assert.deepEqual(all.map((row) => row.id), ["new", "c", "b", "a", "old"]);
  const limited = await repo.listBySubscription({ workspaceId: "workspace-1", subscriptionId: "sub-1", limit: 2 });
  assert.deepEqual(limited.map((row) => row.id), ["new", "c"]);
});

test("claimPending returns due rows oldest nextAttemptAt first and caps them at batchSize", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [
    makeDelivery({ id: "late", eventId: "e-late", nextAttemptAt: "2026-07-10T00:00:03.000Z" }),
    makeDelivery({ id: "early", eventId: "e-early", nextAttemptAt: "2026-07-10T00:00:01.000Z" }),
    makeDelivery({ id: "mid", eventId: "e-mid", nextAttemptAt: "2026-07-10T00:00:02.000Z" }),
  ] });

  const claimed = await repo.claimPending({ batchSize: 2, nowIso: "2026-07-10T00:00:05.000Z" });

  assert.deepEqual(claimed.map((row) => row.id), ["early", "mid"]);
  assert.equal((await repo.findById({ workspaceId: "workspace-1", id: "late" }))?.status, "pending");
});

test("releaseClaim returns its own delivering claim to pending and undoes the attempt; stale fences, other states and unknown ids are no-ops", async () => {
  const repo = new InMemoryWebhookDeliveryRepo({}, { initialRows: [makeDelivery({ id: "d1", nextAttemptAt: "2026-07-10T00:00:00.000Z" }), makeDelivery({ id: "pending-row" })] });
  await repo.claimPending({ batchSize: 1, nowIso: "2026-07-10T00:00:00.000Z" });

  await repo.releaseClaim({ workspaceId: "workspace-1", id: "d1", claimedAttempts: 0, nextAttemptAt: "2026-07-10T01:00:00.000Z" });
  assert.equal((await repo.findById({ workspaceId: "workspace-1", id: "d1" }))?.status, "delivering", "an older claim's fence cannot release a newer claim");

  await repo.releaseClaim({ workspaceId: "workspace-1", id: "d1", claimedAttempts: 1, nextAttemptAt: "2026-07-10T01:00:00.000Z" });
  const released = await repo.findById({ workspaceId: "workspace-1", id: "d1" });
  assert.deepEqual([released?.status, released?.attempts, released?.nextAttemptAt], ["pending", 0, "2026-07-10T01:00:00.000Z"]);

  const before = structuredClone(await repo.findById({ workspaceId: "workspace-1", id: "pending-row" }));
  await repo.releaseClaim({ workspaceId: "workspace-1", id: "pending-row", claimedAttempts: before!.attempts, nextAttemptAt: "2027-01-01T00:00:00.000Z" });
  assert.deepEqual(await repo.findById({ workspaceId: "workspace-1", id: "pending-row" }), before, "a row that is not delivering is untouched");
  await repo.releaseClaim({ workspaceId: "workspace-1", id: "missing", claimedAttempts: 1, nextAttemptAt: "2027-01-01T00:00:00.000Z" });
  assert.equal(await repo.findById({ workspaceId: "workspace-1", id: "missing" }), null);
});

test("save delegates a stale expectedVersion to the injected assertVersionedWrite and keeps the row when it throws", async () => {
  const seeded = makeSubscription({ version: 2 });
  const conflict = new Error("injected conflict");
  const injected = vi.fn(async () => { throw conflict; });
  const repo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite: injected }, { initialRows: [seeded] });

  await assert.rejects(repo.save(makeSubscription({ version: 3, label: "Stale" }), { expectedVersion: 1 }), conflict);
  assert.equal(injected.mock.calls.length, 1);
  const [call] = injected.mock.calls[0] as unknown as [{ changedRows: number; recordKind: string; recordId: string; expectedVersion: number; readCurrentVersion: () => Promise<number | null> }];
  assert.deepEqual([call.changedRows, call.recordKind, call.recordId, call.expectedVersion], [0, "webhook subscription", "sub-1", 1]);
  assert.equal(await call.readCurrentVersion(), 2);
  assert.equal((await repo.findById({ workspaceId: "workspace-1", id: "sub-1" }))?.label, seeded.label);
});

test("save skips the injected assertVersionedWrite when expectedVersion matches or is absent", async () => {
  const injected = vi.fn(async () => undefined);
  const repo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite: injected }, { initialRows: [makeSubscription({ version: 2 })] });

  await repo.save(makeSubscription({ version: 3, label: "Fresh" }), { expectedVersion: 2 });
  await repo.save(makeSubscription({ version: 4, label: "Unversioned" }));
  assert.equal(injected.mock.calls.length, 0);
  assert.equal((await repo.findById({ workspaceId: "workspace-1", id: "sub-1" }))?.label, "Unversioned");
});
