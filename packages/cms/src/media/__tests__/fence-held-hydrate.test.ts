/** Seed hydration under the cross-process blob fence: each seed file is written while its key is fenced. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { computeBlobStorageKey } from "../blob-key.js";
import { hydrateBlobStoreFromSeed } from "../site/hydrate-blob-store-from-seed.js";
import { createSharedWorld, recordHeldKeys, WS } from "./support/blob-fence-harness.js";

test("seed hydration holds the blob fence across write and publish", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jini-hydrate-fence-"));
  try {
    const bytes = new Uint8Array([7, 7, 7]);
    const storageKey = computeBlobStorageKey({ workspaceId: WS, sha256: createHash("sha256").update(bytes).digest("hex") });
    await mkdir(dirname(join(dir, ...storageKey.split("/"))), { recursive: true });
    await writeFile(join(dir, ...storageKey.split("/")), bytes);
    const world = createSharedWorld();
    const log: Array<{ call: string; held: string[] }> = [];
    recordHeldKeys(world.kernel, world.blobStore, ["put", "putIfAbsent"], log);
    const result = await hydrateBlobStoreFromSeed({ seedUploadsDir: dir, blobStore: world.blobStore, blobFence: world.gc() });
    assert.equal(result.copied, 1);
    assert.deepEqual(log, [{ call: "putIfAbsent", held: [`blob:${WS}:${storageKey}`] }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
