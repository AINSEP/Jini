/** uploadMedia (claimUploadBlob) under the cross-process blob fence: bytes and the rows that own them. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { computeBlobStorageKey } from "../blob-key.js";
import { uploadMedia } from "../media-service.js";
import { createSharedWorld, recordHeldKeys, WS } from "./support/blob-fence-harness.js";

const BYTES = new Uint8Array([1]);
const KEY = computeBlobStorageKey({ workspaceId: WS, sha256: createHash("sha256").update(BYTES).digest("hex") });

test("uploadMedia holds the blob fence across write and publish", async () => {
  const world = createSharedWorld();
  const log: Array<{ call: string; held: string[] }> = [];
  recordHeldKeys(world.kernel, world.blobStore, ["put", "putIfAbsent"], log);
  recordHeldKeys(world.kernel, world.blobRepo, ["save"], log);
  recordHeldKeys(world.kernel, world.mediaRepo, ["save"], log);
  recordHeldKeys(world.kernel, world.renditionRepo, ["save"], log);
  let n = 0;
  await uploadMedia({ deps: { clock: world.clock, idGen: { newId: () => `id-${++n}` }, mediaRepo: world.mediaRepo, blobRepo: world.blobRepo,
    renditionRepo: world.renditionRepo, blobStore: world.blobStore, blobFence: world.gc() },
  input: { workspaceId: WS, filename: "a.png", bytes: BYTES, contentType: "image/png", createdByPrincipal: "u" } });
  assert.deepEqual(log.map((entry) => entry.call).sort(), ["put", "save", "save", "save"]);
  for (const entry of log) assert.deepEqual(entry.held, [`blob:${WS}:${KEY}`], entry.call);
});
