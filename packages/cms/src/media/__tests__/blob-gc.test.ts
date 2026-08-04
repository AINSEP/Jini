/**
 * @file Blob-GC protocol tests (INV-1) — `blob-gc.ts` /
 * `blob-gc-lock.ts`. `media-service.test.ts` covers the `purgeMedia`-driven
 * happy path (tombstone -> grace-gated delete-pass -> unlink-pass end to
 * end); this file drills into the protocol's own invariants directly:
 * unreferenced detection, idempotent tombstoning, the grace gate, the
 * two-phase journal handoff, the sha256 lock's mutual exclusion, and the
 * concurrent purge-vs-upload race the lock exists to close.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DEFAULT_GC_GRACE_MS,
  isBlobUnreferenced,
  runBlobGcDeletePass,
  runBlobGcUnlinkPass,
  runBlobGcCycle,
  tombstoneBlobIfUnreferenced,
} from "../blob-gc.js";
import { withSha256Lock } from "../blob-gc-lock.js";
import { uploadMedia, purgeMedia, trashMedia } from "../media-service.js";
import {
  InMemoryAssetBlobRepo,
  InMemoryAssetRenditionRepo,
  InMemoryBlobGcJournalRepo,
  InMemoryMediaRepo,
} from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";

const WORKSPACE_ID = "workspace-1";

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

function advance(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

async function uploadOne(deps: ReturnType<typeof makeDeps>["deps"], content: string, filename = "a.png") {
  return uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom(content),
      filename,
      contentType: "image/png",
      createdByPrincipal: "user-1",
    },
  });
}

// ---------------------------------------------------------------------------
// withSha256Lock — mutual exclusion
// ---------------------------------------------------------------------------

test("withSha256Lock serializes calls for the same key (no interleaving)", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));

  const first = withSha256Lock("shared-key", async () => {
    events.push("first-start");
    await firstGate;
    events.push("first-end");
  });

  // Give the first critical section a chance to actually start before
  // queuing the second, so this test genuinely exercises queuing rather than
  // both starting from a cold, unstarted `withSha256Lock` call.
  await Promise.resolve();

  const second = withSha256Lock("shared-key", async () => {
    events.push("second-start");
    events.push("second-end");
  });

  assert.deepEqual(events, ["first-start"]); // second must NOT have started yet
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
});

test("withSha256Lock runs different keys fully concurrently", async () => {
  const events: string[] = [];
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => (releaseA = resolve));

  const a = withSha256Lock("key-a", async () => {
    events.push("a-start");
    await gateA;
    events.push("a-end");
  });
  const b = withSha256Lock("key-b", async () => {
    events.push("b-start");
    events.push("b-end");
  });

  await b; // key-b's independent critical section completes without waiting on key-a
  assert.deepEqual(events, ["a-start", "b-start", "b-end"]);
  releaseA();
  await a;
});

test("withSha256Lock does not let one key's rejection poison later calls on the same key", async () => {
  await assert.rejects(
    () =>
      withSha256Lock("flaky-key", async () => {
        throw new Error("boom");
      }),
    /boom/
  );

  const result = await withSha256Lock("flaky-key", async () => "ok-after-failure");
  assert.equal(result, "ok-after-failure");
});

// ---------------------------------------------------------------------------
// isBlobUnreferenced — the real sha256-uniqueness-across-non-purged check
// ---------------------------------------------------------------------------

test("isBlobUnreferenced is true when no media row (active or trashed) shares the sha256", async () => {
  const { deps } = makeDeps();
  const result = await isBlobUnreferenced({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: "no-such-hash" },
  });
  assert.equal(result, true);
});

test("isBlobUnreferenced is false while an ACTIVE media row shares the sha256", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps, "photo");
  const result = await isBlobUnreferenced({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: media.source.sha256 },
  });
  assert.equal(result, false);
});

test("isBlobUnreferenced is still false while a TRASHED (not purged) media row shares the sha256 — trashed is a non-purged state", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps, "photo");
  await trashMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } });

  const result = await isBlobUnreferenced({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: media.source.sha256 },
  });
  assert.equal(result, false);
});

// ---------------------------------------------------------------------------
// tombstoneBlobIfUnreferenced — phase 1
// ---------------------------------------------------------------------------

test("tombstoneBlobIfUnreferenced tombstones an unreferenced blob and stamps tombstonedAt", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps, "photo");
  await trashMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } });
  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: media.id }); // simulate purge's row removal directly

  const result = await tombstoneBlobIfUnreferenced({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: media.source.sha256 },
  });
  assert.equal(result.tombstoned, true);

  const row = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: media.source.sha256 });
  assert.equal(row!.status, "tombstoned");
  assert.equal(row!.tombstonedAt, "2026-07-10T00:00:00.000Z");
});

test("tombstoneBlobIfUnreferenced refuses to tombstone a still-referenced blob", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps, "photo");

  const result = await tombstoneBlobIfUnreferenced({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: media.source.sha256 },
  });
  assert.equal(result.tombstoned, false);
  assert.equal(result.reason, "still-referenced");

  const row = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: media.source.sha256 });
  assert.equal(row!.status, "active");
});

test("tombstoneBlobIfUnreferenced is idempotent on an already-tombstoned row", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps, "photo");
  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: media.id });

  const first = await tombstoneBlobIfUnreferenced({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: media.source.sha256 },
  });
  const second = await tombstoneBlobIfUnreferenced({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: media.source.sha256 },
  });
  assert.equal(first.tombstoned, true);
  assert.equal(second.tombstoned, true);
  assert.equal(second.reason, "already-tombstoned");
});

// ---------------------------------------------------------------------------
// runBlobGcDeletePass — phase 2 (grace gate + journal write + row delete)
// ---------------------------------------------------------------------------

test("runBlobGcDeletePass no-ops on a blob that was never tombstoned", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps, "photo");

  const result = await runBlobGcDeletePass({
    deps,
    input: { workspaceId: WORKSPACE_ID, sha256: media.source.sha256 },
  });
  assert.equal(result.deleted, false);
  assert.equal(result.reason, "not-tombstoned");
});

test("runBlobGcDeletePass refuses to run before gc_grace has elapsed, then succeeds once it has (fake clock, no real sleep)", async () => {
  const { deps, setNow } = makeDeps();
  const { media } = await uploadOne(deps, "photo");
  const sha256 = media.source.sha256;
  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: media.id });
  await tombstoneBlobIfUnreferenced({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });

  setNow(advance("2026-07-10T00:00:00.000Z", DEFAULT_GC_GRACE_MS - 1000));
  const tooEarly = await runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  assert.equal(tooEarly.deleted, false);
  assert.equal(tooEarly.reason, "grace-period-not-elapsed");

  setNow(advance("2026-07-10T00:00:00.000Z", DEFAULT_GC_GRACE_MS + 1000));
  const onTime = await runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  assert.equal(onTime.deleted, true);

  const row = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  assert.equal(row, null);

  const journalEntries = await deps.journalRepo.list({ workspaceId: WORKSPACE_ID });
  assert.equal(journalEntries.length, 1);
  assert.equal(journalEntries[0]!.sha256, sha256);
});

test("write-before-insert / unlink-after-delete-commit ordering: bytes survive the row delete and are only removed by a later unlink-pass", async () => {
  const { deps, setNow } = makeDeps();
  const { media } = await uploadOne(deps, "photo");
  const sha256 = media.source.sha256;
  const blobBefore = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  const storageKey = blobBefore!.storageKey;

  // Bytes exist before the row was ever created (uploadMedia's own ordering —
  // asserted here as the precondition this test's second half builds on).
  assert.ok(await deps.blobStore.exists({ storageKey }));

  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: media.id });
  await tombstoneBlobIfUnreferenced({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  setNow(advance("2026-07-10T00:00:00.000Z", DEFAULT_GC_GRACE_MS + 1000));

  const { deleted } = await runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  assert.equal(deleted, true);

  // Row deletion has committed (repo no longer has it)...
  assert.equal(await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 }), null);
  // ...but bytes are NOT unlinked yet — that's the unlink-pass's job, and it
  // hasn't run.
  assert.equal(await deps.blobStore.exists({ storageKey }), true);

  await runBlobGcUnlinkPass({ deps, input: { workspaceId: WORKSPACE_ID } });
  assert.equal(await deps.blobStore.exists({ storageKey }), false);
});

// ---------------------------------------------------------------------------
// runBlobGcUnlinkPass — phase 3, including the stale-journal-entry case
// ---------------------------------------------------------------------------

test("runBlobGcUnlinkPass skips (does not unlink) a journal entry whose sha256 has a live row again (resurrected/re-uploaded after delete-pass)", async () => {
  const { deps, setNow } = makeDeps();
  const { media } = await uploadOne(deps, "shared-bytes", "first.png");
  const sha256 = media.source.sha256;
  const blobRow = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  const storageKey = blobRow!.storageKey;

  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: media.id });
  await tombstoneBlobIfUnreferenced({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  setNow(advance("2026-07-10T00:00:00.000Z", DEFAULT_GC_GRACE_MS + 1000));
  await runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });

  // Row is gone, journal entry pending, bytes still on disk.
  assert.equal(await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 }), null);
  assert.equal(await deps.blobStore.exists({ storageKey }), true);

  // A brand-new upload with the SAME bytes arrives before the unlink-pass runs.
  await uploadOne(deps, "shared-bytes", "second.png");
  const newRow = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  assert.ok(newRow);
  assert.equal(newRow!.status, "active");

  const { unlinked, skipped } = await runBlobGcUnlinkPass({ deps, input: { workspaceId: WORKSPACE_ID } });
  assert.deepEqual(unlinked, []);
  assert.deepEqual(skipped, [sha256]);

  // The bytes the new row depends on must NOT have been deleted.
  assert.equal(await deps.blobStore.exists({ storageKey }), true);
  // The stale journal entry is drained either way (its job is done).
  assert.equal((await deps.journalRepo.list({ workspaceId: WORKSPACE_ID })).length, 0);
});

// ---------------------------------------------------------------------------
// Dedup resurrect-on-upload
// ---------------------------------------------------------------------------

test("uploadMedia resurrects a TOMBSTONED blob back to active instead of writing a duplicate", async () => {
  const { deps } = makeDeps();
  const { media: firstMedia } = await uploadOne(deps, "resurrect-me", "first.png");
  const sha256 = firstMedia.source.sha256;
  const blobBefore = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  const originalStorageKey = blobBefore!.storageKey;

  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: firstMedia.id });
  const tombstoneResult = await tombstoneBlobIfUnreferenced({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  assert.equal(tombstoneResult.tombstoned, true);

  const { media: secondMedia } = await uploadOne(deps, "resurrect-me", "second.png");
  assert.equal(secondMedia.source.sha256, sha256);

  const row = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  assert.equal(row!.status, "active");
  assert.equal(row!.tombstonedAt, undefined);
  assert.equal(row!.storageKey, originalStorageKey); // reused, not rewritten

  // The pending GC is genuinely cancelled: a delete-pass now refuses to run.
  const deletePassResult = await runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
  assert.equal(deletePassResult.deleted, false);
  assert.equal(deletePassResult.reason, "not-tombstoned");
});

// ---------------------------------------------------------------------------
// Adversarial: concurrent purge-vs-upload race on the same sha256
// ---------------------------------------------------------------------------

test("concurrent purge (delete-pass) racing an upload on the same sha256 never loses or orphans bytes, whichever wins the race", async () => {
  // Two independent workspaces' worth of scenario, run many times with
  // randomized micro-delays, to shake out ordering-dependent bugs instead of
  // relying on one lucky interleaving.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const { deps, setNow } = makeDeps();
    const { media } = await uploadOne(deps, `race-content-${attempt}`, "race.png");
    const sha256 = media.source.sha256;

    await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: media.id });
    await tombstoneBlobIfUnreferenced({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } });
    setNow(advance("2026-07-10T00:00:00.000Z", DEFAULT_GC_GRACE_MS + 1000));

    // Fire the delete-pass and a re-upload of the identical bytes "at the
    // same time" (both are queued microtasks racing on the same sha256 lock).
    const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() < 0.5 ? 0 : 1));
    const deletePass = jitter().then(() =>
      runBlobGcDeletePass({ deps, input: { workspaceId: WORKSPACE_ID, sha256 } })
    );
    const reupload = jitter().then(() => uploadOne(deps, `race-content-${attempt}`, "race-2.png"));

    await Promise.all([deletePass, reupload]);
    // Whichever ran first, drain any journal entry the delete-pass may have written.
    await runBlobGcUnlinkPass({ deps, input: { workspaceId: WORKSPACE_ID } });

    // Invariant, regardless of interleaving: exactly one live blob row for
    // this sha256, and its bytes are actually present in the store.
    const finalRow = await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
    assert.ok(finalRow, `attempt ${attempt}: expected a live blob row after the race`);
    assert.equal(finalRow!.status, "active");
    assert.equal(
      await deps.blobStore.exists({ storageKey: finalRow!.storageKey }),
      true,
      `attempt ${attempt}: blob row points at bytes that don't exist (orphaned row)`
    );

    // No leftover journal entries either way.
    assert.equal((await deps.journalRepo.list({ workspaceId: WORKSPACE_ID })).length, 0);
  }
});

// ---------------------------------------------------------------------------
// runBlobGcCycle — batch convenience over the last two phases
// ---------------------------------------------------------------------------

test("runBlobGcCycle deletes every eligible tombstoned blob and drains the journal in one call", async () => {
  const { deps, setNow } = makeDeps();
  const { media: mediaA } = await uploadOne(deps, "cycle-a", "a.png");
  const { media: mediaB } = await uploadOne(deps, "cycle-b", "b.png");

  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: mediaA.id });
  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: mediaB.id });
  await tombstoneBlobIfUnreferenced({ deps, input: { workspaceId: WORKSPACE_ID, sha256: mediaA.source.sha256 } });
  await tombstoneBlobIfUnreferenced({ deps, input: { workspaceId: WORKSPACE_ID, sha256: mediaB.source.sha256 } });
  setNow(advance("2026-07-10T00:00:00.000Z", DEFAULT_GC_GRACE_MS + 1000));

  const result = await runBlobGcCycle({ deps, input: { workspaceId: WORKSPACE_ID } });
  assert.deepEqual(result.deletedShas.sort(), [mediaA.source.sha256, mediaB.source.sha256].sort());
  assert.deepEqual(result.unlinked.sort(), [mediaA.source.sha256, mediaB.source.sha256].sort());

  assert.equal(await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: mediaA.source.sha256 }), null);
  assert.equal(await deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: mediaB.source.sha256 }), null);
});
