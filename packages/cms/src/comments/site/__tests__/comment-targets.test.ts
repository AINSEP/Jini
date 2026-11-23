import assert from "node:assert/strict";
import { test } from "vitest";

import { createCommentTargetLookup } from "../comment-targets.js";

test("an entry wins, a post is the fallback (no publish time), and an unknown id stays not-found", async () => {
  const reads: string[] = [];
  const lookup = createCommentTargetLookup({
    entries: { findById: async ({ id }) => { reads.push(`entry:${id}`); return id === "e" ? { status: "published", publishedAt: "2026-01-01T00:00:00.000Z" } : null; } },
    posts: { findById: async ({ workspaceId, id }) => { reads.push(`post:${workspaceId}:${id}`); return id === "p" ? { status: "draft" } : null; } },
  }, {});
  assert.deepEqual(await lookup({ workspaceId: "s", entryId: "e" }), { status: "published", publishedAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(reads, ["entry:e"], "an entry hit never reads posts");
  assert.deepEqual(await lookup({ workspaceId: "s", entryId: "p" }), { status: "draft", publishedAt: null }, "the draft status still reaches the open gate");
  assert.equal(await lookup({ workspaceId: "s", entryId: "missing" }), null);
  assert.deepEqual(reads.slice(1), ["entry:p", "post:s:p", "entry:missing", "post:s:missing"]);
  createCommentTargetLookup({ entries: { findById: async () => null }, posts: { findById: async () => null } });
});
