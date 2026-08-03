import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MediaNotFoundError,
  MediaSourceImmutableError,
  MediaStillReferencedError,
  MediaValidationError,
  getMediaById,
  listMedia,
  purgeMedia,
  resolveWriteOnceSource,
  trashMedia,
  updateMediaMetadata,
  uploadMedia,
} from "../media-service.js";
import {
  InMemoryAssetBlobRepo,
  InMemoryAssetRenditionRepo,
  InMemoryBlobGcJournalRepo,
  InMemoryMediaRepo,
} from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { DEFAULT_GC_GRACE_MS, runBlobGcDeletePass, runBlobGcUnlinkPass } from "../blob-gc.js";

const WORKSPACE_ID = "workspace-1";

/**
 * Shared deps builder (ADR-027 §5 GC tests need a fast-forwardable clock —
 * same `setNow` closure pattern as `identity/__tests__/auth-service.test.ts`'s
 * `buildDeps`, so grace-period gating can be proven without a real sleep).
 */
function makeDeps() {
  let counter = 0;
  let currentNow = "2026-07-10T00:00:00.000Z";
  const deps = {
    clock: { nowIso: () => currentNow },
    idGen: { newId: () => `id-${(counter += 1)}` },
    mediaRepo: new InMemoryMediaRepo(),
    blobRepo: new InMemoryAssetBlobRepo(),
    renditionRepo: new InMemoryAssetRenditionRepo(),
    blobStore: new InMemoryBlobStore(),
    journalRepo: new InMemoryBlobGcJournalRepo(),
  };
  return { deps, setNow: (iso: string) => (currentNow = iso) };
}

function bytesFrom(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

test("uploadMedia stores bytes, a media row, and an 'original' rendition", async () => {
  const { deps } = makeDeps();

  const { media } = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom("hello-bytes"),
      filename: "cat.png",
      contentType: "image/png",
      createdByPrincipal: "user-1",
    },
  });

  assert.equal(media.title, "cat");
  assert.equal(media.status, "active");
  assert.equal(media.version, 1);
  assert.ok(media.source.sha256.length === 64);

  const renditions = await deps.renditionRepo.listByAsset({
    workspaceId: WORKSPACE_ID,
    assetId: media.id,
  });
  assert.equal(renditions.length, 1);
  assert.equal(renditions[0]!.transformName, "original");

  const blob = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: media.source.sha256 });
  assert.ok(blob);
  assert.ok(await deps.blobStore.exists({ storageKey: blob!.storageKey }));
});

test("uploadMedia dedups identical bytes into one blob but two media rows", async () => {
  const { deps } = makeDeps();
  const bytes = bytesFrom("same-content");

  const first = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes,
      filename: "a.png",
      contentType: "image/png",
      createdByPrincipal: "user-1",
    },
  });
  const second = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes,
      filename: "b.png",
      contentType: "image/png",
      createdByPrincipal: "user-1",
    },
  });

  assert.notEqual(first.media.id, second.media.id);
  assert.equal(first.media.source.sha256, second.media.source.sha256);

  const { media } = await listMedia({ deps, input: { workspaceId: WORKSPACE_ID } });
  assert.equal(media.length, 2);

  // Only one asset_blobs row for the shared hash.
  const blob = await deps.blobRepo.findByHash({
    workspaceId: WORKSPACE_ID,
    sha256: first.media.source.sha256,
  });
  assert.ok(blob);
});

test("uploadMedia rejects a disallowed content type", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () =>
      uploadMedia({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          bytes: bytesFrom("x"),
          filename: "malware.exe",
          contentType: "application/x-msdownload",
          createdByPrincipal: "user-1",
        },
      }),
    MediaValidationError
  );
});

test("uploadMedia rejects a file over the size cap", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () =>
      uploadMedia(
        {
          deps,
          input: {
            workspaceId: WORKSPACE_ID,
            bytes: bytesFrom("big-file-content"),
            filename: "big.png",
            contentType: "image/png",
            createdByPrincipal: "user-1",
          },
        },
        { maxUploadBytes: 4 }
      ),
    MediaValidationError
  );
});

test("uploadMedia rejects an empty file", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () =>
      uploadMedia({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          bytes: new Uint8Array(0),
          filename: "empty.png",
          contentType: "image/png",
          createdByPrincipal: "user-1",
        },
      }),
    MediaValidationError
  );
});

test("getMediaById throws MediaNotFoundError for a missing id", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => getMediaById({ deps, input: { workspaceId: WORKSPACE_ID, id: "missing" } }),
    MediaNotFoundError
  );
});

test("updateMediaMetadata updates only alt/caption/credit/title and bumps version", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom("photo"),
      filename: "photo.jpg",
      contentType: "image/jpeg",
      createdByPrincipal: "user-1",
    },
  });

  const { media: updated } = await updateMediaMetadata({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      id: media.id,
      alt: "A cat",
      caption: "A very good cat",
      credit: "Photographer Name",
      title: "Cat Photo",
    },
  });

  assert.equal(updated.alt, "A cat");
  assert.equal(updated.caption, "A very good cat");
  assert.equal(updated.credit, "Photographer Name");
  assert.equal(updated.title, "Cat Photo");
  assert.equal(updated.version, 2);
  // source untouched
  assert.equal(updated.source.sha256, media.source.sha256);
});

test("updateMediaMetadata throws MediaNotFoundError for a missing id", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () =>
      updateMediaMetadata({
        deps,
        input: { workspaceId: WORKSPACE_ID, id: "missing", alt: "x" },
      }),
    MediaNotFoundError
  );
});

test("resolveWriteOnceSource allows absent -> set, and rejects set -> different value", () => {
  // absent -> set is allowed
  const first = resolveWriteOnceSource({ existing: undefined, requestedSha256: "abc123" });
  assert.equal(first.sha256, "abc123");

  // set -> same value is idempotent (allowed)
  const same = resolveWriteOnceSource({ existing: { sha256: "abc123" }, requestedSha256: "abc123" });
  assert.equal(same.sha256, "abc123");

  // set -> different value is rejected (the adversarial case: an attempted
  // source-swap through whatever future path might try it)
  assert.throws(
    () => resolveWriteOnceSource({ existing: { sha256: "abc123" }, requestedSha256: "def456" }),
    MediaSourceImmutableError
  );
});

test("trashMedia soft-deletes and is idempotent on a second call", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom("photo"),
      filename: "photo.jpg",
      contentType: "image/jpeg",
      createdByPrincipal: "user-1",
    },
  });

  const { media: trashed } = await trashMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } });
  assert.equal(trashed.status, "trashed");
  assert.equal(trashed.version, 2);

  const { media: trashedAgain } = await trashMedia({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: media.id },
  });
  assert.equal(trashedAgain.version, 2); // no-op, version unchanged
});

test("purgeMedia 409s (MediaStillReferencedError) when the asset is not yet trashed", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom("photo"),
      filename: "photo.jpg",
      contentType: "image/jpeg",
      createdByPrincipal: "user-1",
    },
  });

  await assert.rejects(
    () => purgeMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } }),
    MediaStillReferencedError
  );
});

test("purgeMedia removes the media row immediately but only TOMBSTONES an unshared blob (ADR-027 §5: deletion is grace-gated, not immediate)", async () => {
  const { deps, setNow } = makeDeps();
  const { media } = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom("solo-photo"),
      filename: "solo.jpg",
      contentType: "image/jpeg",
      createdByPrincipal: "user-1",
    },
  });
  const sha256 = media.source.sha256;
  const blobBefore = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  const storageKey = blobBefore!.storageKey;

  await trashMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } });
  const { purged } = await purgeMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } });
  assert.equal(purged, true);

  // Media row is gone immediately (unchanged deletion-ladder behavior).
  await assert.rejects(() => getMediaById({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } }), MediaNotFoundError);

  // The blob is only TOMBSTONED by purge — row and bytes both still exist
  // (INV-1a: unlink only happens after a completed delete-pass, never as a
  // side effect of removing the media row).
  const blobAfterPurge = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  assert.ok(blobAfterPurge);
  assert.equal(blobAfterPurge!.status, "tombstoned");
  assert.ok(blobAfterPurge!.tombstonedAt);
  assert.equal(await deps.blobStore.exists({ storageKey }), true);

  // Delete-pass refuses to run before gc_grace has elapsed.
  const tooEarly = await runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  assert.equal(tooEarly.deleted, false);
  assert.equal(tooEarly.reason, "grace-period-not-elapsed");
  assert.equal(await deps.blobStore.exists({ storageKey }), true);

  // Fast-forward the fake clock past gc_grace (no real sleep) and rerun.
  setNow(new Date(new Date("2026-07-10T00:00:00.000Z").getTime() + DEFAULT_GC_GRACE_MS + 1000).toISOString());
  const onTime = await runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  assert.equal(onTime.deleted, true);

  // Row deleted, but bytes are untouched until the unlink-pass drains the journal.
  const blobAfterDeletePass = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  assert.equal(blobAfterDeletePass, null);
  assert.equal(await deps.blobStore.exists({ storageKey }), true);

  const { unlinked, skipped } = await runBlobGcUnlinkPass({ deps, input: { workspaceId: WORKSPACE_ID } });
  assert.deepEqual(unlinked, [sha256]);
  assert.deepEqual(skipped, []);
  assert.equal(await deps.blobStore.exists({ storageKey }), false);

  const renditionsAfter = await deps.renditionRepo.listByAsset({
    workspaceId: WORKSPACE_ID,
    assetId: media.id,
  });
  assert.equal(renditionsAfter.length, 0);
});

test("purgeMedia keeps blob bytes when a sibling row still shares the same hash (adversarial: shared-hash aggregate)", async () => {
  const { deps } = makeDeps();
  const bytes = bytesFrom("shared-bytes");

  const first = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes,
      filename: "first.jpg",
      contentType: "image/jpeg",
      createdByPrincipal: "user-1",
    },
  });
  const second = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes,
      filename: "second.jpg",
      contentType: "image/jpeg",
      createdByPrincipal: "user-1",
    },
  });

  await trashMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: first.media.id } });
  await purgeMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: first.media.id } });

  // second row still references the same sha256 -> the tombstone-pass must
  // not tombstone the blob at all (isBlobUnreferenced is false), let alone
  // delete it.
  const blob = await deps.blobRepo.findByHash({
    workspaceId: WORKSPACE_ID,
    sha256: second.media.source.sha256,
  });
  assert.ok(blob);
  assert.equal(blob!.status, "active");
  assert.ok(await deps.blobStore.exists({ storageKey: blob!.storageKey }));

  const { media: stillThere } = await getMediaById({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: second.media.id },
  });
  assert.equal(stillThere.id, second.media.id);
});

test("purgeMedia throws MediaNotFoundError for a missing id", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => purgeMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: "missing" } }),
    MediaNotFoundError
  );
});
