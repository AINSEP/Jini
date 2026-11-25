/** replaceMediaFile under the cross-process blob fence: the new bytes and the atomic source switch. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { computeBlobStorageKey } from "../blob-key.js";
import { uploadMedia } from "../media-service.js";
import { replaceMediaFile } from "../replace-media-file.js";
import { createSharedWorld, recordHeldKeys, WS } from "./support/blob-fence-harness.js";

const NEW_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const NEW_KEY = computeBlobStorageKey({ workspaceId: WS, sha256: createHash("sha256").update(NEW_BYTES).digest("hex") });

test("replaceMediaFile holds the blob fence across write and publish", async () => {
  const world = createSharedWorld();
  let n = 0;
  const idGen = { newId: () => `id-${++n}` };
  const { media } = await uploadMedia({ deps: { clock: world.clock, idGen, mediaRepo: world.mediaRepo, blobRepo: world.blobRepo, renditionRepo: world.renditionRepo, blobStore: world.blobStore, blobFence: world.gc() },
    input: { workspaceId: WS, filename: "a.png", bytes: new Uint8Array([1]), contentType: "image/png", createdByPrincipal: "u" } });
  const mediaRepo = Object.assign(world.mediaRepo, { replaceFileIfVersion: async () => ({ applied: true }), saveRenditionIfSource: async () => ({ applied: true }) });
  const log: Array<{ call: string; held: string[] }> = [];
  recordHeldKeys(world.kernel, world.blobStore, ["put", "putIfAbsent"], log);
  recordHeldKeys(world.kernel, world.blobRepo, ["save"], log);
  recordHeldKeys(world.kernel, mediaRepo, ["replaceFileIfVersion"], log);
  const replaced = await replaceMediaFile({ deps: { workspaceId: WS, clock: world.clock, idGen, mediaRepo, assetBlobRepo: world.blobRepo, blobStore: world.blobStore, blobFence: world.gc() },
    media, bytes: NEW_BYTES, contentType: "image/jpeg", principalId: "u" });
  assert.equal(replaced?.source.sha256, createHash("sha256").update(NEW_BYTES).digest("hex"));
  assert.deepEqual(log.map((entry) => entry.call).sort(), ["put", "replaceFileIfVersion", "save"]);
  for (const entry of log) assert.deepEqual(entry.held, [`blob:${WS}:${NEW_KEY}`], entry.call);
});
