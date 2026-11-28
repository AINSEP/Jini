import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, test } from "vitest";
import { assertVersionedWrite, RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import type { KyselyKernel } from "@jini-ai/db/kernel";
import type { WebhookDeliveryRecord, WebhookEventEnvelope, WebhookSubscriptionRecord } from "../../types.js";
import { SqlWebhookDeliveryRepo, SqlWebhookSubscriptionRepo } from "../webhook-repo.js";
import { openWebhookKernel, TABLES } from "./support/webhook-tables.fixture.js";

/**
 * @file The webhook SQL adapters on every embedded dialect: one query body serves SQLite and PGlite.
 * A stale subscription save is refused (lost update), a conditional save never creates a row, topic
 * matching follows the in-memory adapter, a claim marks rows `delivering` once and under an optional
 * lease, and the envelope lives on the delivery row.
 */

const T0 = "2026-11-22T00:00:00.000Z";
const subscription: WebhookSubscriptionRecord = { id: "sub", workspaceId: "ws", ownerPrincipalId: "owner", label: "Original",
  targetUrl: "https://example.com/hook", topics: ["post.created"], secretVersion: 1, previousSecretVersion: null, status: "active",
  createdByPrincipalId: "owner", createdByPluginId: null, createdAt: T0, updatedAt: T0, disabledAt: null, version: 1 };
const delivery = (id: string, nextAttemptAt = T0): WebhookDeliveryRecord => ({ id, workspaceId: "ws", subscriptionId: "sub", eventId: `evt-${id}`,
  topic: "post.created", status: "pending", attempts: 0, nextAttemptAt, lastResponseStatus: null, lastError: null, signedWithVersion: 1,
  createdAt: T0, deliveredAt: null, deadAt: null });

const opened: KyselyKernel<unknown>[] = [];
afterAll(async () => { for (const kernel of opened) await kernel.close(); });

describe.each(["sqlite", "postgres"] as const)("webhook sql adapters [%s]", (dialect) => {
  // PGlite is embedded (no server), but its first instance pays the WASM compile (~1.3 s). Paying it
  // here, under the hook timeout, keeps that one-off cost out of whichever test happens to run first;
  // on a loaded host it pushed the stale-save test past the 5 s test timeout while its assertions held.
  beforeAll(async () => { opened.push(await openWebhookKernel({ dialect })); });

  async function make() {
    const kernel = await openWebhookKernel({ dialect });
    opened.push(kernel);
    return {
      subscriptions: new SqlWebhookSubscriptionRepo({ kernel, tables: TABLES, assertVersionedWrite }, {}),
      deliveries: new SqlWebhookDeliveryRepo({ kernel, tables: TABLES }, {}),
    };
  }

  test("a stale save is refused and the first editor's change survives", async () => {
    const { subscriptions } = await make();
    await subscriptions.save(subscription);
    await subscriptions.save({ ...subscription, label: "First", version: 2 }, { expectedVersion: 1 });
    await assert.rejects(subscriptions.save({ ...subscription, label: "Second", version: 2 }, { expectedVersion: 1 }),
      (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
    const saved = await subscriptions.findById({ workspaceId: "ws", id: "sub" });
    assert.equal(saved?.label, "First");
    assert.equal(saved?.version, 2);
  });

  test("the conditional save finishes through the injected versioned-write collaborator", async () => {
    const kernel = await openWebhookKernel({ dialect });
    opened.push(kernel);
    const calls: { changedRows: number | bigint; recordKind: string; recordId: string; expectedVersion: number }[] = [];
    const subscriptions = new SqlWebhookSubscriptionRepo({ kernel, tables: TABLES, assertVersionedWrite: async (required) => {
      const { readCurrentVersion: _read, ...facts } = required;
      calls.push(facts);
      if (Number(required.changedRows) === 0) throw new Error(`injected refusal at ${String(await required.readCurrentVersion())}`);
    } }, {});
    await subscriptions.save(subscription);
    await subscriptions.save({ ...subscription, label: "First", version: 2 }, { expectedVersion: 1 });
    await assert.rejects(subscriptions.save({ ...subscription, label: "Second", version: 3 }, { expectedVersion: 1 }), /injected refusal at 2/);
    assert.deepEqual(calls.map(({ changedRows, ...rest }) => ({ ...rest, changedRows: Number(changedRows) })), [
      { recordKind: "webhook subscription", recordId: "sub", expectedVersion: 1, changedRows: 1 },
      { recordKind: "webhook subscription", recordId: "sub", expectedVersion: 1, changedRows: 0 },
    ]);
  });

  test("a conditional save cannot create a missing subscription", async () => {
    const { subscriptions } = await make();
    await assert.rejects(subscriptions.save({ ...subscription, version: 2 }, { expectedVersion: 1 }),
      (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === null);
    assert.equal(await subscriptions.findById({ workspaceId: "ws", id: "sub" }), null);
  });

  test("a record round-trips, is workspace-scoped, and findMatching follows wildcard topics on active rows only", async () => {
    const { subscriptions } = await make();
    await subscriptions.insert({ ...subscription, topics: ["post.*"] });
    await subscriptions.insert({ ...subscription, id: "all", topics: ["*"] });
    await subscriptions.insert({ ...subscription, id: "paused", topics: ["*"], status: "paused" });
    await subscriptions.insert({ ...subscription, id: "other-ws", workspaceId: "ws-2", topics: ["*"] });
    assert.deepEqual(await subscriptions.findById({ workspaceId: "ws", id: "sub" }), { ...subscription, topics: ["post.*"] });
    assert.equal(await subscriptions.findById({ workspaceId: "ws-2", id: "sub" }), null);
    assert.deepEqual((await subscriptions.listByWorkspace({ workspaceId: "ws" })).map((row) => row.id).sort(), ["all", "paused", "sub"]);
    assert.deepEqual((await subscriptions.findMatching({ workspaceId: "ws", topic: "post.created" })).map((row) => row.id).sort(), ["all", "sub"]);
    assert.deepEqual((await subscriptions.findMatching({ workspaceId: "ws", topic: "page.created" })).map((row) => row.id), ["all"]);
  });

  test("creator attribution persists, so the agent switch can tell agent-made subscriptions apart after a restart", async () => {
    const { subscriptions } = await make();
    await subscriptions.insert({ ...subscription, id: "by-agent", createdByKind: "agent" });
    await subscriptions.insert({ ...subscription, id: "by-person", createdByKind: "person" });
    await subscriptions.insert({ ...subscription, id: "legacy" });
    assert.equal((await subscriptions.findById({ workspaceId: "ws", id: "by-agent" }))?.createdByKind, "agent");
    assert.equal((await subscriptions.findById({ workspaceId: "ws", id: "by-person" }))?.createdByKind, "person");
    // A row written before attribution existed reads back unattributed, which the switch treats as person-made.
    assert.equal((await subscriptions.findById({ workspaceId: "ws", id: "legacy" }))?.createdByKind, undefined);
  });

  test("enqueue is idempotent, stores the envelope on the same row, and a claim takes each due row once", async () => {
    const { deliveries } = await make();
    const envelope: WebhookEventEnvelope = { deliveryId: "d1", eventId: "evt-d1", topic: "post.created", workspaceId: "ws", occurredAt: T0, data: { id: "p1" } };
    await deliveries.enqueue({ record: delivery("d1") }, { envelope });
    await deliveries.enqueue({ record: delivery("d1") });
    await deliveries.enqueue({ record: delivery("d2", "2026-11-22T01:00:00.000Z") });
    assert.deepEqual(await deliveries.find({ deliveryId: "d1" }), envelope);
    const claimed = await deliveries.claimPending({ batchSize: 5, nowIso: T0 });
    assert.deepEqual(claimed, [{ ...delivery("d1"), status: "delivering", attempts: 1 }]);
    assert.deepEqual(await deliveries.claimPending({ batchSize: 5, nowIso: T0 }), [], "a delivering row without a lease is not re-claimed");
    assert.equal((await deliveries.findById({ workspaceId: "ws", id: "d1" }))?.status, "delivering");
  });

  test("with claimLeaseMs an expired lease is claimable again, and a stale claimer's outcome is fenced", async () => {
    const { deliveries } = await make();
    await deliveries.enqueue({ record: delivery("d1") });
    const [first] = await deliveries.claimPending({ batchSize: 1, nowIso: T0 }, { claimLeaseMs: 60_000 });
    assert.equal(first?.nextAttemptAt, "2026-11-22T00:01:00.000Z");
    assert.deepEqual(await deliveries.claimPending({ batchSize: 1, nowIso: "2026-11-22T00:00:59.999Z" }, { claimLeaseMs: 60_000 }), []);
    const [second] = await deliveries.claimPending({ batchSize: 1, nowIso: "2026-11-22T00:01:00.000Z" }, { claimLeaseMs: 60_000 });
    assert.equal(second?.attempts, 2);
    await deliveries.markDelivered({ workspaceId: "ws", id: "d1", responseStatus: 200, deliveredAtIso: T0 }, { claimedAttempts: 1 });
    assert.equal((await deliveries.findById({ workspaceId: "ws", id: "d1" }))?.status, "delivering", "the stale claim's outcome is ignored");
    await deliveries.markFailed({ workspaceId: "ws", id: "d1", error: "boom", responseStatus: 500, nextStatus: "dead", nextAttemptAt: T0 }, { deadAtIso: T0, claimedAttempts: 2 });
    const dead = await deliveries.findById({ workspaceId: "ws", id: "d1" });
    assert.deepEqual([dead?.status, dead?.lastError, dead?.lastResponseStatus, dead?.deadAt], ["dead", "boom", 500, T0]);
  });

  test("releaseClaim returns an untouched claim to pending; listBySubscription is newest first", async () => {
    const { deliveries } = await make();
    await deliveries.enqueue({ record: delivery("d1") });
    await deliveries.enqueue({ record: { ...delivery("d2"), createdAt: "2026-11-22T00:00:01.000Z" } });
    await deliveries.claimPending({ batchSize: 1, nowIso: T0 });
    await deliveries.releaseClaim({ workspaceId: "ws", id: "d1", claimedAttempts: 1, nextAttemptAt: T0 });
    const released = await deliveries.findById({ workspaceId: "ws", id: "d1" });
    assert.deepEqual([released?.status, released?.attempts], ["pending", 0]);
    assert.deepEqual((await deliveries.listBySubscription({ workspaceId: "ws", subscriptionId: "sub", limit: 5 })).map((row) => row.id), ["d2", "d1"]);
  });
  test("a subscription to a different exact topic does not match, and an envelope saved later replaces the row's payload", async () => {
    const { subscriptions, deliveries } = await make();
    await subscriptions.insert({ ...subscription, id: "pages", topics: ["page.created", "post.updated"] });
    await subscriptions.insert({ ...subscription, id: "posts", topics: ["page.created", "post.created"] });
    assert.deepEqual((await subscriptions.findMatching({ workspaceId: "ws", topic: "post.created" })).map((row) => row.id), ["posts"]);

    const first: WebhookEventEnvelope = { deliveryId: "d1", eventId: "evt-d1", topic: "post.created", workspaceId: "ws", occurredAt: T0, data: { id: "p1" } };
    const replaced: WebhookEventEnvelope = { ...first, data: { id: "p1", title: "Edited" } };
    await deliveries.enqueue({ record: delivery("d1") }, { envelope: first });
    await deliveries.save({ deliveryId: "d1", envelope: replaced });
    assert.deepEqual(await deliveries.find({ deliveryId: "d1" }), replaced);
    await deliveries.save({ deliveryId: "missing", envelope: replaced });
    assert.equal(await deliveries.find({ deliveryId: "missing" }), null, "saving an envelope never creates a delivery row");
  });
  test("an unfenced failure re-enters pending without a dead stamp, a dead outcome without one keeps the stored stamp, and an unknown delivery reads as null", async () => {
    const { deliveries } = await make();
    await deliveries.enqueue({ record: delivery("d1") });
    await deliveries.enqueue({ record: { ...delivery("d2"), deadAt: "2026-11-21T00:00:00.000Z" } });
    await deliveries.claimPending({ batchSize: 5, nowIso: T0 });
    await deliveries.markFailed({ workspaceId: "ws", id: "d1", error: "timeout", responseStatus: null, nextStatus: "failed", nextAttemptAt: "2026-11-22T00:05:00.000Z" });
    const retried = await deliveries.findById({ workspaceId: "ws", id: "d1" });
    assert.deepEqual([retried?.status, retried?.lastError, retried?.lastResponseStatus, retried?.nextAttemptAt, retried?.deadAt], ["pending", "timeout", null, "2026-11-22T00:05:00.000Z", null]);
    await deliveries.markFailed({ workspaceId: "ws", id: "d2", error: "gone", responseStatus: 410, nextStatus: "dead", nextAttemptAt: T0 });
    const dead = await deliveries.findById({ workspaceId: "ws", id: "d2" });
    assert.deepEqual([dead?.status, dead?.deadAt], ["dead", "2026-11-21T00:00:00.000Z"]);
    await deliveries.markDelivered({ workspaceId: "ws", id: "d1", responseStatus: 204, deliveredAtIso: "2026-11-22T00:06:00.000Z" });
    const delivered = await deliveries.findById({ workspaceId: "ws", id: "d1" });
    assert.deepEqual([delivered?.status, delivered?.lastError, delivered?.lastResponseStatus, delivered?.deliveredAt], ["delivered", null, 204, "2026-11-22T00:06:00.000Z"]);
    assert.equal(await deliveries.findById({ workspaceId: "ws", id: "nope" }), null);
  });
});
