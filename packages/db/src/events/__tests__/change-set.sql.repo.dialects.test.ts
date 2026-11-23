import assert from "node:assert/strict";
import { afterAll, describe, test } from "vitest";
import type { ChangeSetItemRecord, ChangeSetRecord, DomainEvent } from "@jini-ai/core/contracts/events";
import { sql } from "kysely";
import type { KyselyKernel } from "../../kernel/port.js";
import { SqlChangeSetRepo } from "../change-set-repo.sql.js";
import { outboxEventValues } from "../outbox-repo.sql.js";
import { openEventsKernel, TABLES } from "./support/events-tables.fixture.js";

/**
 * @file The change-set SQL repo on every embedded dialect: column-for-column mapping with absent optionals as NULL,
 * header + items + event as one all-or-nothing transaction (the event row is the outbox module's one row builder),
 * and every read and the status write staying inside one workspace.
 */

const AT = "2026-11-18T00:00:00.000Z";
const header = (over: Partial<ChangeSetRecord> = {}): ChangeSetRecord => ({
  id: "cs-a", workspaceId: "ws-a", actorId: "user-1", actorKind: "user", status: "proposed", summary: "Renamed a post", idempotencyKey: "idem-1", intentRef: "chat-1", createdAt: AT, ...over,
});
const item = (over: Partial<ChangeSetItemRecord> = {}): ChangeSetItemRecord => ({
  id: "csi-a", changeSetId: "cs-a", entityType: "post", entityId: "post-1", operation: "update", beforeRevisionId: "rev-0", afterRevisionId: "rev-1",
  inversePayload: { title: "Old" }, entityVersionAtApply: 3, position: 0, ...over,
});
const EVENT: DomainEvent = { id: "evt-1", name: "change-set.applied", occurredAt: AT, workspaceId: "ws-a", payload: { changeSetId: "cs-a" } };

const opened: KyselyKernel<unknown>[] = [];
afterAll(async () => { for (const kernel of opened) await kernel.close(); });

describe.each(["sqlite", "postgres"] as const)("change-set sql repo [%s]", (dialect) => {
  async function make() {
    const kernel = await openEventsKernel({ dialect });
    opened.push(kernel);
    const count = async (table: string) => Number((await kernel.query<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.table(table)}`))[0]?.n);
    return { kernel, repo: new SqlChangeSetRepo({ kernel, tables: TABLES }, {}), count };
  }

  test("a populated change set round-trips through findById with its items in position order", async () => {
    const { repo } = await make();
    await repo.insert({ record: header({ appliedAt: AT, revertedAt: AT }), items: [item({ id: "csi-b", position: 1 }), item()] });
    const found = await repo.findById({ workspaceId: "ws-a", id: "cs-a" });
    assert.deepEqual(found?.changeSet, header({ appliedAt: AT, revertedAt: AT }));
    assert.deepEqual(found?.items, [item(), item({ id: "csi-b", position: 1 })]);
  });

  test("every absent optional field is stored as NULL and read back as undefined", async () => {
    const { kernel, repo } = await make();
    const bare = { id: "cs-a", workspaceId: "ws-a", status: "proposed", summary: "s", createdAt: AT } as const;
    await repo.insert({ record: bare, items: [{ id: "csi-a", changeSetId: "cs-a", entityType: "post", entityId: "p", operation: "create", position: 0 }] });
    const [stored] = await kernel.query<Record<string, unknown>>(sql`SELECT actor_id, actor_kind, idempotency_key, intent_ref, applied_at, reverted_at FROM change_sets`);
    assert.deepEqual(stored, { actor_id: null, actor_kind: null, idempotency_key: null, intent_ref: null, applied_at: null, reverted_at: null });
    const found = await repo.findById({ workspaceId: "ws-a", id: "cs-a" });
    // Absent columns come back as explicit `undefined` properties (the stored-row mapper's long-standing shape), not missing keys.
    assert.deepEqual(found?.changeSet, { ...bare, actorId: undefined, actorKind: undefined, idempotencyKey: undefined, intentRef: undefined, appliedAt: undefined, revertedAt: undefined });
    assert.deepEqual(found?.items, [{
      id: "csi-a", changeSetId: "cs-a", entityType: "post", entityId: "p", operation: "create", position: 0,
      beforeRevisionId: undefined, afterRevisionId: undefined, inversePayload: undefined, entityVersionAtApply: undefined,
    }]);
  });

  test("a change set round-trips its actor kind", async () => {
    const { kernel, repo } = await make();
    await repo.insert({ record: header({ actorId: "agent-1", actorKind: "agent" }), items: [item()] });
    const [stored] = await kernel.query<{ actor_kind: unknown }>(sql`SELECT actor_kind FROM change_sets`);
    assert.equal(stored?.actor_kind, "agent");
    assert.equal((await repo.findById({ workspaceId: "ws-a", id: "cs-a" }))?.changeSet.actorKind, "agent");
  });

  test("a change set without actor kind reads back undefined", async () => {
    const { kernel, repo } = await make();
    // A row written before the column existed: inserted directly, actor_kind left NULL.
    await kernel.execute(sql`INSERT INTO change_sets (id, workspace_id, actor_id, status, summary, created_at) VALUES ('cs-old', 'ws-a', 'user-1', 'applied', 'Old row', ${AT})`);
    const found = await repo.findById({ workspaceId: "ws-a", id: "cs-old" });
    assert.equal(found?.changeSet.actorId, "user-1");
    assert.equal(found?.changeSet.actorKind, undefined);
  });

  test("a host table not yet migrated to actor_kind still accepts change sets that carry no actor kind", async () => {
    const { kernel, repo } = await make();
    await kernel.execute(sql`ALTER TABLE change_sets DROP COLUMN actor_kind`);
    await repo.insert({ record: header({ actorKind: undefined }), items: [item()] });
    assert.deepEqual((await repo.findById({ workspaceId: "ws-a", id: "cs-a" }))?.changeSet, header({ actorKind: undefined, appliedAt: undefined, revertedAt: undefined }));
  });

  test("a supplied event lands as the one stored outbox row; no event means no outbox row", async () => {
    const { kernel, repo, count } = await make();
    await repo.insert({ record: header({ id: "cs-0", idempotencyKey: undefined }), items: [] });
    assert.equal(await count("outbox_events"), 0);
    await repo.insert({ record: header(), items: [] }, { event: EVENT });
    const [row] = await kernel.query<Record<string, unknown>>(sql`SELECT id, workspace_id, status, attempts, next_attempt_at, created_at FROM outbox_events`);
    const { event_json: _json, ...expected } = outboxEventValues(EVENT);
    assert.deepEqual({ ...row, attempts: Number(row?.attempts) }, expected);
  });

  test("a failing item write rolls back the header and the event; a failing event write rolls back header and items", async () => {
    const { repo, count } = await make();
    await assert.rejects(repo.insert({ record: header(), items: [item(), item({ position: 1 })] }, { event: EVENT }));
    assert.deepEqual([await count("change_sets"), await count("change_set_items"), await count("outbox_events")], [0, 0, 0]);
    await repo.insert({ record: header({ id: "cs-0", idempotencyKey: undefined }), items: [] }, { event: EVENT });
    await assert.rejects(repo.insert({ record: header(), items: [item()] }, { event: EVENT }));
    assert.deepEqual([await count("change_sets"), await count("change_set_items"), await count("outbox_events")], [1, 0, 1]);
  });

  test("reads answer only for their workspace; save writes status and the two timestamps of its own workspace's row only", async () => {
    const { repo } = await make();
    await repo.insert({ record: header(), items: [item()] });
    await repo.insert({ record: header({ id: "cs-b", workspaceId: "ws-b", createdAt: "2026-11-18T00:00:01.000Z" }), items: [] });
    assert.equal(await repo.findById({ workspaceId: "ws-b", id: "cs-a" }), null);
    assert.equal((await repo.findByIdempotencyKey({ workspaceId: "ws-b", idempotencyKey: "idem-1" }))?.id, "cs-b");
    assert.equal(await repo.findByIdempotencyKey({ workspaceId: "ws-c", idempotencyKey: "idem-1" }), null);
    assert.deepEqual((await repo.listByWorkspace({ workspaceId: "ws-a" })).map((record) => record.id), ["cs-a"]);
    await repo.save(header({ workspaceId: "ws-b", status: "reverted", revertedAt: AT }));
    assert.equal((await repo.findById({ workspaceId: "ws-a", id: "cs-a" }))?.changeSet.status, "proposed");
    await repo.save(header({ status: "applied", summary: "ignored", appliedAt: AT }));
    const saved = (await repo.findById({ workspaceId: "ws-a", id: "cs-a" }))?.changeSet;
    assert.deepEqual({ status: saved?.status, appliedAt: saved?.appliedAt, summary: saved?.summary }, { status: "applied", appliedAt: AT, summary: "Renamed a post" });
  });
});
