import assert from "node:assert/strict";
import { test } from "vitest";

import { type ContentKernel, describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { SqlContentTypeRepo } from "../sql/index.js";
import type { ContentTypeRevisionTableRow } from "../sql/index.js";
import type { ContentTypeRecord } from "../types.js";
import type { ContentTypeRevisionInput } from "../write-service.js";
import { CONTENT_TYPE_TABLES, createTables } from "./support/content-type-tables.fixture.js";

/**
 * @file The content-type SQL repo on every dialect through the kernel's matrix: one query body serves SQLite and
 * PGlite. Covers save (insert, full replace, tombstone clearing), the workspace-scoped reads, both revision payloads,
 * the envelope-owner rule driven by the data the host passes, and the transaction.
 */

const WS = "ws-dialects";
const OWNERS = { widget: "widget", widget_area: "widgets" } as const;

function contentType(key: string, overrides: Partial<ContentTypeRecord> = {}): ContentTypeRecord {
  return {
    workspaceId: WS,
    key,
    label: `Label ${key}`,
    fields: [{ name: "servings", kind: "integer", required: false, queryable: true }],
    status: "active",
    version: 1,
    tombstonedAt: null,
    ...overrides,
  };
}

function revisionInput(overrides: Partial<ContentTypeRevisionInput> = {}): ContentTypeRevisionInput {
  return {
    contentTypeKey: "recipe",
    workspaceId: WS,
    op: "register",
    stateJson: contentType("recipe"),
    actorId: "a",
    principalKind: null,
    delegatedByWorkspaceId: null,
    delegatedById: null,
    recordedAt: "2026-09-28T00:00:00.000Z",
    ...overrides,
  };
}

interface Bundle { kernel: ContentKernel; repo: SqlContentTypeRepo }

function bundleFor(kernel: ContentKernel): Bundle {
  return { kernel, repo: new SqlContentTypeRepo({ kernel, tables: CONTENT_TYPE_TABLES, declaredOwners: OWNERS }, {}) };
}

type Views = Record<string, ContentTypeRevisionTableRow>;

describeEachDialect<Bundle>({ title: "content-type repo", options: { tables: ["content_types", "content_type_revisions"], createTables, make: bundleFor }, body: (make) => {
  test("save inserts, then a second save fully replaces the row", async () => {
    const { repo } = make();
    await repo.save(contentType("recipe"));
    assert.deepEqual(await repo.findByKey({ workspaceId: WS, key: "recipe" }), contentType("recipe"));
    const replaced = contentType("recipe", { label: "Changed", fields: [], version: 2, tombstonedAt: "2026-09-28T00:00:00.000Z" });
    await repo.save(replaced);
    assert.deepEqual(await repo.findByKey({ workspaceId: WS, key: "recipe" }), replaced);
    assert.equal((await repo.listByWorkspace({ workspaceId: WS })).length, 1);
  });

  test("saving a legacy record with no tombstone marker clears the previous marker to NULL", async () => {
    const { repo } = make();
    await repo.save(contentType("recipe", { status: "tombstone", tombstonedAt: "2026-09-28T00:00:00.000Z" }));
    const { tombstonedAt: _omitted, ...legacy } = contentType("recipe", { version: 2 });
    await repo.save(legacy);
    assert.deepEqual(await repo.findByKey({ workspaceId: WS, key: "recipe" }), contentType("recipe", { version: 2, tombstonedAt: null }));
  });

  test("findByKey misses an unknown key and another workspace's row", async () => {
    const { repo } = make();
    await repo.save(contentType("recipe"));
    assert.equal(await repo.findByKey({ workspaceId: WS, key: "nope" }), null);
    assert.equal(await repo.findByKey({ workspaceId: "other-ws", key: "recipe" }), null);
  });

  test("listByWorkspace returns only that workspace's rows", async () => {
    const { repo } = make();
    await repo.save(contentType("a"));
    await repo.save(contentType("b"));
    await repo.save(contentType("a", { workspaceId: "other-ws" }));
    assert.deepEqual((await repo.listByWorkspace({ workspaceId: WS })).map((row) => row.key).sort(), ["a", "b"]);
    assert.deepEqual(await repo.listByWorkspace({ workspaceId: "empty-ws" }), []);
  });

  test("appendRevision persists both complete payloads", async () => {
    const { repo, kernel } = make();
    const revision = revisionInput();
    const changed = revisionInput({ op: "field-change", stateJson: contentType("recipe", { fields: [], version: 2 }), actorId: "b", principalKind: "agent", delegatedByWorkspaceId: "delegate-ws", delegatedById: "delegate-actor", recordedAt: "2026-09-29T00:00:00.000Z" });
    await repo.appendRevision(revision);
    await repo.appendRevision(changed);
    const rows = await kernel.run((db) => db.withTables<Views>().selectFrom(CONTENT_TYPE_TABLES.revisions).selectAll().orderBy("seq").execute());
    assert.deepEqual(rows.map((row) => ({
      contentTypeKey: row.content_type_key,
      workspaceId: row.workspace_id,
      op: row.op,
      stateJson: JSON.parse(row.state_json),
      actorId: row.actor_id,
      principalKind: row.principal_kind,
      delegatedByWorkspaceId: row.delegated_by_workspace_id,
      delegatedById: row.delegated_by_id,
      recordedAt: row.recorded_at,
    })), [revision, changed]);
  });

  test("the declared types read back carrying their envelope owner; every other type carries none", async () => {
    const { repo } = make();
    await repo.save(contentType("widget", { owner: "widget" }));
    await repo.save(contentType("widget_area", { owner: "widgets" }));
    await repo.save(contentType("recipe"));
    assert.equal((await repo.findByKey({ workspaceId: WS, key: "widget" }))?.owner, "widget");
    assert.equal((await repo.findByKey({ workspaceId: WS, key: "widget_area" }))?.owner, "widgets");
    assert.deepEqual(await repo.findByKey({ workspaceId: WS, key: "recipe" }), contentType("recipe"), "no owner key at all");
    assert.equal((await repo.listByWorkspace({ workspaceId: WS })).find((row) => row.key === "widget")?.owner, "widget");
  });

  test("saving an owner the host did not declare is refused, never silently dropped", async () => {
    const { repo } = make();
    await assert.rejects(
      repo.save(contentType("recipe", { owner: "widget" })),
      { message: "content type 'recipe' declares owner 'widget', but only these code-declared owners can be stored: widget=widget, widget_area=widgets" },
    );
    assert.equal(await repo.findByKey({ workspaceId: WS, key: "recipe" }), null);
  });

  test("a host that declares no owners stores only unowned types; a key named like an Object member has no owner", async () => {
    const { kernel } = make();
    const bare = new SqlContentTypeRepo({ kernel, tables: CONTENT_TYPE_TABLES, declaredOwners: {} }, {});
    await assert.rejects(bare.save(contentType("widget", { owner: "widget" })), /only these code-declared owners can be stored: $/);
    for (const key of ["constructor", "toString"]) {
      await bare.save(contentType(key));
      assert.equal("owner" in ((await bare.findByKey({ workspaceId: WS, key })) ?? {}), false, key);
    }
  });

  test("a transaction's save + appendRevision roll back together; a nested one joins", async () => {
    const { repo, kernel } = make();
    await assert.rejects(
      repo.transaction({ fn: async () => {
        await repo.save(contentType("t1"));
        await repo.transaction({ fn: async () => {
          await repo.appendRevision(revisionInput({ contentTypeKey: "t1", stateJson: contentType("t1") }));
        } });
        throw new Error("boom");
      } }),
      /boom/,
    );
    assert.equal(await repo.findByKey({ workspaceId: WS, key: "t1" }), null);
    assert.deepEqual(await kernel.run((db) => db.withTables<Views>().selectFrom(CONTENT_TYPE_TABLES.revisions).selectAll().execute()), []);
  });
} });
