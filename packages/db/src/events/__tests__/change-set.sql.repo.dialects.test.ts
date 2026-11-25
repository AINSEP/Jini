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
  id: "cs-a", workspaceId: "ws-a", actorId: "user-1", status: "proposed", summary: "Renamed a post", idempotencyKey: "idem-1", intentRef: "chat-1", createdAt: AT, ...over,
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
    const [stored] = await kernel.query<Record<string, unknown>>(sql`SELECT actor_id, idempotency_key, intent_ref, applied_at, reverted_at FROM change_sets`);
    assert.deepEqual(stored, { actor_id: null, idempotency_key: null, intent_ref: null, applied_at: null, reverted_at: null });
    const found = await repo.findById({ workspaceId: "ws-a", id: "cs-a" });
    // Absent columns come back as explicit `undefined` properties (the stored-row mapper's long-standing shape), not missing keys.
    assert.deepEqual(found?.changeSet, { ...bare, actorId: undefined, idempotencyKey: undefined, intentRef: undefined, appliedAt: undefined, revertedAt: undefined });
    assert.deepEqual(found?.items, [{
      id: "csi-a", changeSetId: "cs-a", entityType: "post", entityId: "p", operation: "create", position: 0,
      beforeRevisionId: undefined, afterRevisionId: undefined, inversePayload: undefined, entityVersionAtApply: undefined,
    }]);
  });

  async function makeMigrated() {
    const kernel = await openEventsKernel({ dialect }, { actorKindColumn: true });
    opened.push(kernel);
    return { kernel, repo: new SqlChangeSetRepo({ kernel, tables: TABLES }, { actorKindColumn: true }) };
  }
  const AGENT = { id: "agent-7", kind: "agent" } as const;

  test("a legacy row keeps its actor id without inventing kind", async () => {
    const migrated = await makeMigrated();
    await migrated.kernel.execute(sql`INSERT INTO change_sets (id, workspace_id, actor_id, status, summary, created_at) VALUES ('cs-old', 'ws-a', 'user-1', 'applied', 's', ${AT})`);
    const found = await migrated.repo.findById({ workspaceId: "ws-a", id: "cs-old" });
    assert.equal(found?.changeSet.actorId, "user-1");
    assert.equal(found?.changeSet.actor, undefined);
    const legacy = await make();
    await legacy.repo.insert({ record: header({ actor: AGENT, actorId: AGENT.id }), items: [] });
    const [stored] = await legacy.kernel.query<Record<string, unknown>>(sql`SELECT * FROM change_sets`);
    assert.equal("actor_kind" in (stored ?? {}), false);
    const read = await legacy.repo.findById({ workspaceId: "ws-a", id: "cs-a" });
    assert.deepEqual([read?.changeSet.actorId, read?.changeSet.actor], ["agent-7", undefined]);
  });

  test("a migrated host round-trips the actor kind; an unknown stored kind stays unknown", async () => {
    const { kernel, repo } = await makeMigrated();
    const attributed = header({ actor: AGENT, actorId: AGENT.id, appliedAt: AT, revertedAt: AT });
    await repo.insert({ record: attributed, items: [] });
    assert.deepEqual((await repo.findById({ workspaceId: "ws-a", id: "cs-a" }))?.changeSet, attributed);
    await kernel.execute(sql`UPDATE change_sets SET actor_kind = 'robot'`);
    assert.equal((await repo.findById({ workspaceId: "ws-a", id: "cs-a" }))?.changeSet.actor, undefined);
  });

  test("a record whose actor id disagrees with its actor is refused before anything is written", async () => {
    const { kernel, repo } = await makeMigrated();
    await assert.rejects(repo.insert({ record: header({ actor: AGENT, actorId: "user-1" }), items: [] }), /actor/);
    await assert.rejects(repo.insert({ record: header({ idempotencyKey: undefined }), items: [] }, { event: { ...EVENT, actor: AGENT, actorId: "user-1" } }), /actor/);
    assert.deepEqual(await kernel.query(sql`SELECT id FROM change_sets`), []);
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
