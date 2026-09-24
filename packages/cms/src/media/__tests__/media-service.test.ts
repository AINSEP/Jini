import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MediaConflictError,
  MediaNotFoundError,
  MediaSourceImmutableError,
  MediaStillReferencedError,
  MediaValidationError,
  findMediaByIdOrSlug,
  getMediaById,
  isValidMediaSlugFormat,
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
 * Shared deps builder (GC tests need a fast-forwardable clock —
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

/**
 * Covers the 2026-09-21 fix for the size-cap error's wording: it used to state the raw byte count
 * (`uploaded file exceeds the 5242880-byte size cap`), which is unreadable for a human and, worse,
 * was the ONLY place a caller could learn the actual configured cap now that `agent-tools.ts`'s
 * catalog description no longer states a specific number (see that file's own header — the
 * catalog is a module-load-time constant shared by every host, so it cannot state one host's
 * `maxUploadBytes` override without lying to every other host).
 */
test("uploadMedia's size-cap rejection states the limit in MB, not raw bytes", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () =>
      uploadMedia(
        {
          deps,
          input: {
            workspaceId: WORKSPACE_ID,
            bytes: new Uint8Array(6 * 1024 * 1024), // over the 5 MB cap below
            filename: "big.png",
            contentType: "image/png",
            createdByPrincipal: "user-1",
          },
        },
        { maxUploadBytes: 5 * 1024 * 1024 }
      ),
    (error: unknown) => {
      assert.match((error as Error).message, /5 MB/, "the message must state the configured cap in MB");
      assert.doesNotMatch((error as Error).message, /5242880/, "the message must not also state the raw byte count");
      return true;
    }
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

// ---------------------------------------------------------------------------
// slug (2026-09-07) — derivation, uniqueness, independence from title, and
// the id-or-slug lookup helper.
// ---------------------------------------------------------------------------

async function uploadWithTitle(deps: ReturnType<typeof makeDeps>["deps"], filename: string) {
  return uploadMedia({
    deps,
    input: { workspaceId: WORKSPACE_ID, bytes: bytesFrom(filename), filename, contentType: "image/png", createdByPrincipal: "user-1" },
  });
}

test("uploadMedia derives a slug from the title", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "Woodnest Cabin Booking.png");
  assert.equal(media.title, "Woodnest Cabin Booking");
  assert.equal(media.slug, "woodnest-cabin-booking");
});

test("uploadMedia disambiguates a colliding derived slug with a numeric suffix", async () => {
  const { deps } = makeDeps();
  const first = await uploadWithTitle(deps, "cat.png");
  const second = await uploadWithTitle(deps, "cat.jpg");
  const third = await uploadWithTitle(deps, "CAT.webp"); // same slug after lowercasing, third collision

  assert.equal(first.media.slug, "cat");
  assert.equal(second.media.slug, "cat-2");
  assert.equal(third.media.slug, "cat-3");
});

test("uploadMedia falls back to 'untitled' when a non-empty title slugifies to nothing (adversarial: all-punctuation filename)", async () => {
  const { deps } = makeDeps();
  // `deriveTitleFromFilename` only strips the extension, so the title stays the non-empty "???" —
  // it is `slugifyMediaTitle` that strips every character down to "", exercising
  // `deriveUniqueMediaSlug`'s `|| "untitled"` fallback specifically, not `deriveTitleFromFilename`'s
  // own (different) empty-base fallback.
  const { media } = await uploadWithTitle(deps, "???.png");
  assert.equal(media.title, "???");
  assert.equal(media.slug, "untitled");
});

// ---------------------------------------------------------------------------
// Slug max-length cap (2026-09-07) — a live-DB backfill on real machine-generated titles surfaced
// derived slugs with no cap at all (two real rows inherited 60+ char slugs verbatim). These pin the
// fix: both the derive-on-upload path (truncate) and the explicit-edit path (reject), each following
// `post.ts`'s own MAX_SLUG_LENGTH=120 bound and per-path convention (see MEDIA_MAX_SLUG_LENGTH's doc).
// ---------------------------------------------------------------------------

test("uploadMedia truncates a title-derived slug to 120 characters, with no trailing dash left by the cut", async () => {
  const { deps } = makeDeps();
  // 119 "a"s + a space + 10 "b"s slugifies to 119 "a"s + "-" + 10 "b"s (130 chars); truncating that
  // to exactly 120 chars lands precisely on the dash, so the trailing-dash strip is load-bearing —
  // without it the slug would end "...aaa-", not a real word boundary.
  const title = `${"a".repeat(119)} ${"b".repeat(10)}`;
  const { media } = await uploadWithTitle(deps, `${title}.png`);
  assert.equal(media.slug, "a".repeat(119));
  assert.equal(media.slug.length, 119);
  assert.ok(!media.slug.endsWith("-"), "truncation must never leave a trailing dash");
});

test("uploadMedia: a collision on a 120-char-capped slug re-truncates the BASE (not the suffix) to keep the whole candidate within the cap", async () => {
  const { deps } = makeDeps();
  const longTitle = "a".repeat(200); // slugifies to itself (no non-alnum chars), well over the cap
  const first = await uploadWithTitle(deps, `${longTitle}.png`);
  const second = await uploadWithTitle(deps, `${longTitle}.jpg`); // same derived title, real collision

  assert.equal(first.media.slug, "a".repeat(120));
  assert.equal(second.media.slug, `${"a".repeat(118)}-2`);
  assert.equal(second.media.slug.length, 120);
  assert.notEqual(first.media.slug, second.media.slug);
});

test("uploadMedia: two titles that BOTH slugify to nothing collide on the 'untitled' fallback and are disambiguated like any other collision (adversarial: empty-slug collision, not just a single empty-slug upload)", async () => {
  const { deps } = makeDeps();
  // An empty derived slug is never itself insertable twice (that would collide on the unique index
  // as a raw "" value) — the "untitled" fallback base must go through the SAME suffix loop as any
  // other base, which this proves against two DIFFERENT titles that both strip to nothing.
  const first = await uploadWithTitle(deps, "???.png");
  const second = await uploadWithTitle(deps, "!!!.png");
  assert.equal(first.media.slug, "untitled");
  assert.equal(second.media.slug, "untitled-2");
});

test("updateMediaMetadata rejects a caller-supplied slug longer than 120 characters, naming the bound (mirrors post.ts's resolveExplicitSlug)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  const overLongSlug = "a".repeat(121);
  await assert.rejects(
    () => updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, slug: overLongSlug } }),
    (err: unknown) => {
      assert.ok(err instanceof MediaValidationError);
      assert.equal((err as Error).message, "slug must be 120 characters or fewer");
      return true;
    }
  );
});

test("updateMediaMetadata accepts a caller-supplied slug exactly 120 characters long", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  const exactSlug = "a".repeat(120);
  const { media: updated } = await updateMediaMetadata({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: media.id, slug: exactSlug },
  });
  assert.equal(updated.slug, exactSlug);
});

test("updateMediaMetadata: renaming the title does NOT change the slug (independent fields)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "original-name.png");
  const { media: updated } = await updateMediaMetadata({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: media.id, title: "A Completely Different Title" },
  });
  assert.equal(updated.title, "A Completely Different Title");
  assert.equal(updated.slug, media.slug, "slug must survive a title-only edit unchanged");
});

test("updateMediaMetadata accepts an explicit slug edit, normalized to lowercase", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  const { media: updated } = await updateMediaMetadata({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: media.id, slug: "Custom-Slug" },
  });
  assert.equal(updated.slug, "custom-slug");
});

test("updateMediaMetadata rejects a slug already claimed by a DIFFERENT row, naming the conflicting id (MediaConflictError)", async () => {
  const { deps } = makeDeps();
  const { media: first } = await uploadWithTitle(deps, "first.png");
  const { media: second } = await uploadWithTitle(deps, "second.png");

  await assert.rejects(
    () => updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: second.id, slug: first.slug } }),
    (err: unknown) => {
      assert.ok(err instanceof MediaConflictError);
      assert.match((err as Error).message, new RegExp(`'${first.slug}'.*${first.id}`));
      return true;
    }
  );
});

test("updateMediaMetadata allows a row to keep claiming its OWN current slug (not a self-conflict)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  const { media: updated } = await updateMediaMetadata({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: media.id, slug: media.slug, alt: "still fine" },
  });
  assert.equal(updated.slug, media.slug);
  assert.equal(updated.alt, "still fine");
});

test("updateMediaMetadata rejects a malformed slug (uppercase/space/symbol) with MediaValidationError", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  await assert.rejects(
    () => updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, slug: "not a slug!" } }),
    MediaValidationError
  );
});

// ---------------------------------------------------------------------------
// htmlAttributes (2026-09-07) — write-path enforcement of the html-attributes.ts allowlist.
// ---------------------------------------------------------------------------

test("uploadMedia defaults htmlAttributes to null (no upload-time UI for it, matching cssClass)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  assert.equal(media.htmlAttributes, null);
});

test("updateMediaMetadata stores a valid htmlAttributes string verbatim (trimmed)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  const { media: updated } = await updateMediaMetadata({
    deps,
    input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: '  data-motion="fade-in" loading="lazy"  ' },
  });
  assert.equal(updated.htmlAttributes, 'data-motion="fade-in" loading="lazy"');
});

test("updateMediaMetadata: an htmlAttributes string that trims to empty is stored as null (cssClass's identical convention)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  await updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: "data-motion=\"fade\"" } });
  const { media: cleared } = await updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: "   " } });
  assert.equal(cleared.htmlAttributes, null);
});

test("updateMediaMetadata: explicit null clears htmlAttributes back to not-set", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  await updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: "muted" } });
  const { media: cleared } = await updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: null } });
  assert.equal(cleared.htmlAttributes, null);
});

test("updateMediaMetadata: omitting htmlAttributes leaves the stored value unchanged", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  await updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: "muted" } });
  const { media: updated } = await updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, alt: "new alt" } });
  assert.equal(updated.htmlAttributes, "muted");
  assert.equal(updated.alt, "new alt");
});

test("updateMediaMetadata rejects an on* handler in htmlAttributes with MediaValidationError naming it, and writes NOTHING (not even the other fields in the same call)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  await assert.rejects(
    () =>
      updateMediaMetadata({
        deps,
        input: { workspaceId: WORKSPACE_ID, id: media.id, alt: "should not be saved", htmlAttributes: 'onerror="alert(1)"' },
      }),
    (err: unknown) => {
      assert.ok(err instanceof MediaValidationError);
      assert.match((err as Error).message, /onerror/);
      return true;
    }
  );
  const { media: reread } = await getMediaById({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } });
  assert.equal(reread.alt, media.alt, "a rejected htmlAttributes value must not let ANY field in the same call persist");
  assert.equal(reread.htmlAttributes, null);
});

test("updateMediaMetadata rejects a javascript: value in htmlAttributes even on an otherwise-allowed name", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  await assert.rejects(
    () => updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: 'poster="javascript:alert(1)"' } }),
    (err: unknown) => {
      assert.ok(err instanceof MediaValidationError);
      assert.match((err as Error).message, /javascript:/);
      return true;
    }
  );
});

test("updateMediaMetadata rejects a disallowed attribute name in htmlAttributes, naming it", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "cat.png");
  await assert.rejects(
    () => updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, htmlAttributes: 'style="color:red"' } }),
    (err: unknown) => {
      assert.ok(err instanceof MediaValidationError);
      assert.match((err as Error).message, /style/);
      return true;
    }
  );
});

test("findMediaByIdOrSlug resolves by slug, falls back to id, and returns null on a genuine miss", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "woodnest-cabin.png");

  const bySlug = await findMediaByIdOrSlug({ deps, input: { workspaceId: WORKSPACE_ID, idOrSlug: media.slug } });
  assert.equal(bySlug?.id, media.id);

  const byId = await findMediaByIdOrSlug({ deps, input: { workspaceId: WORKSPACE_ID, idOrSlug: media.id } });
  assert.equal(byId?.id, media.id);

  const miss = await findMediaByIdOrSlug({ deps, input: { workspaceId: WORKSPACE_ID, idOrSlug: "no-such-thing" } });
  assert.equal(miss, null);
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

test("purgeMedia removes the media row immediately but only TOMBSTONES an unshared blob (deletion is grace-gated, not immediate)", async () => {
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

/**
 * Regression (2026-09-06): `image/avif` was absent from `DEFAULT_ALLOWED_MIME_TYPES`, so a
 * genuine `.avif` picked in the admin file input — or handed to the `media_upload_asset` agent
 * tool from the assistant chat, whose published schema enum is derived from this same Set —
 * was rejected outright. Paired with the `content-type-sniffer.ts` brand fix: accepting the type
 * without that fix would have been worse than the rejection, since the bytes would then have
 * been stored and served as `video/mp4`.
 */
test("uploadMedia accepts image/avif", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom("avif-bytes"),
      filename: "ai-caps.avif",
      contentType: "image/avif",
      createdByPrincipal: "user-1",
    },
  });

  assert.equal(media.title, "ai-caps");
  assert.equal(media.status, "active");
});

/**
 * The allowlist stays an allowlist: widening it for AVIF must not turn it into "any image/*".
 * `image/svg+xml` is the durable negative case (it needs an ingest sanitizer this build does not
 * have), and `image/heic` is the second — the installed libvips cannot decode HEIC, so accepting
 * it would store bytes no transform could ever render.
 */
test("uploadMedia still rejects types outside the allowlist, with the exact operator-facing message", async () => {
  const { deps } = makeDeps();
  for (const contentType of ["image/svg+xml", "image/heic", "application/pdf"]) {
    await assert.rejects(
      () =>
        uploadMedia({
          deps,
          input: {
            workspaceId: WORKSPACE_ID,
            bytes: bytesFrom("payload"),
            filename: "f.bin",
            contentType,
            createdByPrincipal: "user-1",
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof MediaValidationError);
        assert.equal(err.message, `content type '${contentType}' is not allowed for upload`);
        return true;
      }
    );
  }
});

// ---------------------------------------------------------------------------
// Slug/id collision (2026-09-07). A lowercase UUID matches the slug format pattern character for
// character, and this resolver used to try the slug FIRST — so one asset's slug could take over
// another asset's id and every `/m/{id}/…` URL already authored against it.
// ---------------------------------------------------------------------------

const UUID_SHAPED = "550e8400-e29b-41d4-a716-446655440000";

test("updateMediaMetadata rejects a UUID-shaped slug — it can only ever shadow an id", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "clip.mp4");

  await assert.rejects(
    () => updateMediaMetadata({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id, slug: UUID_SHAPED } }),
    MediaValidationError
  );
});

test("updateMediaMetadata still accepts ordinary hex-and-dash slugs — only the exact UUID grouping is refused", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadWithTitle(deps, "clip.mp4");

  for (const slug of ["abc-123-def", "2026-09-07-launch-clip", "deadbeef", "550e8400-e29b-41d4-a716-44665544000"]) {
    const { media: updated } = await updateMediaMetadata({
      deps,
      input: { workspaceId: WORKSPACE_ID, id: media.id, slug },
    });
    assert.equal(updated.slug, slug);
  }
});

test("findMediaByIdOrSlug resolves the ID first — a row claiming another asset's id as its slug cannot hijack it", async () => {
  const { deps } = makeDeps();
  const { media: victim } = await uploadWithTitle(deps, "victim.png");
  const { media: attacker } = await uploadWithTitle(deps, "attacker.png");

  // Written straight through the repo, bypassing the write-path rule above: this is the row an
  // older code path or a direct DB edit could already have left behind.
  await deps.mediaRepo.save({ ...attacker, slug: victim.id, version: attacker.version + 1 });

  const resolved = await findMediaByIdOrSlug({ deps, input: { workspaceId: WORKSPACE_ID, idOrSlug: victim.id } });
  assert.equal(resolved?.id, victim.id, "an id must always resolve to the asset that owns it");
});

test("isValidMediaSlugFormat — exported so hosts can decide whether a stored value is safe to emit as a URL", () => {
  for (const slug of ["abc-123-def", "2026-09-07-launch-clip", "deadbeef", "a"]) {
    assert.equal(isValidMediaSlugFormat(slug), true, `expected ${JSON.stringify(slug)} to be valid`);
  }
  for (const slug of ["..", "a/b", "A", "", UUID_SHAPED]) {
    assert.equal(isValidMediaSlugFormat(slug), false, `expected ${JSON.stringify(slug)} to be invalid`);
  }
});
