import assert from "node:assert/strict";
import { test } from "vitest";

import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

import { describeEachDialect } from "../../../core/__tests__/support/dialect-matrix.js";
import { createTables } from "../../__tests__/support/workspaces-table.fixture.js";
import { SqliteWorkspaceRepo, WORKSPACE_TABLES } from "../repo.sqlite.js";

/**
 * @file S1w T0: the workspace repo's behaviour on the unmoved code, before its query body moved to Jini
 * `@jini-ai/cms/workspace/sql`. Each test names the one-line mutation of `repo.ts` that turns it red; the
 * run's report holds the red output of each. Real kernels from the dialect matrix, reached through the
 * injected `kernelFor` exactly as the host's composition root reaches its own content kernel.
 */

const ACME = { id: "ws-1", name: "Acme", slug: "acme", createdAt: "2026-07-15T00:00:00.000Z", version: 1 };

function workspace(id: string) {
  return { id, name: id, slug: `slug-${id}`, createdAt: "2026-07-15T00:00:00.000Z", version: 1 };
}

/** The host hands its own handle; the fake host "eraser" records which handle it was given. */
type Kernel = StorageKernel<never, unknown>;
const erased: unknown[] = [];
function siteRepo(kernel: Kernel): SqliteWorkspaceRepo<{ handle: Kernel }> {
  return new SqliteWorkspaceRepo({ store: { handle: kernel }, kernelFor: ({ store }) => { erased.push(store); return store.handle as never; } });
}

test("the site profile persists into the 'workspaces' table", () => {
  assert.deepEqual(WORKSPACE_TABLES, { workspaces: "workspaces" });
});

describeEachDialect<SqliteWorkspaceRepo<{ handle: Kernel }>>(
  { title: "site sqlite workspace repo", options: { tables: ["workspaces"], createTables, make: (kernel) => siteRepo(kernel as unknown as Kernel) }, body: (makeRepo) => {
    test("kernelFor receives the host's own handle as `store`", () => {
      erased.length = 0;
      makeRepo();
      assert.equal(erased.length, 1);
      assert.ok((erased[0] as { handle: unknown }).handle, "the host handle reached kernelFor unchanged");
    });

    test("a stale expectedVersion is refused and leaves the row; without expectedVersion the last write wins", async () => {
      const repo = makeRepo();
      await repo.insert(ACME);
      await repo.update({ ...ACME, name: "First", version: 2 }, { expectedVersion: 1 });
      await assert.rejects(
        repo.update({ ...ACME, name: "Stale", version: 2 }, { expectedVersion: 1 }),
        (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2,
      );
      assert.equal((await repo.findById({ id: ACME.id }))?.name, "First");
      await repo.update({ ...ACME, name: "Last write", version: 9 });
      assert.deepEqual(await repo.findById({ id: ACME.id }), { ...ACME, name: "Last write", version: 9 });
    });

    test("findBySlug matches the slug exactly and returns null for an unknown one", async () => {
      const repo = makeRepo();
      await repo.insert(workspace("a"));
      await repo.insert(workspace("b"));
      assert.equal((await repo.findBySlug({ slug: "slug-a" }))?.id, "a");
      assert.equal((await repo.findBySlug({ slug: "slug-b" }))?.id, "b");
      assert.equal(await repo.findBySlug({ slug: "slug" }), null);
      assert.equal(await repo.findBySlug({ slug: "slug-c" }), null);
    });

    test("list returns the rows in storage (insertion) order: the query has no ORDER BY today", async () => {
      const repo = makeRepo();
      for (const id of ["ws-b", "ws-a", "ws-c"]) await repo.insert(workspace(id));
      assert.deepEqual((await repo.list()).map((row) => row.id), ["ws-b", "ws-a", "ws-c"]);
    });
  } },
);

test("the roster lock is the first thing taken inside the transaction, before the callback's statements", async () => {
  const keys: string[] = [];
  const kernel = {
    dialect: "sqlite", transport: "fake",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async () => { throw new Error("no statement is expected in this test"); },
    transaction: async (fn: () => Promise<unknown>) => fn(),
    lockKey: async (key: string) => { keys.push(key); },
    inTransaction: () => true, require: () => undefined, backupTo: async () => undefined, close: async () => undefined,
  } as unknown as Kernel;
  const repo = siteRepo(kernel);
  await repo.transaction({ fn: async () => { keys.push("callback"); } });
  assert.deepEqual(keys, ["workspace:roster", "callback"]);
});
