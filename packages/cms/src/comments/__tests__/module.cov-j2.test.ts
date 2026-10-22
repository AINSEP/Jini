import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { InMemoryOutbox } from "../../redirects/__tests__/support/events.fixture.js";
import * as comments from "../index.js";
import * as errors from "../errors.js";
import * as hooks from "../hooks.js";
import * as ingress from "../ingress.js";
import * as moduleExports from "../module.js";
import * as repoMemory from "../repo.memory.js";
import * as sanitize from "../sanitize.js";
import * as spam from "../spam.heuristic.js";
import * as types from "../types.js";
import * as writeService from "../write-service.js";
import type { CommentEntryView, CommentsModuleDeps } from "../module.js";
import type { CommentsSettings, CommentSubmission } from "../types.js";
import { commentTrashDoubles } from "./comment-trash-doubles.js";

/**
 * @file `createCommentsModule` (the one composition factory both host roots call) and the
 * `@jini-ai/cms/comments` barrel. The module's own logic is the entry gate: publish state first,
 * then the `closeAfterDays` window — exercised end to end through the wired ingress policy.
 */

const WS = "ws-module";
const NOW = "2026-07-16T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function settings(overrides: Partial<CommentsSettings> = {}): CommentsSettings {
  return { enabled: true, requireModeration: true, maxDepth: 3, closeAfterDays: null, spamAutoRejectScore: 0.5, maxPerIpPerHour: 20, ...overrides };
}

function submission(overrides: Partial<CommentSubmission> = {}): CommentSubmission {
  return {
    workspaceId: WS, entryId: "entry-1", parentId: null, authorName: "Visitor", authorEmail: null, authorUrl: null,
    bodyRaw: "A perfectly ordinary comment.", authorPrincipalId: null, ingressContext: { authorIpHash: "hash-1" }, ...overrides,
  };
}

function makeModule(options: { entry: CommentEntryView | null; settings?: Partial<CommentsSettings> }) {
  const commentRepo = new comments.InMemoryCommentRepo();
  const outbox = new InMemoryOutbox();
  const trash = commentTrashDoubles();
  const lookups: { workspaceId: string; entryId: string }[] = [];
  let ids = 0;
  const deps: CommentsModuleDeps = {
    commentRepo,
    entryLookup: async (required) => { lookups.push(required); return options.entry; },
    getSettings: async () => settings(options.settings),
    rateLimiter: { check: async () => ({ allowed: true }) },
    outbox,
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => `id-${++ids}` },
    spamCheck: new comments.HeuristicSpamCheck(),
    remove: trash.remove,
    forgetRemoved: trash.forgetRemoved,
    runInTransaction: trash.runInTransaction,
  };
  return { module: comments.createCommentsModule(deps), commentRepo, outbox, trash, lookups };
}

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY_MS).toISOString();
}

describe("createCommentsModule entry gate", () => {
  test("a published entry inside its window accepts the comment, looked up by the submission's ids", async () => {
    const { module, commentRepo, lookups } = makeModule({ entry: { status: "published", publishedAt: daysAgo(3) }, settings: { closeAfterDays: 7 } });
    const result = await module.ingressPolicy.submit(submission());
    assert.equal(result.ok, true);
    assert.deepEqual(lookups, [{ workspaceId: WS, entryId: "entry-1" }]);
    assert.equal(module.commentRepo, commentRepo, "the supplied repo is handed back, not wrapped");
    assert.ok(result.ok && (await commentRepo.findById({ workspaceId: WS, id: result.comment.id })));
  });

  test("an unknown entry is rejected as entry-not-found", async () => {
    const { module } = makeModule({ entry: null });
    assert.deepEqual(await module.ingressPolicy.submit(submission()), { ok: false, reason: "entry-not-found" });
  });

  test("draft and unpublished entries are closed even with a recent publishedAt and no window", async () => {
    for (const entry of [{ status: "draft", publishedAt: null }, { status: "unpublished", publishedAt: daysAgo(1) }]) {
      const { module, commentRepo } = makeModule({ entry });
      assert.deepEqual(await module.ingressPolicy.submit(submission()), { ok: false, reason: "entry-closed" }, entry.status);
      assert.deepEqual(await commentRepo.listThreadForEntry({ workspaceId: WS, entryId: "entry-1", includeStatuses: ["pending", "approved", "spam", "trash"] }), []);
    }
  });

  test("a published entry older than closeAfterDays is closed; exactly at the limit it is still open", async () => {
    const closed = makeModule({ entry: { status: "published", publishedAt: daysAgo(8) }, settings: { closeAfterDays: 7 } });
    assert.deepEqual(await closed.module.ingressPolicy.submit(submission()), { ok: false, reason: "entry-closed" });
    const boundary = makeModule({ entry: { status: "published", publishedAt: daysAgo(7) }, settings: { closeAfterDays: 7 } });
    assert.equal((await boundary.module.ingressPolicy.submit(submission())).ok, true);
  });

  test("with no window, or no/unparseable publish date, a published entry stays open", async () => {
    const cases: { entry: CommentEntryView; closeAfterDays: number | null }[] = [
      { entry: { status: "published", publishedAt: daysAgo(4000) }, closeAfterDays: null },
      { entry: { status: "published", publishedAt: null }, closeAfterDays: 1 },
      { entry: { status: "published", publishedAt: "not-a-date" }, closeAfterDays: 1 },
    ];
    for (const { entry, closeAfterDays } of cases) {
      const { module } = makeModule({ entry, settings: { closeAfterDays } });
      assert.equal((await module.ingressPolicy.submit(submission())).ok, true, JSON.stringify(entry));
    }
  });
});

describe("createCommentsModule wiring", () => {
  test("ingress and moderation share one hook registry, repo and outbox; trash seams are passed through", async () => {
    const { module, outbox, trash } = makeModule({ entry: { status: "published", publishedAt: daysAgo(1) } });
    const submitted = await module.ingressPolicy.submit(submission());
    assert.ok(submitted.ok);
    const id = submitted.comment.id;

    const trashed = await module.writeService.applyModeration({
      workspaceId: WS, id, expectedVersion: submitted.comment.version, action: "trash", toStatus: "trash", actorPrincipalId: "admin-1", note: null,
    });
    assert.equal(trashed.ok, true);
    assert.deepEqual(trash.removed.map(({ workspaceId, id: removedId }) => ({ workspaceId, id: removedId })), [{ workspaceId: WS, id }]);

    const claimed = await outbox.claimPending({ batchSize: 10, nowIso: NOW });
    assert.deepEqual(claimed.map((row) => row.event.name), ["comments.submitted", "comments.trashed"]);
  });
});

describe("@jini-ai/cms/comments barrel", () => {
  test("re-exports every module's runtime surface by identity, and nothing else", () => {
    const sources = [types, hooks, ingress, writeService, spam, sanitize, errors, repoMemory, moduleExports];
    const expected = new Map<string, unknown>();
    for (const source of sources) for (const [name, value] of Object.entries(source)) expected.set(name, value);
    assert.deepEqual(Object.keys(comments).sort(), [...expected.keys()].sort());
    for (const [name, value] of expected) assert.equal((comments as Record<string, unknown>)[name], value, name);
  });

  test("the domain errors are distinguishable, named, and carry the retry version", () => {
    const missing = new comments.CommentNotFoundError({ commentId: "c-1" });
    assert.ok(missing instanceof Error);
    assert.equal(missing.name, "CommentNotFoundError");
    assert.equal(missing.message, "comment 'c-1' was not found");

    const conflict = new comments.CommentVersionConflictError({ commentId: "c-1", currentVersion: 4 });
    assert.equal(conflict.name, "CommentVersionConflictError");
    assert.equal(conflict.currentVersion, 4);
    assert.equal(conflict.message, "comment 'c-1' was modified concurrently (current version is 4)");

    const unknown = new comments.CommentVersionConflictError({ commentId: "c-2" });
    assert.equal(unknown.currentVersion, undefined);
    assert.equal(unknown.message, "comment 'c-2' was modified concurrently (current version is unknown)");

    const invalid = new comments.CommentsSettingsValidationError("maxDepth must be positive");
    assert.ok(invalid instanceof Error);
    assert.equal(invalid.message, "maxDepth must be positive");
    assert.ok(!(invalid instanceof comments.CommentNotFoundError));
  });
});
