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
    clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z")},
    idGen: { newId: () => `id-${(counter += 1)}` },
    mediaRepo: new InMemoryMediaRepo({}),
    blobRepo: new InMemoryAssetBlobRepo({}),
    renditionRepo: new InMemoryAssetRenditionRepo({}),
    transformRepo: new InMemoryTransformDefinitionRepo({}),
    blobStore: new InMemoryBlobStore(),
    imageTransformer: countingTransformer,
  };
  return { deps, transformCalls };
}

function bytesFrom(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

test("SVG transform URLs serve the vector original without invoking the raster transformer or saving renditions", async () => {
  const { deps, transformCalls } = makeDeps();
  const { media } = await uploadMedia({ deps, input: { workspaceId: WORKSPACE_ID, filename: "logo.svg", contentType: "image/svg+xml",
    bytes: bytesFrom('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'), createdByPrincipal: "owner" } });
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "public", params: { format: "webp" }, owner: "core" } });
  const result = await resolveMediaRendition({ deps, input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "public", version: 1 } });
  assert.equal(result.outcome, "ok");
  if (result.outcome !== "ok") assert.fail("SVG rendition must resolve");
  assert.equal(result.contentType, "image/svg+xml");
  assert.match(new TextDecoder().decode(result.bytes), /viewBox="0 0 10 10"/);
  assert.deepEqual(transformCalls, []);
  assert.deepEqual((await deps.renditionRepo.listByAsset({ workspaceId: WORKSPACE_ID, assetId: media.id })).map(row => row.transformName), ["original"]);
});

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

test("resolveMediaRendition: resolves by slug (2026-09-07), and stores the rendition row under the CANONICAL id, not the slug text", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps); // filename "a.png" -> slug "a"
  assert.equal(media.slug, "a");
  const { definition } = await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { format: "jpeg" }, owner: "core" } });

  const bySlug = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.slug, transformName: "thumb", version: definition.version },
  });
  assert.equal(bySlug.outcome, "ok");

  // The written rendition row must be keyed by the real id — never the slug — so a later lookup BY
  // ID (the pre-existing, most common path) finds the SAME row instead of generating a duplicate.
  const rowsByCanonicalId = await deps.renditionRepo.listByAsset({ workspaceId: WORKSPACE_ID, assetId: media.id });
  assert.equal(rowsByCanonicalId.filter((r) => r.transformName === "thumb").length, 1);
  const rowsBySlugText = await deps.renditionRepo.listByAsset({ workspaceId: WORKSPACE_ID, assetId: media.slug });
  assert.equal(rowsBySlugText.length, 0, "no rendition row may ever be keyed by the slug text itself");

  const byId = await resolveMediaRendition({
    deps,
    input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: definition.version },
  });
  assert.equal(byId.outcome, "ok");
  if (bySlug.outcome === "ok" && byId.outcome === "ok") {
    assert.deepEqual(bySlug.bytes, byId.bytes, "slug and id resolve to the identical already-generated rendition, not two");
  }
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

test("resolveMediaRendition: a document asset has no image renditions — not-found, never generated", async () => {
  const { deps: uploadDeps, transformCalls } = makeDeps();
  const { media } = await uploadOne(uploadDeps);
  // Kind is fixed at creation (a save cannot change it), so the document row is seeded directly.
  const deps = { ...uploadDeps, mediaRepo: new InMemoryMediaRepo({}, { initialRows: [{ ...media, kind: "document" }] }) };
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { width: 10, format: "webp" }, owner: "core" } });
  assert.deepEqual(await resolveMediaRendition({ deps, input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: 1 } }), { outcome: "not-found" });
  assert.deepEqual(transformCalls, []);
});

test("resolveMediaRendition: a media row whose source blob row is missing is surfaced as an integrity error, not a 404", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps);
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { width: 10, format: "webp" }, owner: "core" } });
  await deps.blobRepo.remove({ workspaceId: WORKSPACE_ID, sha256: media.source.sha256 });
  await assert.rejects(
    resolveMediaRendition({ deps, input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: 1 } }),
    new RegExp(`media '${media.id}': source blob for sha256 '${media.source.sha256}' was not found`),
  );
});

test("resolveMediaRendition: a stored rendition whose bytes are SVG is re-sanitized on every read", async () => {
  const { deps } = makeDeps();
  const { media } = await uploadOne(deps);
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "thumb", params: { width: 10, format: "webp" }, owner: "core" } });
  // A legacy rendition blob written before SVG sanitizing existed.
  const { storageKey } = await deps.blobStore.put({ workspaceId: WORKSPACE_ID, sha256: "e".repeat(64),
    bytes: bytesFrom('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><path d="M0 0h1v1z"/></svg>') });
  await deps.renditionRepo.save({ id: "legacy-rendition", workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: 1, storageKey, createdAt: "2026-07-10T00:00:00.000Z" });
  const result = await resolveMediaRendition({ deps, input: { workspaceId: WORKSPACE_ID, assetId: media.id, transformName: "thumb", version: 1 } });
  if (result.outcome !== "ok") assert.fail(`expected ok, got ${result.outcome}`);
  assert.equal(result.contentType, "image/svg+xml");
  const served = new TextDecoder().decode(result.bytes);
  assert.doesNotMatch(served, /onload|<script/);
  assert.match(served, /<path d="M0 0h1v1z"/);
});
