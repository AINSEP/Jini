/** Rendition generation under the cross-process blob fence, keyed by the output bytes. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryImageTransformer } from "../image-transformer.js";
import { uploadMedia } from "../media-service.js";
import { resolveMediaRendition } from "../rendition-service.js";
import { InMemoryTransformDefinitionRepo } from "../repo.memory.js";
import { registerTransform } from "../transform-registry.js";
import { createSharedWorld, recordHeldKeys, WS } from "./support/blob-fence-harness.js";

test("rendition generation holds the blob fence across write and publish", async () => {
  const world = createSharedWorld();
  let n = 0;
  const deps = { clock: world.clock, idGen: { newId: () => `id-${++n}` }, mediaRepo: world.mediaRepo, blobRepo: world.blobRepo, renditionRepo: world.renditionRepo,
    transformRepo: new InMemoryTransformDefinitionRepo({}), blobStore: world.blobStore, imageTransformer: new InMemoryImageTransformer(), blobFence: world.gc() };
  const { media } = await uploadMedia({ deps, input: { workspaceId: WS, filename: "a.png", bytes: new Uint8Array([1]), contentType: "image/png", createdByPrincipal: "u" } });
  const { definition } = await registerTransform({ deps, input: { workspaceId: WS, name: "thumb", params: { format: "jpeg" }, owner: "core" } });
  const log: Array<{ call: string; held: string[] }> = [];
  recordHeldKeys(world.kernel, world.blobStore, ["put", "putIfAbsent"], log);
  recordHeldKeys(world.kernel, world.renditionRepo, ["save"], log);
  const result = await resolveMediaRendition({ deps, input: { workspaceId: WS, assetId: media.id, transformName: "thumb", version: definition.version } });
  assert.equal(result.outcome, "ok");
  const [row] = (await world.renditionRepo.listByAsset({ workspaceId: WS, assetId: media.id })).filter((r) => r.transformName === "thumb");
  assert.deepEqual(log.map((entry) => entry.call).sort(), ["put", "save"]);
  for (const entry of log) assert.deepEqual(entry.held, [`blob:${WS}:${row?.storageKey}`], entry.call);
});
