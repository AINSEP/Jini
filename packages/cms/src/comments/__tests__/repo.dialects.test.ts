import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError } from "@jini-ai/core";

import { describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { createTables, tables, tableNames } from "./support/comments-tables.fixture.js";
import type { CommentRepoPort } from "../ports.js";
import { commentRepoFor } from "../sql/index.js";
import type { CommentRecord } from "../types.js";

/**
 * @file The comments repo on every dialect through the kernel's matrix. The two `p_comments__*`
 * tables are dataModule tables, absent from the migrated schema. The source `make` ran the real
 * install (`installCommentsDataModule`, on the kernel) on each dialect; this extraction uses
 * the byte-identical domain DDL fixture instead, leaving migration composition in Tovu.
 */

const WS = "ws-dialects";

// The original per-make setup dropped the dataModule tables and ran the REAL install.
// p1's matrix now creates the same domain DDL once and resets rows per make; migration
// reconciliation itself remains covered by Tovu's data-module-install.test.ts.

function comment(id: string, overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id,
    workspaceId: WS,
    entryId: "entry-1",
    parentId: null,
    threadRootId: id,
    depth: 0,
    status: "pending",
    authorPrincipalId: null,
    authorName: "Visitor",
    authorEmail: null,
    authorUrl: null,
    authorIpHash: null,
    bodyText: "Hello",
    spamScore: 0.25,
    spamProvider: null,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
    version: 0,
    ...overrides,
  };
}

describeEachDialect<CommentRepoPort>({
  title: "comments repo",
  options: {
    tables: tableNames,
    createTables,
    make: (kernel) => commentRepoFor({ kernel, tables }, {}),
  },
  body: (makeRepo) => {
    test("create round-trips, with nulls and a real spam score", async () => {
      const repo = makeRepo();
      await repo.create({ record: comment("c1") }, {});
      assert.deepEqual(await repo.findById({ workspaceId: WS, id: "c1" }), comment("c1"));
      assert.equal(await repo.findById({ workspaceId: "other", id: "c1" }), null);
    });

    test("create with a submit log is atomic: a duplicate log id rolls the comment back", async () => {
      const repo = makeRepo();
      const log = (commentId: string) => ({
        id: "log-dup",
        workspaceId: WS,
        commentId,
        actorPrincipalId: "visitor",
        action: "submit" as const,
        fromStatus: null,
        toStatus: "pending" as const,
        at: "2026-09-28T00:00:00.000Z",
        note: null,
      });
      await repo.create({ record: comment("c1") }, { submitLog: log("c1") });
      await assert.rejects(repo.create({ record: comment("c2") }, { submitLog: log("c2") }));
      assert.equal(await repo.findById({ workspaceId: WS, id: "c2" }), null);
      assert.equal((await repo.listModerationLog({ workspaceId: WS, commentId: "c1" })).length, 1);
    });

    test("the moderation queue is keyset-paginated and countByStatus scopes by entry", async () => {
      const repo = makeRepo();
      for (let i = 0; i < 5; i += 1) {
        await repo.create({ record: comment(`c${i}`, { entryId: i < 3 ? "e1" : "e2", createdAt: `2026-09-28T00:0${i}:00.000Z` }) }, {});
      }
      for (const id of ["same-time", "same-time-2", "same-time-3"]) {
        await repo.create({ record: comment(id, { createdAt: "2026-09-28T00:04:00.000Z" }) }, {});
      }
      const page1 = await repo.listModerationQueue({ workspaceId: WS, status: "pending", limit: 2 });
      assert.deepEqual(page1.items.map((c) => c.id), ["c0", "c1"]);
      const page2 = await repo.listModerationQueue({ workspaceId: WS, status: "pending", limit: 2, cursor: page1.nextCursor });
      assert.deepEqual(page2.items.map((c) => c.id), ["c2", "c3"]);
      const page3 = await repo.listModerationQueue({ workspaceId: WS, status: "pending", limit: 2, cursor: page2.nextCursor });
      assert.deepEqual(page3.items.map((c) => c.id), ["c4", "same-time"]);
      const page4 = await repo.listModerationQueue({ workspaceId: WS, status: "pending", limit: 2, cursor: page3.nextCursor });
      assert.deepEqual(page4.items.map((c) => c.id), ["same-time-2", "same-time-3"]);
      assert.equal(page4.nextCursor, null);
      assert.deepEqual([page1, page2, page3, page4].flatMap((p) => p.items.map((c) => c.id)),
        ["c0", "c1", "c2", "c3", "c4", "same-time", "same-time-2", "same-time-3"]);
      assert.equal(await repo.countByStatus({ workspaceId: WS, status: "pending" }), 8);
      assert.equal(await repo.countByStatus({ workspaceId: WS, status: "pending", entryId: "e1" }), 3);
    });

    test("a moderation-queue page resumes after its cursor comment was purged by another moderator", async () => {
      const repo = makeRepo();
      for (let i = 0; i < 4; i += 1) await repo.create({ record: comment(`c${i}`, { createdAt: `2026-09-28T00:0${i}:00.000Z` }) }, {});
      const page1 = await repo.listModerationQueue({ workspaceId: WS, status: "pending", limit: 2 });
      assert.deepEqual(page1.items.map((c) => c.id), ["c0", "c1"]);
      assert.equal((await repo.purge({ workspaceId: WS, id: "c1", actorPrincipalId: "admin", note: null, at: "2026-09-28T01:00:00.000Z" })).ok, true);
      const page2 = await repo.listModerationQueue({ workspaceId: WS, status: "pending", limit: 2, cursor: page1.nextCursor });
      assert.deepEqual(page2.items.map((c) => c.id), ["c2", "c3"]);
      assert.equal(page2.nextCursor, null);
    });

    test("a malformed moderation-queue cursor is refused, not read as page 1", async () => {
      const repo = makeRepo();
      await repo.create({ record: comment("c1") }, {});
      await repo.create({ record: comment("other-ws", { workspaceId: "other" }) }, {});
      // A real comment id (the pre-2026-10-05 cursor format), an unknown id, a non-uuid string (no 500
      // on Postgres), a real id from another workspace, then `createdAt::id` with no id, no createdAt,
      // and a createdAt that is no date.
      const malformed = ["c1", "no-such-comment", "not a uuid ' --", "other-ws", "2026-09-28T00:00:00.000Z::", "::c1", "yesterday::c1"];
      for (const cursor of malformed) {
        await assert.rejects(
          repo.listModerationQueue({ workspaceId: WS, status: "pending", limit: 2, cursor }),
          (err: unknown) => err instanceof ToolInputError && err.message === "invalid cursor"
        );
      }
    });

    test("listThreadForEntry nests replies and an empty status list yields nothing", async () => {
      const repo = makeRepo();
      await repo.create({ record: comment("root", { status: "approved" }) }, {});
      await repo.create({ record: comment("reply", { parentId: "root", threadRootId: "root", depth: 1, status: "approved", createdAt: "2026-09-28T00:01:00.000Z" }) }, {});
      const thread = await repo.listThreadForEntry({ workspaceId: WS, entryId: "entry-1" });
      assert.deepEqual(thread.map((n) => [n.comment.id, n.replies.map((r) => r.comment.id)]), [["root", ["reply"]]]);
      assert.deepEqual(await repo.listThreadForEntry({ workspaceId: WS, entryId: "entry-1", includeStatuses: [] }), []);
    });

    test("applyModeration bumps the version once, logs it, and reports conflict and not-found", async () => {
      const repo = makeRepo();
      await repo.create({ record: comment("c1") }, {});
      const moderation = { workspaceId: WS, id: "c1", expectedVersion: 0, action: "approve" as const, toStatus: "approved" as const, actorPrincipalId: "admin", note: null, at: "2026-09-28T01:00:00.000Z" };
      const ok = await repo.applyModeration(moderation);
      assert.ok(ok.ok && ok.record.status === "approved" && ok.record.version === 1);
      assert.deepEqual(await repo.applyModeration(moderation), { ok: false, reason: "conflict", currentVersion: 1 });
      assert.deepEqual(await repo.applyModeration({ ...moderation, id: "missing" }), { ok: false, reason: "not-found" });
      const log = await repo.listModerationLog({ workspaceId: WS, commentId: "c1" });
      assert.deepEqual(log.map((entry) => [entry.action, entry.fromStatus, entry.toStatus]), [["approve", "pending", "approved"]]);
    });

    test("purge deletes the comment and keeps a purge log row", async () => {
      const repo = makeRepo();
      await repo.create({ record: comment("c1") }, {});
      const purged = await repo.purge({ workspaceId: WS, id: "c1", actorPrincipalId: "admin", note: "spam", at: "2026-09-28T02:00:00.000Z" });
      assert.ok(purged.ok);
      assert.equal(await repo.findById({ workspaceId: WS, id: "c1" }), null);
      assert.deepEqual((await repo.listModerationLog({ workspaceId: WS, commentId: "c1" })).map((e) => e.action), ["purge"]);
      assert.deepEqual(await repo.purge({ workspaceId: WS, id: "c1", actorPrincipalId: "admin", note: null, at: "2026-09-28T03:00:00.000Z" }), { ok: false, reason: "not-found" });
    });
  },
}, {});
