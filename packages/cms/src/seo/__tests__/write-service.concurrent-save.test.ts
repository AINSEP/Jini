import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, type PostRecord, type PostRepoPort } from "./support/post.fixture.js";
import { EntityNotLiveError } from "../../core/index.js";
import { SeoConcurrentWriteError } from "../errors.js";
import { setEntrySeoOverrides } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file SEO-01 (fable bugs audit, 2026-09-06) — `setEntrySeoOverrides` is the third compare-less
 * version bump on the `posts.version` column, and the only one whose caller never states a basis at
 * all.
 *
 * The shape: `findById` (await) -> merge the patch -> `postRepo.save({ ...existing, seoExtJson,
 * version: existing.version + 1 })`. `save()` is an unconditional whole-row upsert, so everything
 * the row gained between the read and the write — a content save's `bodyJson`, `title`, `status` —
 * is overwritten with the values `existing` was holding. An SEO-only edit silently reverts somebody
 * else's content edit, and reports success.
 *
 * The interleave below is deterministic, not timing-dependent: a repo decorator lands a competing
 * content save inside the gap, on the first read, exactly where a real concurrent write would land.
 *
 * "What would this still pass under?" — a fix that merely re-reads the row immediately before the
 * save would satisfy the content assertions here (the decorator fires once), and would still be the
 * same TOCTOU one await later. That is why the mechanism is asserted too: this write path must go
 * through the version-predicated `saveIfVersion`, never the unconditional `save()`.
 */

const WORKSPACE = "workspace-1";
const ENTRY_ID = "post-1";

const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const noopInvalidate = () => {};
const clock = { nowMs: () => Date.parse("2026-09-18T00:00:00.000Z") };

function seedPost(): PostRecord {
  return buildPostRecord({
    id: ENTRY_ID,
    workspaceId: WORKSPACE,
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [] },
    status: "published",
    kind: "post",
    updatedAt: "2026-09-07T00:00:00.000Z",
    version: 1,
    seoExtJson: null,
  });
}

const CONCURRENT_BODY = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "an operator's real content edit" }] }],
};

/**
 * Wraps a real repo so that the FIRST `findById` resolves only after a competing content save has
 * already landed — the read-to-write gap, made deterministic. Records which write method the
 * service reached for, because that is the actual finding.
 */
function racingRepo(inner: InMemoryPostRepo): { repo: PostRepoPort; writeCalls: string[] } {
  const writeCalls: string[] = [];
  let raced = false;

  const repo: PostRepoPort = {
    ...inner,
    findById: async (required) => {
      const row = await inner.findById(required);
      if (!raced && row) {
        raced = true;
        // A concurrent content save wins the row while the SEO service holds its now-stale read.
        await inner.save({ ...row, bodyJson: CONCURRENT_BODY, version: row.version + 1 });
      }
      return row;
    },
    findBySlug: (r) => inner.findBySlug(r),
    list: (r) => inner.list(r),
    listPublishedPreviews: (r) => inner.listPublishedPreviews(r),
    save: async (record) => {
      writeCalls.push("save");
      await inner.save(record);
    },
    saveIfVersion: async (required) => {
      writeCalls.push("saveIfVersion");
      return inner.saveIfVersion(required);
    },
    softDelete: (r) => inner.softDelete(r),
    hardDelete: (r) => inner.hardDelete(r),
    readAutosave: (r) => inner.readAutosave(r),
    writeAutosave: (r) => inner.writeAutosave(r),
    clearAutosave: (r) => inner.clearAutosave(r),
    // Delegated, not omitted: a real spread of a class instance (`{ ...inner }`, this fixture's own
    // pattern) only copies own enumerable properties — `InMemoryPostRepo`'s methods live on its
    // prototype, so `transaction`/`appendRevision`/`listRevisions` must be forwarded explicitly here
    // once `setEntrySeoOverrides` starts calling them (2026-09-18, round 4 SEO revision fix) — the
    // same trap `post-plugin-hook.integration.test.ts`'s own fixture hit in the prior round.
    appendRevision: (r) => inner.appendRevision(r),
    listRevisions: (r) => inner.listRevisions(r),
    transaction: (fn) => inner.transaction(fn),
  };

  return { repo, writeCalls };
}

test("SEO-01: an SEO-only write must not revert a content save that landed between its read and its write", async (t) => {
  const inner = new InMemoryPostRepo([seedPost()]);
  const { repo, writeCalls } = racingRepo(inner);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: {
      workspaceId: WORKSPACE,
      entryId: ENTRY_ID,
      patch: { title: "SEO title" },
      callerPrincipalId: "p1",
    },
  });

  const after = await inner.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });

  // The load-bearing assertion: the operator's content is still there. Under the unconditional
  // `save()` this reads back as the empty seed document — a silent, unreported content revert
  // caused by editing a meta description.
  assert.deepEqual(
    after?.bodyJson,
    CONCURRENT_BODY,
    "the concurrent content save must survive an SEO-only write"
  );

  // …and the SEO write itself still landed, on top of the newer row rather than instead of it.
  assert.deepEqual(result.overrides, { title: "SEO title" });
  assert.equal(after?.seoExtJson, JSON.stringify({ title: "SEO title" }));

  // The mechanism, not just the outcome — see this file's header for why.
  assert.ok(
    !writeCalls.includes("save"),
    `the SEO chokepoint must use the version-predicated write, not the unconditional upsert; calls were ${JSON.stringify(writeCalls)}`
  );
  assert.ok(writeCalls.includes("saveIfVersion"), "the SEO chokepoint must write through saveIfVersion");

  // Vitest has no diagnostic channel; assertions above retain the recorded write calls.
});

test("SEO-01: the uncontended path is unchanged — one predicated write, version advances by exactly one", async () => {
  const inner = new InMemoryPostRepo([seedPost()]);
  const writeCalls: string[] = [];
  const repo: PostRepoPort = {
    ...inner,
    findById: (r) => inner.findById(r),
    findBySlug: (r) => inner.findBySlug(r),
    list: (r) => inner.list(r),
    listPublishedPreviews: (r) => inner.listPublishedPreviews(r),
    save: async (record) => {
      writeCalls.push("save");
      await inner.save(record);
    },
    saveIfVersion: async (required) => {
      writeCalls.push("saveIfVersion");
      return inner.saveIfVersion(required);
    },
    softDelete: (r) => inner.softDelete(r),
    hardDelete: (r) => inner.hardDelete(r),
    readAutosave: (r) => inner.readAutosave(r),
    writeAutosave: (r) => inner.writeAutosave(r),
    clearAutosave: (r) => inner.clearAutosave(r),
    // See the identical comment on `racingRepo`'s own fixture above.
    appendRevision: (r) => inner.appendRevision(r),
    listRevisions: (r) => inner.listRevisions(r),
    transaction: (fn) => inner.transaction(fn),
  };

  await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: {
      workspaceId: WORKSPACE,
      entryId: ENTRY_ID,
      patch: { description: "Only one write, please" },
      callerPrincipalId: "p1",
    },
  });

  const after = await inner.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.deepEqual(writeCalls, ["saveIfVersion"], "no retry, no second write, on an uncontended row");
  assert.equal(after?.version, 2);
  assert.deepEqual(after?.bodyJson, { type: "doc", content: [] });
});

for (const outcome of ["exhausted", "trashed"] as const) {
  test(`SEO merge refuses ${outcome} retries without revisions or cache invalidation`, async (t) => {
    const original = seedPost();
    const repo = new InMemoryPostRepo([original]);
    const attempts: number[] = [];
    const invalidations: unknown[] = [];
    vi.spyOn(repo, "saveIfVersion").mockImplementation( async (required: Parameters<typeof repo.saveIfVersion>[0]) => {
      attempts.push(required.ifVersion);
      if (outcome === "trashed") {
        await repo.softDelete({ workspaceId: WORKSPACE, id: ENTRY_ID,
          deletedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", version: 2 });
      }
      return { applied: false };
    });
    await assert.rejects(setEntrySeoOverrides({
      deps: { postRepo: repo, authorize: alwaysAllow, clock: { nowMs: () => Date.parse("2026-09-18T00:00:00.000Z") },
        invalidateSitemapCache: input => { invalidations.push(input); } },
      input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, callerPrincipalId: "p1", patch: { noindex: true } },
    }), outcome === "exhausted" ? SeoConcurrentWriteError : EntityNotLiveError);
    assert.deepEqual(attempts, outcome === "exhausted" ? [1, 1, 1] : [1]);
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID }), outcome === "trashed"
      ? { ...original, deletedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", version: 2 }
      : original);
    assert.deepEqual(await repo.listRevisions({ workspaceId: WORKSPACE, postId: ENTRY_ID }), []);
    assert.deepEqual(invalidations, []);
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
