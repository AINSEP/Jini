/**
 * @file The comments half of the local admin Trash
 * (`ADS-memory/reports/2026-09-20-trash-delete-architecture.md`).
 *
 * Comments are the awkward domain: "trash" is one value of a general moderation status machine, not
 * a delete-only path, so the index write has to key off the TRANSITION rather than off the target
 * status. These tests pin both directions, because getting only the entry side right is what
 * strands an index row pointing at a comment that is live again.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { SqlCommentRepo as SqliteCommentRepo, commentRepoFor } from "../sql/index.js";
import { eachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { createTables, tables, tableNames } from "./support/comments-tables.fixture.js";

import { InMemoryOutbox } from "../../redirects/__tests__/support/events.fixture.js";
import { createCommentHookRegistry } from "../hooks.js";
import { InMemoryCommentRepo } from "../repo.memory.js";
import { createCommentWriteService } from "../write-service.js";
import type { CommentRecord } from "../types.js";

const WORKSPACE_ID = "workspace-1";
const NOW = "2026-07-16T01:00:00.000Z";

function makeComment(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id: "comment-1",
    workspaceId: WORKSPACE_ID,
    entryId: "entry-1",
    parentId: null,
    threadRootId: "comment-1",
    depth: 0,
    status: "pending",
    authorPrincipalId: null,
    authorName: "Visitor",
    authorEmail: null,
    authorUrl: null,
    authorIpHash: null,
    bodyText: "hello",
    spamScore: null,
    spamProvider: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    version: 0,
    ...overrides,
  };
}

interface RemoveCall {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}

function makeService(options: { removeFails?: "not-found" | "version-changed"; repo?: InMemoryCommentRepo | SqliteCommentRepo; transaction?: <T>(fn: () => Promise<T>) => Promise<T> } = {}) {
  const repo = options.repo ?? new InMemoryCommentRepo();
  const outbox = new InMemoryOutbox();
  const hooks = createCommentHookRegistry();
  const removeCalls: RemoveCall[] = [];
  const forgetCalls: { workspaceId: string; id: string }[] = [];
  /** Records the nesting so a test can prove both writes happened inside ONE transaction. */
  const trace: string[] = [];

  const service = createCommentWriteService({
    repo,
    outbox,
    hooks,
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => "event-1" },
    remove: async (required) => {
      trace.push("remove");
      removeCalls.push(required as RemoveCall);
      if (options.removeFails) return { ok: false, reason: options.removeFails };
      return { ok: true, version: required.expectedVersion };
    },
    forgetRemoved: async (required) => {
      trace.push("forget");
      forgetCalls.push(required);
    },
    runInTransaction: async (fn) => {
      trace.push("begin");
      try {
        const result = await (options.transaction ? options.transaction(fn) : fn());
        trace.push("commit");
        return result;
      } catch (error) {
        trace.push("rollback");
        throw error;
      }
    },
  });

  return { repo, outbox, hooks, service, removeCalls, forgetCalls, trace };
}

test("moderating a comment INTO trash routes the removal through the injected remove, inside the transaction", async () => {
  const { repo, service, removeCalls, trace } = makeService();
  await repo.create({ record: makeComment() }, {});

  const result = await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 0,
    action: "trash",
    toStatus: "trash",
    actorPrincipalId: "principal-1",
    note: null,
  });

  assert.equal(result.ok, true);
  assert.equal(removeCalls.length, 1, "the trash transition did not reach the injected remove");
  assert.ok(removeCalls[0]);
  assert.equal(removeCalls[0].workspaceId, WORKSPACE_ID);
  assert.equal(removeCalls[0].id, "comment-1");
  assert.equal(removeCalls[0].at, NOW);
  assert.equal(removeCalls[0].actor.principalId, "principal-1");
  // The display snapshot comes from columns the moderation write already returned — no second read
  // and no payload parse, which is the whole point of the display snapshot (design §1.3).
  assert.equal(removeCalls[0].display.title, "Comment on entry-1");
  assert.equal(removeCalls[0].display.subtitle, "hello");
  // The version AFTER the flip: that is what the sweeper's compare-and-delete later checks.
  assert.equal(removeCalls[0].expectedVersion, 1);
  assert.deepEqual(trace, ["begin", "remove", "commit"]);
});

test("re-trashing an already-trashed comment does NOT index it a second time", async () => {
  const { repo, service, removeCalls } = makeService();
  await repo.create({ record: makeComment({ status: "trash", version: 3 }) }, {});

  const result = await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 3,
    action: "trash",
    toStatus: "trash",
    actorPrincipalId: "principal-1",
    note: null,
  });

  assert.equal(result.ok, true);
  assert.equal(removeCalls.length, 0, "a trash -> trash moderation re-indexed an item already in the Trash");
});

test("moderating a comment OUT of trash forgets its index row, so the Trash cannot show a live comment", async () => {
  const { repo, service, removeCalls, forgetCalls, trace } = makeService();
  await repo.create({ record: makeComment({ status: "trash", version: 2 }) }, {});

  const result = await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 2,
    action: "approve",
    toStatus: "approved",
    actorPrincipalId: "principal-1",
    note: null,
  });

  assert.equal(result.ok, true);
  assert.equal(removeCalls.length, 0);
  assert.deepEqual(forgetCalls, [{ workspaceId: WORKSPACE_ID, id: "comment-1" }]);
  assert.deepEqual(trace, ["begin", "forget", "commit"]);
});

test("an ordinary moderation that never touches trash touches neither side of the index", async () => {
  const { repo, service, removeCalls, forgetCalls } = makeService();
  await repo.create({ record: makeComment() }, {});

  await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 0,
    action: "approve",
    toStatus: "approved",
    actorPrincipalId: "principal-1",
    note: null,
  });

  assert.equal(removeCalls.length, 0);
  assert.equal(forgetCalls.length, 0);
});

for (const adapter of eachDialect({
  tables: tableNames,
  createTables,
  make: (kernel) => ({ kernel, repo: commentRepoFor({ kernel, tables }, {}) }),
}, {})) {
  test(`[${adapter.name}] a failed index write rolls the moderation back rather than leaving a hidden comment with no Trash row`, async () => {
    const { kernel, repo: sqlRepo } = adapter.make();
    // The fixture rejects on any DDL failure instead of returning declareDataModule's tagged error.
    const declared = await kernel.ready.then(() => ({ ok: true }));
    assert.equal(declared.ok, true);
    const { repo, service, trace } = makeService({ removeFails: "version-changed", repo: sqlRepo, transaction: (fn) => kernel.transaction(fn) });
    await repo.create({ record: makeComment() }, {});

    await assert.rejects(
      () =>
        service.applyModeration({
          workspaceId: WORKSPACE_ID,
          id: "comment-1",
          expectedVersion: 0,
          action: "trash",
          toStatus: "trash",
          actorPrincipalId: "principal-1",
          note: null,
        }),
      /comment-1/
    );

    assert.deepEqual(trace, ["begin", "remove", "rollback"]);
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: "comment-1" }), makeComment());
    assert.deepEqual(await repo.listModerationLog({ workspaceId: WORKSPACE_ID, commentId: "comment-1" }), []);
  });
}

test("a conflicted moderation never reaches the index at all", async () => {
  const { repo, service, removeCalls, forgetCalls } = makeService();
  await repo.create({ record: makeComment({ version: 5 }) }, {});

  const result = await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 0,
    action: "trash",
    toStatus: "trash",
    actorPrincipalId: "principal-1",
    note: null,
  });

  assert.equal(result.ok, false);
  assert.equal(removeCalls.length, 0);
  assert.equal(forgetCalls.length, 0);
});
