/** Post-write size/hash check: a blob the store did not keep intact is never named by a row. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { BlobWriteMismatchError } from "../blob-gc-fence.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { uploadMedia } from "../media-service.js";
import type { PutBlobInput } from "../ports.js";
import { createSharedWorld, WS } from "./support/blob-fence-harness.js";

class TruncatingBlobStore extends InMemoryBlobStore {
  override async put(input: PutBlobInput) { return super.put({ ...input, bytes: input.bytes.slice(0, -1) }); }
}

test("a short write is refused before any row names the bytes", async () => {
  const world = createSharedWorld();
  let n = 0;
  const upload = uploadMedia({ deps: { clock: world.clock, idGen: { newId: () => `id-${++n}` }, mediaRepo: world.mediaRepo, blobRepo: world.blobRepo,
    renditionRepo: world.renditionRepo, blobStore: new TruncatingBlobStore(), blobFence: world.gc() },
  input: { workspaceId: WS, filename: "a.png", bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", createdByPrincipal: "u" } });
  await assert.rejects(upload, BlobWriteMismatchError);
  assert.deepEqual(await world.mediaRepo.list({ workspaceId: WS }), []);
  assert.equal(await world.blobRepo.findByHash({ workspaceId: WS, sha256: createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex") }), null);
});
