import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryOutbox } from "../../redirects/__tests__/support/events.fixture.js";
import { createCommentHookRegistry } from "../hooks.js";
import { InMemoryCommentRepo } from "../repo.memory.js";
import { createCommentWriteService } from "../write-service.js";
import type { CommentRecord } from "../types.js";
import { commentTrashDoubles } from "./comment-trash-doubles.js";

/** @file SPEC-033 — the moderation write-service: outbox events + statusChanged hook firing. */

const WORKSPACE_ID = "workspace-1";

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

function makeService() {
  const repo = new InMemoryCommentRepo();
  const outbox = new InMemoryOutbox();
  const hooks = createCommentHookRegistry();
  const removedIndex = new Set<string>();
  const service = createCommentWriteService({
    repo,
    outbox,
    hooks,
    clock: { nowMs: () => Date.parse("2026-07-16T01:00:00.000Z") },
    idGen: { newId: () => "event-1" },
    ...commentTrashDoubles(),
    forgetRemoved: async ({ workspaceId, id }) => { removedIndex.delete(`${workspaceId}:${id}`); },
  });
  return { repo, outbox, hooks, service, removedIndex };
}

test("approving a comment enqueues comments.approved and fires the statusChanged hook", async () => {
  const { repo, outbox, hooks, service } = makeService();
  await repo.create({ record: makeComment() }, {});
  let hookFired: Parameters<typeof hooks.runStatusChangedHooks>[0] | null = null;
  hooks.registerStatusChangedHook({ hook: async (payload) => {
    hookFired = payload;
  } }, {});

  const result = await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 0,
    action: "approve",
    toStatus: "approved",
    actorPrincipalId: "principal-1",
    note: null,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(hookFired, { workspaceId: WORKSPACE_ID, commentId: "comment-1", fromStatus: "pending", toStatus: "approved" });

  const claimed = await outbox.claimPending({ batchSize: 10, nowIso: "2026-07-16T01:00:00.000Z" });
  assert.equal(claimed.length, 1);
  assert.ok(claimed[0]);
  assert.deepEqual(claimed[0].event, {
    id: "event-1", name: "comments.approved", occurredAt: "2026-07-16T01:00:00.000Z",
    aggregateId: "comment-1", workspaceId: WORKSPACE_ID,
    payload: { commentId: "comment-1", entryId: "entry-1", status: "approved" },
  });
});

test("a conflict returns without enqueueing an event or firing the hook", async () => {
  const { repo, outbox, hooks, service } = makeService();
  await repo.create({ record: makeComment() }, {});
  let hookFired = false;
  hooks.registerStatusChangedHook({ hook: async () => {
    hookFired = true;
  } }, {});

  const result = await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 99,
    action: "approve",
    toStatus: "approved",
    actorPrincipalId: "principal-1",
    note: null,
  });

  assert.equal(result.ok, false);
  assert.equal(hookFired, false);
  const claimed = await outbox.claimPending({ batchSize: 10, nowIso: "2026-07-16T01:00:00.000Z" });
  assert.equal(claimed.length, 0);
});

test("purge enqueues comments.purged", async () => {
  const { repo, outbox, service, removedIndex } = makeService();
  await repo.create({ record: makeComment({ status: "trash" }) }, {});
  removedIndex.add(`${WORKSPACE_ID}:comment-1`);
  removedIndex.add("other:comment-1");

  const result = await service.purge({ workspaceId: WORKSPACE_ID, id: "comment-1", actorPrincipalId: "principal-1", note: "abuse" });
  assert.equal(result.ok, true);

  const claimed = await outbox.claimPending({ batchSize: 10, nowIso: "2026-07-16T01:00:00.000Z" });
  assert.equal(claimed.length, 1);
  assert.ok(claimed[0]);
  assert.equal(claimed[0].event.name, "comments.purged");
  assert.deepEqual([...removedIndex], ["other:comment-1"]);
  assert.equal(await repo.findById({ workspaceId: WORKSPACE_ID, id: "comment-1" }), null);
});

test("a 'trash' action (no explicit event mapping needed beyond comments.trashed) enqueues the right event", async () => {
  const { outbox, repo, service, hooks } = makeService();
  const changed: Parameters<typeof hooks.runStatusChangedHooks>[0][] = [];
  hooks.registerStatusChangedHook({ hook: async (payload) => { changed.push(payload); } }, {});
  await repo.create({ record: makeComment({ status: "approved" }) }, {});

  await service.applyModeration({
    workspaceId: WORKSPACE_ID,
    id: "comment-1",
    expectedVersion: 0,
    action: "trash",
    toStatus: "trash",
    actorPrincipalId: "principal-1",
    note: null,
  });

  const claimed = await outbox.claimPending({ batchSize: 10, nowIso: "2026-07-16T01:00:00.000Z" });
  assert.equal(claimed.length, 1);
  assert.ok(claimed[0]);
  assert.equal(claimed[0].event.name, "comments.trashed");
  assert.deepEqual(changed, [{ workspaceId: WORKSPACE_ID, commentId: "comment-1", fromStatus: "approved", toStatus: "trash" }]);
});

for (const scenario of [
  { action: "mark_spam", from: "pending", to: "spam", event: "comments.marked_spam" },
  { action: "restore", from: "trash", to: "pending", event: null },
] as const) {
  test(`${scenario.action} delivers the status hook and its contracted outbox events`, async () => {
    const { repo, outbox, hooks, service } = makeService();
    await repo.create({ record: makeComment({ status: scenario.from }) }, {});
    const changed: Parameters<typeof hooks.runStatusChangedHooks>[0][] = [];
    hooks.registerStatusChangedHook({ hook: async (payload) => { changed.push(payload); } }, {});
    assert.deepEqual(await service.applyModeration({ workspaceId: WORKSPACE_ID, id: "comment-1",
      expectedVersion: 0, action: scenario.action, toStatus: scenario.to, actorPrincipalId: "principal-1", note: null }), { ok: true });
    assert.deepEqual(changed, [{ workspaceId: WORKSPACE_ID, commentId: "comment-1", fromStatus: scenario.from, toStatus: scenario.to }]);
    const claimed = await outbox.claimPending({ batchSize: 10, nowIso: "2026-07-16T01:00:00.000Z" });
    assert.deepEqual(claimed.map((row) => row.event.name), scenario.event ? [scenario.event] : []);
  });
}
