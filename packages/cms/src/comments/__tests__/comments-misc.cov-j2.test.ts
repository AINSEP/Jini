import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryOutbox } from "../../redirects/__tests__/support/events.fixture.js";
import { createCommentHookRegistry } from "../hooks.js";
import { InMemoryCommentRepo } from "../repo.memory.js";
import { createCommentWriteService } from "../write-service.js";
import type { CommentRecord } from "../types.js";
import { commentTrashDoubles } from "./comment-trash-doubles.js";

/** @file Remaining comment-domain contracts: swallowed status hooks, the memory repo's upsert,
 * and purge racing a concurrent insert. */

const WS = "ws-misc";
const NOW = "2026-07-16T01:00:00.000Z";

function comment(id: string, overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id, workspaceId: WS, entryId: "entry-1", parentId: null, threadRootId: id, depth: 0, status: "pending",
    authorPrincipalId: null, authorName: "Visitor", authorEmail: null, authorUrl: null, authorIpHash: null,
    bodyText: "Hello", spamScore: 0, spamProvider: null, createdAt: NOW, updatedAt: NOW, version: 0, ...overrides,
  };
}

test("a throwing statusChanged hook is swallowed and later hooks still run", async () => {
  const registry = createCommentHookRegistry();
  const seen: string[] = [];
  registry.registerStatusChangedHook({ hook: async () => { seen.push("first"); throw new Error("hook down"); } }, {});
  registry.registerStatusChangedHook({ hook: async ({ commentId }) => { seen.push(`second:${commentId}`); } }, {});

  await registry.runStatusChangedHooks({ workspaceId: WS, commentId: "c-1", fromStatus: "pending", toStatus: "approved" });
  assert.deepEqual(seen, ["first", "second:c-1"]);
});

test("InMemoryCommentRepo.save inserts a new row and replaces an existing one in place", async () => {
  const repo = new InMemoryCommentRepo({ initialComments: [comment("keep"), comment("c-1")] });
  await repo.save(comment("c-2", { bodyText: "new" }));
  await repo.save(comment("c-1", { status: "trash", version: 3 }));
  await repo.save(comment("c-1", { workspaceId: "other-ws", bodyText: "same id, other workspace" }));

  assert.equal((await repo.findById({ workspaceId: WS, id: "c-2" }))?.bodyText, "new");
  assert.deepEqual(await repo.findById({ workspaceId: WS, id: "c-1" }), comment("c-1", { status: "trash", version: 3 }));
  assert.equal((await repo.findById({ workspaceId: "other-ws", id: "c-1" }))?.bodyText, "same id, other workspace");
  const all = await repo.listThreadForEntry({ workspaceId: WS, entryId: "entry-1", includeStatuses: ["pending", "trash"] });
  assert.deepEqual(all.map((node) => node.comment.id).sort(), ["c-1", "c-2", "keep"], "replacing must not duplicate a row");
});

test("purge of a row that appeared after the pre-read succeeds and forgets it, but emits no event", async () => {
  const repo = new InMemoryCommentRepo();
  const outbox = new InMemoryOutbox();
  const trash = commentTrashDoubles();
  const service = createCommentWriteService({
    repo, outbox, hooks: createCommentHookRegistry(),
    clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => "event-1" },
    ...trash,
    // A concurrent writer commits the row between purge's pre-read and its transaction: the
    // pre-read saw nothing, so there is no entryId/status to describe a `comments.purged` event.
    runInTransaction: async (fn) => { await repo.create({ record: comment("late") }, {}); return fn(); },
  });

  const result = await service.purge({ workspaceId: WS, id: "late", actorPrincipalId: "admin-1", note: null });
  assert.deepEqual(result, { ok: true });
  assert.equal(await repo.findById({ workspaceId: WS, id: "late" }), null);
  assert.deepEqual(trash.forgotten, [{ workspaceId: WS, id: "late" }]);
  assert.deepEqual(await outbox.claimPending({ batchSize: 10, nowIso: NOW }), []);
});

test("purge of an unknown comment reports not-found and touches neither the Trash index nor the outbox", async () => {
  const repo = new InMemoryCommentRepo();
  const outbox = new InMemoryOutbox();
  const trash = commentTrashDoubles();
  const service = createCommentWriteService({
    repo, outbox, hooks: createCommentHookRegistry(),
    clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => "event-1" }, ...trash,
  });

  assert.deepEqual(await service.purge({ workspaceId: WS, id: "missing", actorPrincipalId: "admin-1", note: null }), { ok: false, reason: "not-found" });
  assert.deepEqual(trash.forgotten, []);
  assert.deepEqual(await outbox.claimPending({ batchSize: 10, nowIso: NOW }), []);
});
