import assert from "node:assert/strict";
import { test } from "vitest";

import { describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import type { WorkspaceRecord } from "../create.js";
import { type SqlWorkspaceRepo, workspaceRepoFor } from "../sql/repo.js";
import { createTables } from "./support/workspaces-table.fixture.js";

/**
 * @file The workspace SQL repo on every dialect through the kernel's matrix: one query body serves SQLite and
 * PGlite. Covers the seven port methods, the optimistic `expectedVersion` branch of `update`, and the roster
 * transaction.
 */

const ACME: WorkspaceRecord = { id: "ws-1", name: "Acme", slug: "acme", createdAt: "2026-07-15T00:00:00.000Z", version: 1 };
const GLOBEX: WorkspaceRecord = { id: "ws-2", name: "Globex", slug: "globex", createdAt: "2026-07-15T00:00:01.000Z", version: 1 };

describeEachDialect<SqlWorkspaceRepo>(
  { title: "workspace sql repo", options: {
    tables: ["workspaces"], createTables,
    make: (kernel) => workspaceRepoFor({ kernel, tables: { workspaces: "workspaces" } }, {}),
  }, body: (makeRepo) => {
    test("insert, find by id and slug, list", async () => {
      const repo = makeRepo();
      await repo.insert(ACME);
      await repo.insert(GLOBEX);
      assert.deepEqual(await repo.findById({ id: "ws-1" }), ACME);
      assert.deepEqual(await repo.findBySlug({ slug: "globex" }), GLOBEX);
      assert.equal(await repo.findBySlug({ slug: "ws-1" }), null);
      assert.equal(await repo.findById({ id: "nope" }), null);
      assert.deepEqual((await repo.list()).map((w) => w.id).sort(), ["ws-1", "ws-2"]);
    });

    test("transaction returns the callback's value, commits its writes, and rolls them back when it throws", async () => {
      const repo = makeRepo();
      const run = repo.transaction.bind(repo);
      assert.equal(await run({ fn: async () => { await repo.insert(ACME); return "done"; } }), "done");
      await assert.rejects(run({ fn: async () => { await repo.insert(GLOBEX); throw new Error("abort roster change"); } }), /abort roster change/);
      assert.deepEqual((await repo.list()).map((w) => w.id), ["ws-1"]);
    });

    test("update and delete touch only the targeted row; createdAt is never rewritten", async () => {
      const repo = makeRepo();
      await repo.insert(ACME);
      await repo.insert(GLOBEX);
      await repo.update({ ...ACME, name: "Acme 2", slug: "acme-2", createdAt: "ignored" });
      assert.deepEqual(await repo.findById({ id: "ws-1" }), { ...ACME, name: "Acme 2", slug: "acme-2" });
      await repo.delete({ id: "ws-1" });
      assert.equal(await repo.findById({ id: "ws-1" }), null);
      assert.deepEqual(await repo.findById({ id: "ws-2" }), GLOBEX);
    });

    test("update with a stale expectedVersion throws and leaves the row; without one the last write wins", async () => {
      const repo = makeRepo();
      await repo.insert(ACME);
      await repo.update({ ...ACME, name: "First", version: 2 }, { expectedVersion: 1 });
      await assert.rejects(repo.update({ ...ACME, name: "Stale", version: 2 }, { expectedVersion: 1 }));
      assert.equal((await repo.findById({ id: "ws-1" }))?.name, "First");
      await repo.update({ ...ACME, name: "Last write", version: 7 });
      assert.deepEqual(await repo.findById({ id: "ws-1" }), { ...ACME, name: "Last write", version: 7 });
    });

    test("a duplicate slug is rejected by the database", async () => {
      const repo = makeRepo();
      await repo.insert(ACME);
      await assert.rejects(repo.insert({ ...GLOBEX, slug: "acme" }));
      assert.equal((await repo.list()).length, 1);
    });
  },
}, {});
