import assert from "node:assert/strict";
import { passthroughBlobFence } from "../../__tests__/support/passthrough-blob-fence.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";

import { computeBlobStorageKey, InMemoryBlobStore, type PutBlobInput } from "../../index.js";

import { hydrateBlobStoreFromSeed } from "../hydrate-blob-store-from-seed.js";

/**
 * @file Proves `hydrateBlobStoreFromSeed()` — the fix for the production incident this pair of
 * files exists to close: `content.seed.db` ships real `media`/`asset_blobs` ROWS on first boot
 * (`hydrate-content-db-from-seed.ts`), but nothing ever shipped the BYTES those rows'
 * `storage_key`s point at, so every admin-media preview 500'd against a real row and a missing
 * file. See `hydrate-blob-store-from-seed.ts`'s own file header for the full incident writeup and
 * design rationale (per-key gate vs. whole-directory gate, `BlobStorePort` vs. raw filesystem).
 *
 * The first test below is deliberately written to assert the FAILURE state first —
 * `blobStore.exists()` returning `false` for a seeded key is exactly the condition that makes the
 * real admin route (`server/inbound/admin-http/routes/media/original.ts`) 500 — before hydrating,
 * so the fix this function provides is visible in the test itself, not just asserted by name.
 */

/** One seed blob file, written under `ws/{workspaceId}/blobs/{sha256[0..1]}/{sha256}`. */
async function writeSeedBlob(
  seedUploadsDir: string,
  input: { workspaceId: string; bytes: Uint8Array }
): Promise<{ workspaceId: string; sha256: string; storageKey: string }> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const storageKey = computeBlobStorageKey({ workspaceId: input.workspaceId, sha256 });
  const filePath = join(seedUploadsDir, ...storageKey.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, input.bytes);
  return { workspaceId: input.workspaceId, sha256, storageKey };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "jini-hydrate-blob-seed-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A `BlobStorePort` double that deterministically injects a concurrent writer's write into the
 * exact TOCTOU gap `hydrateBlobStoreFromSeed()` used to have: `armConcurrentWrite()` arms a
 * one-shot write that lands the moment `exists()` resolves or, once armed, the moment
 * `putIfAbsent()` performs its own atomic check-and-set — modeling a real uploader's `put()`
 * completing in the window between the hydrator's own existence check and its own write.
 *
 * This makes the race reproducible on demand instead of depending on real timing (flaky, and slow
 * to trigger reliably): the OLD `exists()`-then-`put()` hydrator sees the key absent at check time,
 * then unconditionally overwrites whatever landed in between; the FIXED hydrator only ever issues
 * the single atomic `putIfAbsent()` call, which observes the concurrent write before deciding
 * whether to write and correctly backs off.
 */
class RaceInjectingBlobStore {
  private readonly bytesByKey = new Map<string, Uint8Array>();
  private pendingConcurrentWrite: { storageKey: string; bytes: Uint8Array } | undefined;

  armConcurrentWrite(storageKey: string, bytes: Uint8Array): void {
    this.pendingConcurrentWrite = { storageKey, bytes };
  }

  private landPendingWriteIfArmed(): void {
    if (!this.pendingConcurrentWrite) return;
    const { storageKey, bytes } = this.pendingConcurrentWrite;
    this.pendingConcurrentWrite = undefined;
    this.bytesByKey.set(storageKey, bytes);
  }

  /** Mirrors the OLD hydrator's first half of the racy pair: check, THEN let the race land. */
  async exists(input: { storageKey: string }): Promise<boolean> {
    const existedAtCheckTime = this.bytesByKey.has(input.storageKey);
    this.landPendingWriteIfArmed();
    return existedAtCheckTime;
  }

  /** Mirrors the OLD hydrator's second half: an unconditional overwrite, exactly like
   *  the local and s3-compatible object stores' real unconditional `put()`. */
  async put(input: PutBlobInput): Promise<{ storageKey: string }> {
    const storageKey = computeBlobStorageKey(input);
    this.bytesByKey.set(storageKey, input.bytes);
    return { storageKey };
  }

  /** The FIXED path: one atomic call. Any armed concurrent write is modeled as landing
   *  immediately before this call's own check-and-set, same as a real `"wx"`/`If-None-Match`
   *  primitive would observe a competing writer's request that completed microseconds earlier. */
  async putIfAbsent(input: PutBlobInput): Promise<{ storageKey: string; written: boolean }> {
    const storageKey = computeBlobStorageKey(input);
    this.landPendingWriteIfArmed();
    if (this.bytesByKey.has(storageKey)) {
      return { storageKey, written: false };
    }
    this.bytesByKey.set(storageKey, input.bytes);
    return { storageKey, written: true };
  }

  async get(input: { storageKey: string }): Promise<Uint8Array> {
    const bytes = this.bytesByKey.get(input.storageKey);
    if (!bytes) throw new Error(`blob '${input.storageKey}' was not found`);
    return bytes;
  }
}

test("hydrateBlobStoreFromSeed: no-op when the seed payload does not exist", async () => {
  await withTempDir(async (dir) => {
    const store = new InMemoryBlobStore();
    const result = await hydrateBlobStoreFromSeed({
      seedUploadsDir: join(dir, "absent-uploads"),
      blobStore: store,
      blobFence: passthroughBlobFence,
    });
    assert.equal(result.status, "no-seed-source");
    assert.equal(result.copied, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(result.failed, []);
  });
});

test("hydrateBlobStoreFromSeed: fills in a missing blob — reproduces the failure, then the fix", async () => {
  await withTempDir(async (dir) => {
    const workspaceId = `ws-${randomUUID()}`;
    const bytes = new TextEncoder().encode("stock seed image bytes");
    const seeded = await writeSeedBlob(dir, { workspaceId, bytes });

    const store = new InMemoryBlobStore();

    // FAILURE STATE — this is exactly what makes `original.ts` throw and turn into the admin
    // preview's 500: the row's storage key resolves to nothing in the live store.
    assert.equal(
      await store.exists({ storageKey: seeded.storageKey }),
      false,
      "precondition: the live store must NOT have this blob yet — otherwise this test would not be exercising the bug"
    );

    const result = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });

    assert.equal(result.status, "seeded");
    assert.equal(result.copied, 1);
    assert.equal(result.skipped, 0);
    assert.deepEqual(result.failed, []);

    // THE FIX — the exact same lookup the admin route performs now succeeds, with the exact bytes.
    assert.equal(await store.exists({ storageKey: seeded.storageKey }), true);
    // `Buffer.from(...)` on both sides: `readFile` returns a `Buffer` (a `Uint8Array` subclass),
    // and strict `deepEqual` treats a differing constructor as unequal even with identical bytes.
    assert.deepEqual(Buffer.from(await store.get({ storageKey: seeded.storageKey })), Buffer.from(bytes));
  });
});

test("hydrateBlobStoreFromSeed: never overwrites a key that already exists in the live store", async () => {
  await withTempDir(async (dir) => {
    const workspaceId = `ws-${randomUUID()}`;
    const seedBytes = new TextEncoder().encode("stock seed bytes — must never land here");
    const seeded = await writeSeedBlob(dir, { workspaceId, bytes: seedBytes });

    const store = new InMemoryBlobStore();
    const realBytes = new TextEncoder().encode("real bytes already in the live store");
    // Same sha256 the seed file was written under, but pre-populated with DIFFERENT bytes — this
    // can only happen if content differs from what its own hash implies, which is exactly why the
    // gate must be "does this key already exist", not "do the bytes match" — the function has no
    // way to know which content is the "right" one for a given key, so it must never guess.
    await store.put({ workspaceId, sha256: seeded.sha256, bytes: realBytes });

    const result = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });

    assert.equal(result.status, "already-present");
    assert.equal(result.copied, 0);
    assert.equal(result.skipped, 1);
    assert.deepEqual(
      await store.get({ storageKey: seeded.storageKey }),
      realBytes,
      "the pre-existing bytes must be left exactly as they were — not clobbered by the seed"
    );
  });
});

test("hydrateBlobStoreFromSeed: is a no-op on a second run once the store already caught up", async () => {
  await withTempDir(async (dir) => {
    const workspaceId = `ws-${randomUUID()}`;
    const bytes = new TextEncoder().encode("only copied once");
    await writeSeedBlob(dir, { workspaceId, bytes });

    const store = new InMemoryBlobStore();

    const first = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });
    assert.equal(first.status, "seeded");
    assert.equal(first.copied, 1);

    // Simulates a later redeploy against the SAME (already-populated) volume — this must never
    // re-copy, matching `hydrateContentDbFromSeed`'s own "never touch it again" guarantee applied
    // per-key instead of per-file.
    const second = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });
    assert.equal(second.status, "already-present");
    assert.equal(second.copied, 0);
    assert.equal(second.skipped, 1);
  });
});

test("hydrateBlobStoreFromSeed: a malformed seed entry is reported, not thrown, and does not block a valid sibling", async () => {
  await withTempDir(async (dir) => {
    const workspaceId = `ws-${randomUUID()}`;
    const goodBytes = new TextEncoder().encode("this one is well-formed");
    const seeded = await writeSeedBlob(dir, { workspaceId, bytes: goodBytes });

    // A stray file that does not match `ws/{workspaceId}/blobs/{shard}/{sha256}` — e.g. a
    // README or a leftover from an unrelated tool. Must not crash the whole hydration run.
    await mkdir(join(dir, "ws", workspaceId), { recursive: true });
    await writeFile(join(dir, "ws", workspaceId, "not-a-blob.txt"), "unrelated file");

    const store = new InMemoryBlobStore();
    const result = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });

    assert.equal(result.status, "partial");
    assert.equal(result.copied, 1);
    assert.equal(result.failed.length, 1);
    const [failure] = result.failed;
    assert.ok(failure);
    assert.match(failure.relativePath, /not-a-blob\.txt$/);
    assert.deepEqual(Buffer.from(await store.get({ storageKey: seeded.storageKey })), Buffer.from(goodBytes));
  });
});

test("hydrateBlobStoreFromSeed: REGRESSION — a concurrent production write landing in the exists->put gap must survive, not be clobbered by the seed", async () => {
  await withTempDir(async (dir) => {
    const workspaceId = `ws-${randomUUID()}`;
    const seedBytes = new TextEncoder().encode("stock seed bytes — must never win this race");
    const seeded = await writeSeedBlob(dir, { workspaceId, bytes: seedBytes });

    const store = new RaceInjectingBlobStore();
    const productionBytes = new TextEncoder().encode("real uploader's bytes, written mid-race");
    // Arms a write that lands exactly inside the window this function's own check-then-act used to
    // leave open — see `RaceInjectingBlobStore`'s own doc for exactly which call it fires on.
    store.armConcurrentWrite(seeded.storageKey, productionBytes);

    await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });

    // Against the OLD exists()-then-put() implementation this fails: exists() observes the key
    // absent (the race hasn't landed yet), the concurrent write then lands, and the hydrator's own
    // put() unconditionally overwrites it with the stock seed bytes. Against the FIXED
    // putIfAbsent()-only implementation, the concurrent write lands as part of the SAME atomic call
    // that decides whether to write, so it is observed and the seed write correctly backs off.
    assert.deepEqual(
      Buffer.from(await store.get({ storageKey: seeded.storageKey })),
      Buffer.from(productionBytes),
      "a real write that lands during hydration must survive — the seed must never clobber it"
    );
  });
});

/** A `BlobStorePort` double whose `putIfAbsent()` throws for one specific storage key — models a
 *  real backend failure (e.g. the s3-compatible object-store provider hitting a transient write error) mid-run, distinct from
 *  the "malformed path" failure mode covered above. */
class ThrowingBlobStore extends InMemoryBlobStore {
  constructor(private readonly failingStorageKey: string) {
    super();
  }

  override async putIfAbsent(input: PutBlobInput): Promise<{ storageKey: string; written: boolean }> {
    const storageKey = computeBlobStorageKey(input);
    if (storageKey === this.failingStorageKey) {
      throw new Error("simulated backend failure");
    }
    return super.putIfAbsent(input);
  }
}

test("hydrateBlobStoreFromSeed: a putIfAbsent failure for one file is reported, not thrown, and does not block a valid sibling", async () => {
  await withTempDir(async (dir) => {
    const workspaceId = `ws-${randomUUID()}`;
    const goodBytes = new TextEncoder().encode("this one writes fine");
    const badBytes = new TextEncoder().encode("this one's store write fails");
    const seededGood = await writeSeedBlob(dir, { workspaceId, bytes: goodBytes });
    const seededBad = await writeSeedBlob(dir, { workspaceId, bytes: badBytes });

    const store = new ThrowingBlobStore(seededBad.storageKey);
    const result = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });

    assert.equal(result.status, "partial");
    assert.equal(result.copied, 1);
    assert.equal(result.failed.length, 1);
    const [failure] = result.failed;
    assert.ok(failure);
    assert.match(failure.relativePath, new RegExp(`${seededBad.sha256}$`));
    assert.match(failure.error, /simulated backend failure/);
    assert.deepEqual(
      Buffer.from(await store.get({ storageKey: seededGood.storageKey })),
      Buffer.from(goodBytes),
      "one file's store failure must not block a valid sibling from being copied"
    );
  });
});

/** A `BlobStorePort` double whose `putIfAbsent()` rejects with a non-`Error` value (a bare string) —
 *  covers the `String(err)` arm of `resolveOneSeedBlob`'s `err instanceof Error ? ... : String(err)`
 *  branch, distinct from {@link ThrowingBlobStore}'s real-`Error` rejection above. */
class NonErrorThrowingBlobStore extends InMemoryBlobStore {
  override async putIfAbsent(_input: PutBlobInput): Promise<{ storageKey: string; written: boolean }> {
    throw "simulated non-Error rejection";
  }
}

test("hydrateBlobStoreFromSeed: a putIfAbsent rejection with a non-Error value is still reported, not thrown", async () => {
  await withTempDir(async (dir) => {
    const workspaceId = `ws-${randomUUID()}`;
    await writeSeedBlob(dir, { workspaceId, bytes: new TextEncoder().encode("bytes") });

    const store = new NonErrorThrowingBlobStore();
    const result = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: store, blobFence: passthroughBlobFence });

    assert.equal(result.status, "partial");
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0]?.error, "simulated non-Error rejection");
  });
});

test("hydrateBlobStoreFromSeed: an unreadable seed directory (not merely absent) fails loudly instead of skipping", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jini-seed-uploads-notdir-"));
  try {
    const seedUploadsDir = join(dir, "uploads");
    await writeFile(seedUploadsDir, "a file where the seed directory should be");
    const store = new InMemoryBlobStore();
    await assert.rejects(hydrateBlobStoreFromSeed({ seedUploadsDir, blobStore: store, blobFence: passthroughBlobFence }), (err: NodeJS.ErrnoException) => err.code === "ENOTDIR");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
