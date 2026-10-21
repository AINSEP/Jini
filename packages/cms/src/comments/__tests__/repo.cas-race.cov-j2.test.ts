import assert from "node:assert/strict";
import { test } from "vitest";

import type { StorageKernel } from "@jini-ai/db/kernel";

import { describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { createTables, tables, tableNames } from "./support/comments-tables.fixture.js";
import { SqlCommentRepo } from "../sql/index.js";
import type { CommentTables } from "../sql/index.js";
import type { CommentRecord } from "../types.js";

/**
 * @file `SqlCommentRepo.applyModeration`'s compare-and-set arm on both dialects. The per-row lock
 * serialises every `applyModeration`, so the CAS `UPDATE ... WHERE version = expected` only misses
 * when a writer that does NOT take that lock bumps the row between the locked read and the update.
 * The kernel below is the real one, with exactly that unlocked write interleaved once.
 */

const WS = "ws-cas";

function comment(id: string): CommentRecord {
  return {
    id, workspaceId: WS, entryId: "entry-1", parentId: null, threadRootId: id, depth: 0, status: "pending",
    authorPrincipalId: null, authorName: "Visitor", authorEmail: null, authorUrl: null, authorIpHash: null,
    bodyText: "Hello", spamScore: 0, spamProvider: null,
    createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z", version: 0,
  };
}

/** The real kernel, plus one armed write that runs just before the Nth subsequent `run` call. */
function withInterleavedWrite(kernel: StorageKernel<unknown>) {
  let pending: { beforeRun: number; write: () => Promise<unknown> } | null = null;
  let runs = 0;
  const racing: StorageKernel<unknown> = {
    ...kernel,
    run: async (fn) => {
      runs += 1;
      if (pending && runs === pending.beforeRun) {
        const { write } = pending;
        pending = null;
        await write();
      }
      return kernel.run(fn);
    },
  };
  const arm = (beforeRun: number, write: () => Promise<unknown>) => { runs = 0; pending = { beforeRun, write }; };
  const bumpVersion = (id: string) => kernel.run((db) =>
    db.withTables<CommentTables>()
      .updateTable(tables.comments)
      .set((eb) => ({ version: eb("version", "+", 1) }))
      .where("workspace_id", "=", WS)
      .where("id", "=", id)
      .execute());
  const deleteRow = (id: string) => kernel.run((db) =>
    db.withTables<CommentTables>()
      .deleteFrom(tables.comments)
      .where("workspace_id", "=", WS)
      .where("id", "=", id)
      .execute());
  return { racing, arm, bumpVersion, deleteRow };
}

describeEachDialect({
  title: "comments sql repo CAS",
  options: {
    tables: tableNames,
    createTables,
    make: (kernel) => {
      const harness = withInterleavedWrite(kernel);
      return { ...harness, repo: new SqlCommentRepo({ kernel: harness.racing, tables }) };
    },
  },
  body: (make) => {
    test("an unlocked write landing between the locked read and the update is reported as a conflict at its version", async () => {
      const { repo, arm, bumpVersion } = make();
      await repo.create({ record: comment("c1") }, {});

      // run #1 is the locked findById (sees version 0); the unlocked bump lands before run #2, the CAS update.
      arm(2, () => bumpVersion("c1"));
      const result = await repo.applyModeration({
        workspaceId: WS, id: "c1", expectedVersion: 0, action: "approve", toStatus: "approved",
        actorPrincipalId: "admin-1", note: null, at: "2026-09-28T01:00:00.000Z",
      });

      assert.deepEqual(result, { ok: false, reason: "conflict", currentVersion: 1 });
      const stored = await repo.findById({ workspaceId: WS, id: "c1" });
      assert.equal(stored?.status, "pending", "the missed CAS must not change the status");
      assert.equal(stored?.version, 1);
      assert.deepEqual(await repo.listModerationLog({ workspaceId: WS, commentId: "c1" }), [], "no log row for a write that did not land");
    });

    test("a row deleted by an unlocked writer before the update is a conflict with no current version", async () => {
      const { repo, arm, deleteRow } = make();
      await repo.create({ record: comment("c2") }, {});

      arm(2, () => deleteRow("c2"));
      const result = await repo.applyModeration({
        workspaceId: WS, id: "c2", expectedVersion: 0, action: "mark_spam", toStatus: "spam",
        actorPrincipalId: "admin-1", note: null, at: "2026-09-28T01:00:00.000Z",
      });

      assert.deepEqual(result, { ok: false, reason: "conflict", currentVersion: undefined });
      assert.equal(await repo.findById({ workspaceId: WS, id: "c2" }), null);
    });

    test("countByStatus over zero matching rows is 0: the COUNT aggregate row is always present", async () => {
      const { repo } = make();
      assert.equal(await repo.countByStatus({ workspaceId: WS, status: "approved" }), 0);
      assert.equal(await repo.countByStatus({ workspaceId: WS, status: "pending", entryId: "no-such-entry" }), 0);
    });
  },
});
