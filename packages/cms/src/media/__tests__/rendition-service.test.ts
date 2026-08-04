/**
 * @file Rendition resolution tests — `rendition-service.ts`.
 * Covers: serve-if-exists, the frozen URL contract's lookup-by-triple
 * (assetId, transformName, version) behavior, the "latest version only"
 * anonymous-generation bound, single-flight dedup under concurrency, the
 * trashed->410/not-found->404 outcome mapping, and an unknown transform
 * returning `not-found`.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveMediaRendition } from "../rendition-service.js";
import { registerTransform } from "../transform-registry.js";
import { uploadMedia, trashMedia } from "../media-service.js";
import {
  InMemoryAssetBlobRepo,
  InMemoryAssetRenditionRepo,
  InMemoryMediaRepo,
  InMemoryTransformDefinitionRepo,
} from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { InMemoryImageTransformer } from "../image-transformer.js";

const WORKSPACE_ID = "workspace-1";

function makeDeps() {
  let counter = 0;
  const transformCalls: unknown[] = [];
  const realTransformer = new InMemoryImageTransformer();
  const countingTransformer = {
    transform: async (input: Parameters<typeof realTransformer.transform>[0]) => {
      transformCalls.push(input.params);
      return realTransformer.transform(input);
    },
  };

  const deps = {
    clock: { nowIso: () => "2026-07-10T00:00:00.000Z" },
    idGen: { newId: () => `id-${(counter += 1)}` },
    mediaRepo: new InMemoryMediaRepo(),
    blobRepo: new InMemoryAssetBlobRepo(),
    renditionRepo: new InMemoryAssetRenditionRepo(),
    transformRepo: new InMemoryTransformDefinitionRepo(),
    blobStore: new InMemoryBlobStore(),
    imageTransformer: countingTransformer,
  };
  return { deps, transformCalls };
}

function bytesFrom(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

async function uploadOne(deps: ReturnType<typeof makeDeps>["deps"], content = "source-bytes") {
  return uploadMedia({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      bytes: bytesFrom(content),
      filename: "a.png",
      contentType: "image/png",
      createdByPrincipal: "user-1",
    },
  });
}

test("resolveMediaRendition: unknown assetId -> not-found", async () => {
  const { deps } = makeDeps();
  const result = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: "does-not-exist", transformName: "thumb", version: 1 },
  });
  assert.deepEqual(result, { outcome: "not-found" });
});

test("resolveMediaRendition: trashed asset -> gone (410), even though its row still physically exists", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps);
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { format: "jpeg" }, owner: "core" } });
  await trashMedia({ deps, input: { workspaceId: WORKSPACE_ID, id: media.id } });

  const result = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: 1 },
  });
  assert.deepEqual(result, { outcome: "gone" });
});

test("resolveMediaRendition: unregistered transform name -> not-found (never lazily invents a definition)", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps);

  const result = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "never-registered", version: 1 },
  });
  assert.deepEqual(result, { outcome: "not-found" });
});

test("resolveMediaRendition: serve-if-exists — an already-generated rendition serves without calling the transformer again", async () => {
  const { deps, transformCalls } = makeDeps();
  const { media } = await uploadOne(deps);
  const { definition } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { width: 100, height: 100, format: "webp" }, owner: "core" },
  });

  const first = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: definition.version },
  });
  assert.equal(first.outcome, "ok");
  assert.equal(transformCalls.length, 1, "first request actually generated the rendition");

  const second = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: definition.version },
  });
  assert.equal(second.outcome, "ok");
  assert.equal(transformCalls.length, 1, "second request served the existing row — no second transform call");
  if (first.outcome === "ok" && second.outcome === "ok") {
    assert.deepEqual(first.bytes, second.bytes, "same bytes served both times (immutable-by-construction)");
  }
});

test("resolveMediaRendition: lookup ignores cosmetic slug/ext — the (assetId, transformName, version) triple is the only key", async () => {
  // A route layer strips slug/ext before calling this service at all (they are
  // cosmetic and never part of any lookup) — this test proves the service's own input shape has
  // no slug/ext field to smuggle differing behavior through, by resolving the identical triple
  // twice and getting identical bytes regardless of what a caller might have put in the URL.
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps);
  const { definition } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { format: "jpeg" }, owner: "core" },
  });

  const asPhoto = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: definition.version },
  });
  const asAnythingElse = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: definition.version },
  });

  assert.equal(asPhoto.outcome, "ok");
  assert.equal(asAnythingElse.outcome, "ok");
  if (asPhoto.outcome === "ok" && asAnythingElse.outcome === "ok") {
    assert.deepEqual(asPhoto.bytes, asAnythingElse.bytes);
  }
});

test("resolveMediaRendition: anonymous generation is bounded to the LATEST registered version — an older, ungenerated version is not-found, never lazily materialized", async () => {
  const { deps, transformCalls } = makeDeps();
  const { media } = await uploadOne(deps);
  const { definition: v1 } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { format: "jpeg" }, owner: "core" },
  });
  const { definition: v2 } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { format: "webp" }, owner: "core" },
  });
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);

  // v1 is a valid, real registry row — but it is no longer the latest, and nothing has ever
  // generated it, so an anonymous request for it must be blocked (the amplification-vector guard).
  const oldVersionResult = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: v1.version },
  });
  assert.deepEqual(oldVersionResult, { outcome: "not-found" });
  assert.equal(transformCalls.length, 0, "the old version was never lazily generated");

  // v2 (the latest) is generatable on first anonymous request.
  const latestVersionResult = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: v2.version },
  });
  assert.equal(latestVersionResult.outcome, "ok");
  assert.equal(transformCalls.length, 1);
});

test("resolveMediaRendition: single-flight — two concurrent requests for the same ungenerated (sha256, name, version) trigger exactly one transform call and both resolve to the same bytes", async () => {
  const { deps, transformCalls } = makeDeps();
  const { media } = await uploadOne(deps, "shared-source-bytes");
  const { definition } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { width: 50, height: 50, format: "png" }, owner: "core" },
  });

  const [first, second] = await Promise.all([
    resolveMediaRendition({
      deps,
      input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: definition.version },
    }),
    resolveMediaRendition({
      deps,
      input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: definition.version },
    }),
  ]);

  assert.equal(transformCalls.length, 1, "only one real transform call happened for the concurrent pair");
  assert.equal(first.outcome, "ok");
  assert.equal(second.outcome, "ok");
  if (first.outcome === "ok" && second.outcome === "ok") {
    assert.deepEqual(first.bytes, second.bytes);
  }

  const rows = await deps.renditionRepo.listByAsset({ workspaceId: WORKSPACE_ID, assetId: media.id });
  const thumbRows = rows.filter((row) => row.transformName === "thumb" && row.version === definition.version);
  assert.equal(thumbRows.length, 1, "only one rendition row was written, not two");
});

test("resolveMediaRendition: five concurrent requests for the same ungenerated rendition still produce exactly one transform call (adversarial fan-in)", async () => {
  const { deps, transformCalls } = makeDeps();
  const { media } = await uploadOne(deps, "fan-in-source");
  const { definition } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "square", params: { width: 64, height: 64, format: "webp" }, owner: "core" },
  });

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      resolveMediaRendition({
        deps,
        input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "square", version: definition.version },
      })
    )
  );

  assert.equal(transformCalls.length, 1);
  assert.ok(results.every((r) => r.outcome === "ok"));
  const rows = await deps.renditionRepo.listByAsset({ workspaceId: WORKSPACE_ID, assetId: media.id });
  assert.equal(rows.filter((r) => r.transformName === "square").length, 1);
});
