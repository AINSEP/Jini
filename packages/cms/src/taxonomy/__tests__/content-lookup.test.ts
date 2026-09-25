import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createEntryBackedContentLookup,
  createContentLookup,
  createPostBackedContentLookup,
  type EntryRecordLookupPort,
} from "../content-lookup.js";
import type { ContentRecordLookupPort } from "../content-lookup.js";

/**
 * @file A1 (taxonomy plan) — the entry-backed `ContentLookupPort` adapter, and the router that
 * sends `post`/`page` to a host's post repo and every other `contentType` to its entry repo.
 * Mirrors `createPostBackedContentLookup`'s own (untested, adapter-only) shape — these two get a
 * dedicated RED/GREEN pass because `createContentLookup`'s routing branch is real logic, not a
 * pass-through.
 */

function entryRepoStub(rows: Record<string, { workspaceId: string; type: string }>): EntryRecordLookupPort {
  return {
    async findById({ id }) {
      return rows[id] ?? null;
    },
  };
}

function postRepoStub(rows: Record<string, { workspaceId: string; kind: string }>): ContentRecordLookupPort {
  return {
    async findById({ id }) {
      return rows[id] ?? null;
    },
  };
}

test("createEntryBackedContentLookup: resolves an entry row, mapping its 'type' field to 'kind'", async () => {
  const lookup = createEntryBackedContentLookup({
    entryRepo: entryRepoStub({ "entry-1": { workspaceId: "ws-1", type: "recipes" } }),
    workspaceId: "ws-1",
  });

  const resolved = await lookup.resolve({ contentType: "recipes", contentId: "entry-1" });
  assert.deepEqual(resolved, { workspaceId: "ws-1", kind: "recipes" });
});

test("createEntryBackedContentLookup: an unknown id resolves to null", async () => {
  const lookup = createEntryBackedContentLookup({ entryRepo: entryRepoStub({}), workspaceId: "ws-1" });
  assert.equal(await lookup.resolve({ contentType: "recipes", contentId: "missing" }), null);
});

test("createContentLookup: routes 'post'/'page' to the post repo, never touching the entry repo", async () => {
  let entryCalls = 0;
  const lookup = createContentLookup({
    postRepo: postRepoStub({ "post-1": { workspaceId: "ws-1", kind: "post" } }),
    entryRepo: {
      async findById() {
        entryCalls += 1;
        return null;
      },
    },
    workspaceId: "ws-1",
  });

  const resolved = await lookup.resolve({ contentType: "post", contentId: "post-1" });
  assert.deepEqual(resolved, { workspaceId: "ws-1", kind: "post" });
  assert.equal(entryCalls, 0);
});

test("createContentLookup: routes every non-post/page contentType to the entry repo, never touching the post repo", async () => {
  let postCalls = 0;
  const lookup = createContentLookup({
    postRepo: {
      async findById() {
        postCalls += 1;
        return null;
      },
    },
    entryRepo: entryRepoStub({ "entry-1": { workspaceId: "ws-1", type: "recipes" } }),
    workspaceId: "ws-1",
  });

  const resolved = await lookup.resolve({ contentType: "recipes", contentId: "entry-1" });
  assert.deepEqual(resolved, { workspaceId: "ws-1", kind: "recipes" });
  assert.equal(postCalls, 0);
});

// ---------------------------------------------------------------------------
// S10 (web-high fix plan, 2026-09-24) — row 63: taxonomy assign/unassign must refuse a trashed
// post/page instead of silently joining terms to it.
// ---------------------------------------------------------------------------

test("createPostBackedContentLookup: a post with deletedAt set rejects with ENTITY_IN_TRASH instead of resolving", async () => {
  const lookup = createPostBackedContentLookup({
    postRepo: {
      async findById() {
        return { workspaceId: "w", kind: "post", deletedAt: "2026-09-24T00:00:00.000Z" };
      },
    },
    workspaceId: "w",
  });

  await assert.rejects(
    () => lookup.resolve({ contentType: "post", contentId: "p1" }),
    (err: unknown) => {
      assert.equal(
        (err as Error).message,
        "ENTITY_IN_TRASH: post 'p1' is in the Trash. Restore it from the Trash before changing it."
      );
      return true;
    }
  );
});

test("createPostBackedContentLookup: a live post (no deletedAt) still resolves normally", async () => {
  const lookup = createPostBackedContentLookup({
    postRepo: {
      async findById() {
        return { workspaceId: "w", kind: "post" };
      },
    },
    workspaceId: "w",
  });

  const resolved = await lookup.resolve({ contentType: "post", contentId: "p1" });
  assert.deepEqual(resolved, { workspaceId: "w", kind: "post" });
});
