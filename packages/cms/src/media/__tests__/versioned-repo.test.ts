import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryVersionedMediaRepo, type VersionedMediaRepoPort } from "../versioned-repo.js";
import { MediaConflictError } from "../types.js";
import type { MediaRepoPort } from "../ports.js";
import { makeMedia, WORKSPACE_ID } from "./versioned-media.fixture.js";

function runMediaSuite(label: string, makeRepo: () => MediaRepoPort) {
  test(`[${label}] save() then findById() round-trips`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia());
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" });
    assert.deepEqual(found, makeMedia());
    assert.equal(await repo.findById({ workspaceId: "workspace-2", id: "media-1" }), null);
  });

  test(`[${label}] save() preserves populated nullable metadata and can clear it`, async () => {
    const repo = makeRepo();
    const record = makeMedia({ width: 1280, height: 720, cssClass: "video-cover", htmlAttributes: 'poster="/m/poster/original" controls' });
    await repo.save(record);
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: record.id }), record);
    await repo.save(makeMedia({ version: 2 }));
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: record.id }), makeMedia({ version: 2 }));
  });

  test(`[${label}] save() upserts (an update replaces the prior state)`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia());
    await repo.save(makeMedia({ title: "Updated title", version: 2 }));
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" });
    assert.equal(found?.title, "Updated title");
    assert.equal(found?.version, 2);
  });

  test(`[${label}] list() scopes strictly by workspace`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ id: "m-1", workspaceId: "workspace-1" }));
    await repo.save(makeMedia({ id: "m-2", workspaceId: "workspace-2" }));
    const list = await repo.list({ workspaceId: "workspace-1" });
    assert.deepEqual(list.map((r) => r.id), ["m-1"]);
  });

  test(`[${label}] remove() deletes the row`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia());
    await repo.remove({ workspaceId: "workspace-2", id: "media-1" });
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" }), makeMedia());
    await repo.remove({ workspaceId: WORKSPACE_ID, id: "media-1" });
    assert.equal(await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" }), null);
  });

  test(`[${label}] findBySlug() round-trips and is scoped by workspace (2026-09-07)`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia());
    await repo.save(makeMedia({ id: "m-other-ws", workspaceId: "workspace-2", slug: "a-photo" }));

    const found = await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "a-photo" });
    assert.equal(found?.id, "media-1");

    const miss = await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "no-such-slug" });
    assert.equal(miss, null);

    // Same slug text in a DIFFERENT workspace must never resolve across the boundary — uniqueness
    // (and lookup) is (workspaceId, slug), never slug alone.
    const wrongWorkspace = await repo.findBySlug({ workspaceId: "workspace-3", slug: "a-photo" });
    assert.equal(wrongWorkspace, null);
  });
}

function runVersionedMediaSuite(label: string, makeRepo: () => VersionedMediaRepoPort) {
  test(`[${label}] saveIfVersion() applies the write when the row is at the expected version`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ version: 3 }));

    const result = await repo.saveIfVersion({ record: makeMedia({ title: "Updated", version: 4 }), ifVersion: 3 });

    assert.deepEqual(result, { applied: true });
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" });
    assert.equal(found?.title, "Updated");
    assert.equal(found?.version, 4);
  });

  test(`[${label}] insertIfAbsent() and saveIfVersion() preserve authored nullable metadata`, async () => {
    const repo = makeRepo();
    const original = makeMedia({ width: 640, height: 360, cssClass: "original", htmlAttributes: 'poster="/m/first/original"' });
    assert.deepEqual(await repo.insertIfAbsent(original), { applied: true });
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: original.id }), original);
    const updated = { ...original, width: 1280, height: 720, cssClass: "updated", htmlAttributes: 'poster="/m/second/original" controls', version: 2 };
    assert.deepEqual(await repo.saveIfVersion({ record: updated, ifVersion: 1 }), { applied: true });
    assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: original.id }), updated);
  });

  test(`[${label}] saveIfVersion() refuses a stale version and leaves the row untouched`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ title: "Original", version: 3 }));

    const result = await repo.saveIfVersion({ record: makeMedia({ title: "Should not land", version: 3 }), ifVersion: 2 });

    assert.deepEqual(result, { applied: false });
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" });
    // An unconditional write (`save()`'s upsert behavior) would leave "Should not land"/version 3
    // here instead — this is the assertion that catches a CAS predicate silently dropped.
    assert.equal(found?.title, "Original");
    assert.equal(found?.version, 3);
  });

  test(`[${label}] saveIfVersion() refuses a missing row and inserts nothing`, async () => {
    const repo = makeRepo();

    const result = await repo.saveIfVersion({ record: makeMedia({ version: 1 }), ifVersion: 0 });

    assert.deepEqual(result, { applied: false });
    assert.equal(await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" }), null);
  });

  test(`[${label}] saveIfVersion() refuses a row that exists only in a DIFFERENT workspace`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ workspaceId: "workspace-2", version: 3 }));

    const result = await repo.saveIfVersion({
      record: makeMedia({ workspaceId: "workspace-1", title: "Should not land", version: 4 }),
      ifVersion: 3,
    });

    assert.deepEqual(result, { applied: false });
    assert.equal(await repo.findById({ workspaceId: "workspace-1", id: "media-1" }), null);
    const otherWorkspaceRow = await repo.findById({ workspaceId: "workspace-2", id: "media-1" });
    assert.equal(otherWorkspaceRow?.title, "A photo");
    assert.equal(otherWorkspaceRow?.version, 3);
  });

  test(`[${label}] insertIfAbsent() inserts once, then refuses and leaves the original row intact`, async () => {
    const repo = makeRepo();

    const first = await repo.insertIfAbsent(makeMedia({ title: "Original" }));
    assert.deepEqual(first, { applied: true });

    const second = await repo.insertIfAbsent(makeMedia({ title: "Should not land" }));

    assert.deepEqual(second, { applied: false });
    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" });
    // Same reasoning as the stale-version test above: an unconditional write here would leave
    // "Should not land" instead of the original title.
    assert.equal(found?.title, "Original");
  });
}

function runSlugHistorySuite(label: string, makeRepo: () => VersionedMediaRepoPort) {
  test(`[${label}] a slug rename retires the old slug — findBySlug(old) still resolves the same asset`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ slug: "old-slug" }));
    await repo.save(makeMedia({ slug: "new-slug", version: 2, updatedAt: "2026-09-23T00:00:00.000Z" }));

    const byOld = await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "old-slug" });
    assert.equal(byOld?.id, "media-1");
    const byNew = await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "new-slug" });
    assert.equal(byNew?.id, "media-1");
  });

  test(`[${label}] a DIFFERENT asset cannot claim a slug still listed as retired`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ id: "media-1", slug: "old-slug" }));
    await repo.save(makeMedia({ id: "media-1", slug: "new-slug", version: 2 }));

    await assert.rejects(
      () => repo.save(makeMedia({ id: "media-2", slug: "old-slug" })),
      (err: unknown) => {
        assert.ok(err instanceof MediaConflictError, `expected MediaConflictError, got ${err}`);
        return true;
      }
    );
    assert.equal(await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-2" }), null);
  });

  test(`[${label}] an asset may reclaim its own retired slug, which removes it from history`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ slug: "old-slug" }));
    await repo.save(makeMedia({ slug: "new-slug", version: 2 }));
    await repo.save(makeMedia({ slug: "old-slug", version: 3 }));

    const found = await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" });
    assert.equal(found?.slug, "old-slug");
    assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "media-1" }), ["new-slug"]);
  });

  test(`[${label}] remove() drops that asset's retired-slug history too`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ slug: "old-slug" }));
    await repo.save(makeMedia({ slug: "new-slug", version: 2 }));

    await repo.remove({ workspaceId: WORKSPACE_ID, id: "media-1" });

    assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "media-1" }), []);
  });

  test(`[${label}] listRetiredSlugs lists every slug this asset has ever retired`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ slug: "a" }));
    await repo.save(makeMedia({ slug: "b", version: 2 }));
    await repo.save(makeMedia({ slug: "c", version: 3 }));

    const retired = await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "media-1" });
    assert.deepEqual([...retired].sort(), ["a", "b"]);
  });

  // The two compare-and-set writers (the publish/import path) keep the same history rules as save().
  test(`[${label}] saveIfVersion renames retire the old slug too`, async () => {
    const repo = makeRepo();
    await repo.insertIfAbsent(makeMedia({ slug: "old-slug", version: 1 }));
    const outcome = await repo.saveIfVersion({ record: makeMedia({ slug: "new-slug", version: 2 }), ifVersion: 1 });

    assert.deepEqual(outcome, { applied: true });
    assert.equal((await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "old-slug" }))?.id, "media-1");
    assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "media-1" }), ["old-slug"]);
  });

  test(`[${label}] saveIfVersion lets an asset reclaim its own retired slug, removing it from history`, async () => {
    const repo = makeRepo();
    await repo.insertIfAbsent(makeMedia({ slug: "old-slug", version: 1 }));
    await repo.saveIfVersion({ record: makeMedia({ slug: "new-slug", version: 2 }), ifVersion: 1 });
    const outcome = await repo.saveIfVersion({ record: makeMedia({ slug: "old-slug", version: 3 }), ifVersion: 2 });

    assert.deepEqual(outcome, { applied: true });
    assert.equal((await repo.findById({ workspaceId: WORKSPACE_ID, id: "media-1" }))?.slug, "old-slug");
    assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "media-1" }), ["new-slug"]);
  });

  test(`[${label}] a stale saveIfVersion leaves slug history untouched`, async () => {
    const repo = makeRepo();
    await repo.insertIfAbsent(makeMedia({ slug: "old-slug", version: 1 }));
    const outcome = await repo.saveIfVersion({ record: makeMedia({ slug: "new-slug", version: 2 }), ifVersion: 7 });

    assert.deepEqual(outcome, { applied: false });
    assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "media-1" }), []);
    assert.equal(await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "new-slug" }), null);
  });

  test(`[${label}] insertIfAbsent of a DIFFERENT asset cannot claim a retired slug`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ id: "media-1", slug: "old-slug" }));
    await repo.save(makeMedia({ id: "media-1", slug: "new-slug", version: 2 }));

    await assert.rejects(
      () => repo.insertIfAbsent(makeMedia({ id: "media-2", slug: "old-slug" })),
      (err: unknown) => {
        assert.ok(err instanceof MediaConflictError, `expected MediaConflictError, got ${err}`);
        assert.equal((err as Error).message, "slug 'old-slug' is already used by another media asset in this workspace");
        return true;
      }
    );
    assert.equal((await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "old-slug" }))?.id, "media-1");
  });

  test(`[${label}] remove() frees a retired slug for a different asset, which then owns it`, async () => {
    const repo = makeRepo();
    await repo.save(makeMedia({ id: "media-1", slug: "old-slug" }));
    await repo.save(makeMedia({ id: "media-1", slug: "new-slug", version: 2 }));
    await repo.remove({ workspaceId: WORKSPACE_ID, id: "media-1" });

    await repo.save(makeMedia({ id: "media-2", slug: "old-slug" }));
    assert.equal((await repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "old-slug" }))?.id, "media-2");
  });
}


runMediaSuite("memory", () => new InMemoryMediaRepo({}));
runMediaSuite("memory-versioned", () => new InMemoryVersionedMediaRepo({}));
runVersionedMediaSuite("memory-versioned", () => new InMemoryVersionedMediaRepo({}));
runSlugHistorySuite("memory-versioned", () => new InMemoryVersionedMediaRepo({}));

// Mutation: insert an await between the compare and write, or drop the version predicate.
test("concurrent compare-and-set writes from the same version admit one winner", async () => {
  const original = makeMedia();
  const repo = new InMemoryVersionedMediaRepo({}, { initialRows: [original] });
  const outcomes = await Promise.all([
    repo.saveIfVersion({ record: { ...original, title: "first", version: 2 }, ifVersion: 1 }),
    repo.saveIfVersion({ record: { ...original, title: "second", version: 2 }, ifVersion: 1 }),
  ]);
  assert.deepEqual(outcomes, [{ applied: true }, { applied: false }]);
  assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: original.id }), { ...original, title: "first", version: 2 });
});

// Mutation: make the create-only identity check workspace-scoped instead of global.
test("insertIfAbsent keeps ids global and admits one concurrent creator", async () => {
  const repo = new InMemoryVersionedMediaRepo({});
  const first = makeMedia();
  assert.deepEqual(await Promise.all([repo.insertIfAbsent(first), repo.insertIfAbsent({ ...first, workspaceId: "other" })]),
    [{ applied: true }, { applied: false }]);
  assert.deepEqual(await repo.list({ workspaceId: WORKSPACE_ID }), [first]);
  assert.deepEqual(await repo.list({ workspaceId: "other" }), []);
});

// Mutation: omit either workspace or mediaId from the retired-history filter.
test("retired-slug reads return exactly this workspace and asset's history", async () => {
  const repo = new InMemoryVersionedMediaRepo({});
  for (const original of [makeMedia(), makeMedia({ id: "other", slug: "other" }), makeMedia({ id: "foreign", workspaceId: "other", slug: "foreign" })]) {
    await repo.save(original);
    await repo.save({ ...original, slug: "renamed", version: 2 });
  }
  assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "media-1" }), ["a-photo"]);
  assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: "missing", mediaId: "media-1" }), []);
  assert.deepEqual(await repo.listRetiredSlugs({ workspaceId: WORKSPACE_ID, mediaId: "missing" }), []);
});

// Mutation: replace preserveMediaCreator with the incoming record in either write.
test("unconditional and versioned writes preserve immutable creation fields", async () => {
  const original = makeMedia({ createdBy: "creator", originalFilename: "original.jpg", kind: "document" });
  const repo = new InMemoryVersionedMediaRepo({}, { initialRows: [original] });
  const incoming = { ...original, createdBy: "other", originalFilename: "changed.jpg", kind: "media" as const, version: 2 };
  await repo.save(incoming);
  const expected = { ...original, version: 2 };
  assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: original.id }), expected);
  assert.deepEqual(await repo.saveIfVersion({ record: { ...incoming, version: 3 }, ifVersion: 2 }), { applied: true });
  assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE_ID, id: original.id }), { ...expected, version: 3 });
});
