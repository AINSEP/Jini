import assert from "node:assert/strict";
import { afterAll, describe, test } from "vitest";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import { sql } from "kysely";
import type { KyselyKernel } from "../../kernel/port.js";
import { outboxEventValues, SqlOutboxAdapter } from "../outbox-repo.sql.js";
import { SqlChangeSetRepo } from "../change-set-repo.sql.js";
import { openEventsKernel, TABLES } from "./support/events-tables.fixture.js";

/**
 * @file The outbox SQL adapter on every embedded dialect: one query body serves SQLite and PGlite. The claim is a lease
 * of exactly the injected length, two claimers never take one row, settled rows are not revived by a late outcome and
 * `enqueue` takes part in the caller's transaction.
 */

const T0 = "2026-11-18T00:00:00.000Z";
const LEASE_MS = 90_000;
const event = (id: string): DomainEvent => ({ id, name: "post.published", occurredAt: T0, workspaceId: "ws-1", payload: { id } });
const FROZEN_JSON = '{"id":"post-1-post.published-3","name":"post.published","occurredAt":"2026-11-18T00:00:00.000Z","aggregateId":"post-1","workspaceId":"ws-1","payload":{"slug":"hello","version":3}}';

const opened: KyselyKernel<unknown>[] = [];
afterAll(async () => { for (const kernel of opened) await kernel.close(); });

test("outboxEventValues is the one stored outbox row of an event", () => {
  const frozen: DomainEvent = { id: "post-1-post.published-3", name: "post.published", occurredAt: T0, aggregateId: "post-1", workspaceId: "ws-1", payload: { slug: "hello", version: 3 } };
  assert.deepEqual(outboxEventValues(frozen), {
    id: "post-1-post.published-3", workspace_id: "ws-1", event_json: FROZEN_JSON, status: "pending", attempts: 0, next_attempt_at: T0, created_at: T0,
  });
});

describe.each(["sqlite", "postgres"] as const)("outbox sql adapter [%s]", (dialect) => {
  async function make() {
    const kernel = await openEventsKernel({ dialect });
    opened.push(kernel);
    const outbox = new SqlOutboxAdapter({ kernel, tables: TABLES, claimLeaseMs: LEASE_MS }, {});
    const rows = async () => (await kernel.query<{ id: string; status: string; attempts: number; next_attempt_at: string; last_error: string | null }>(
      sql`SELECT id, status, attempts, next_attempt_at, last_error FROM outbox_events ORDER BY id`)).map((row) => ({ ...row, attempts: Number(row.attempts) }));
    return { kernel, outbox, rows };
  }

  test("outbox JSON round trips actor and event identity together", async () => {
    const { kernel, outbox } = await make();
    const attributed: DomainEvent = { ...event("e-agent"), actorId: "agent-7", actor: { id: "agent-7", kind: "agent" }, changeSetId: "cs-1" };
    await outbox.enqueue(attributed);
    const repo = new SqlChangeSetRepo({ kernel, tables: TABLES }, {});
    const viaChangeSet: DomainEvent = { ...attributed, id: "e-system", actorId: "sys-1", actor: { id: "sys-1", kind: "system" } };
    await repo.insert({ record: { id: "cs-1", workspaceId: "ws-1", status: "applied", summary: "s", createdAt: T0 }, items: [] }, { event: viaChangeSet });
    const claimed = await outbox.claimPending({ batchSize: 5, nowIso: T0 });
    assert.deepEqual(claimed.map((row) => row.event).sort((a, b) => a.id.localeCompare(b.id)), [attributed, viaChangeSet]);
    await assert.rejects(outbox.enqueue({ ...attributed, id: "e-bad", actorId: "user-1" }), /actor/);
  });

  test("enqueue stores the pending row; a repeated id is a no-op even once delivered", async () => {
    const { outbox, rows } = await make();
    await outbox.enqueue(event("e1"));
    await outbox.claimPending({ batchSize: 1, nowIso: T0 });
    await outbox.markDelivered({ id: "e1" });
    await outbox.enqueue(event("e1"));
    assert.deepEqual(await rows(), [{ id: "e1", status: "delivered", attempts: 1, next_attempt_at: new Date(Date.parse(T0) + LEASE_MS).toISOString(), last_error: null }]);
  });

  test("a claim stores a lease of exactly now + claimLeaseMs, returns the due time, and a live lease is not re-claimable", async () => {
    const { outbox, rows } = await make();
    await outbox.enqueue(event("e1"));
    const [claimed] = await outbox.claimPending({ batchSize: 5, nowIso: T0 });
    assert.deepEqual(claimed, { id: "e1", event: event("e1"), status: "processing", attempts: 1, nextAttemptAt: T0, lastError: undefined, createdAt: T0 });
    assert.equal((await rows())[0]?.next_attempt_at, "2026-11-18T00:01:30.000Z");
    assert.deepEqual(await outbox.claimPending({ batchSize: 5, nowIso: "2026-11-18T00:01:29.999Z" }), [], "inside the lease");
    const [again] = await outbox.claimPending({ batchSize: 5, nowIso: "2026-11-18T00:01:30.000Z" });
    assert.equal(again?.attempts, 2, "an expired lease is claimable again");
  });

  test("concurrent claimers take disjoint events and respect batchSize and due time", async () => {
    const { outbox } = await make();
    for (let i = 1; i <= 6; i += 1) await outbox.enqueue(event(`e${i}`));
    await outbox.enqueue({ ...event("future"), occurredAt: "2027-01-01T00:00:00.000Z" });
    const claims = await Promise.all([1, 2, 3].map(() => outbox.claimPending({ batchSize: 2, nowIso: T0 })));
    const ids = claims.flat().map((record) => record.id);
    assert.equal(ids.length, 6);
    assert.equal(new Set(ids).size, 6, "no event claimed twice");
    assert.ok(!ids.includes("future"));
  });

  test("markFailed persists the caller's status, error and retry time; markDelivered only the status", async () => {
    const { outbox, rows } = await make();
    await outbox.enqueue(event("e1"));
    await outbox.enqueue(event("e2"));
    await outbox.claimPending({ batchSize: 5, nowIso: T0 });
    await outbox.markFailed({ id: "e1", error: "boom", nextAttemptAt: "2026-11-18T00:05:00.000Z", nextStatus: "pending" });
    await outbox.markDelivered({ id: "e2" });
    assert.deepEqual(await rows(), [
      { id: "e1", status: "pending", attempts: 1, next_attempt_at: "2026-11-18T00:05:00.000Z", last_error: "boom" },
      { id: "e2", status: "delivered", attempts: 1, next_attempt_at: "2026-11-18T00:01:30.000Z", last_error: null },
    ]);
  });

  test("a failed or delivered row is not revived by a late outcome; an unknown id changes nothing", async () => {
    const { outbox, rows } = await make();
    await outbox.enqueue(event("e1"));
    await outbox.enqueue(event("e2"));
    await outbox.claimPending({ batchSize: 5, nowIso: T0 });
    await outbox.markFailed({ id: "e1", error: "sealed", nextAttemptAt: T0, nextStatus: "failed" });
    await outbox.markDelivered({ id: "e2" });
    const settled = await rows();
    await outbox.markFailed({ id: "e1", error: "late", nextAttemptAt: "2030-01-01T00:00:00.000Z", nextStatus: "pending" });
    await outbox.markFailed({ id: "e2", error: "late", nextAttemptAt: "2030-01-01T00:00:00.000Z", nextStatus: "pending" });
    await outbox.markDelivered({ id: "e1" });
    await outbox.markDelivered({ id: "missing" });
    assert.deepEqual(await rows(), settled);
  });

  test("enqueue inside a transaction that throws leaves no row; one that commits leaves it", async () => {
    const { kernel, outbox, rows } = await make();
    await assert.rejects(kernel.transaction(async () => { await outbox.enqueue(event("rolled-back")); throw new Error("caller failed"); }), /caller failed/);
    assert.deepEqual(await rows(), []);
    await kernel.transaction(async () => outbox.enqueue(event("committed")));
    assert.deepEqual((await rows()).map((row) => row.id), ["committed"]);
  });
});
