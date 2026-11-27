import { ToolInputError } from "@jini-ai/core";
import { MediaConflictError } from "../../types.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryBlobStore, InMemoryMediaRepo, uploadMedia } from "../../index.js";
import { contributeMediaDuplicateHandlers, duplicateMediaAsset } from "../duplicate-asset.js";

/**
 * @file Why: `content_duplicate` re-uploads the source's bytes through `uploadMedia`, so it must pick the
 * cap by the file's TYPE like every other write path — a 500 MiB video that was legitimately uploaded
 * must be copyable, while an image still stops at the general cap. Omitting the video cap must leave
 * other hosts exactly as before (video follows the general cap).
 */

const MIB = 1024 * 1024;
const WORKSPACE_ID = "ws-duplicate-cap";
const GENERAL_CAP = 50 * MIB;
const VIDEO_CAP = 500 * MIB;
const SIZE = 60 * MIB;

function mp4Bytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 16], 0);
  bytes.set(Buffer.from("ftypisom"), 4);
  return bytes;
}

function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function makeDeps() {
  let n = 0;
  return {
    authorize: async () => ({ allowed: true, reason: "fixture" }), workspaceId: WORKSPACE_ID,
    createHash, clock: { nowMs: () => Date.parse("2026-11-25T00:00:00.000Z"), nowIso: () => "2026-11-25T00:00:00.000Z" },
    idGen: { newId: () => `id-${++n}` },
    mediaRepo: new InMemoryMediaRepo({}), assetBlobRepo: new InMemoryAssetBlobRepo({}),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}), blobStore: new InMemoryBlobStore(),
  };
}

/** Seed a source asset with caps wide enough for the fixture, so only the duplicate's own cap is under test. */
async function seed({ bytes, contentType }: { bytes: Uint8Array; contentType: string }) {
  const deps = makeDeps();
  const { media } = await uploadMedia({
    deps: { createHash, clock: deps.clock, idGen: deps.idGen, mediaRepo: deps.mediaRepo, blobRepo: deps.assetBlobRepo,
      renditionRepo: deps.assetRenditionRepo, blobStore: deps.blobStore },
    input: { workspaceId: WORKSPACE_ID, bytes, filename: "source", contentType, alt: "", caption: "", credit: "", createdByPrincipal: "p" },
  }, { maxUploadBytes: VIDEO_CAP, maxVideoUploadBytes: VIDEO_CAP });
  return { deps, source: media };
}

function duplicate({ deps, source, caps }: { deps: ReturnType<typeof makeDeps>; source: { id: string }; caps: { maxUploadBytes?: number; maxVideoUploadBytes?: number } }) {
  return duplicateMediaAsset({
    routeDeps: deps as never, deriveDuplicateName: async ({ sourceName }) => `${sourceName} copy`,
    principalId: "p", id: source.id, overrides: {}, ...caps,
  });
}

test("a 60 MiB video duplicates when the host gives the video cap", async () => {
  const { deps, source } = await seed({ bytes: mp4Bytes(SIZE), contentType: "video/mp4" });
  const result = await duplicate({ deps, source, caps: { maxUploadBytes: GENERAL_CAP, maxVideoUploadBytes: VIDEO_CAP } });
  assert.notEqual((result.media as { id: string }).id, source.id);
});

test("a 60 MiB image is still refused at the general cap even when a video cap is given", async () => {
  const { deps, source } = await seed({ bytes: pngBytes(SIZE), contentType: "image/png" });
  await assert.rejects(duplicate({ deps, source, caps: { maxUploadBytes: GENERAL_CAP, maxVideoUploadBytes: VIDEO_CAP } }));
});

test("without a video cap a 60 MiB video is refused at the general 50 MiB cap (other hosts unchanged)", async () => {
  const { deps, source } = await seed({ bytes: mp4Bytes(SIZE), contentType: "video/mp4" });
  await assert.rejects(duplicate({ deps, source, caps: {} }));
});

test("the contributor applies copy-specific metadata and rolls back a rejected slug without losing shared bytes", async () => {
  const { deps, source } = await seed({ bytes: pngBytes(8), contentType: "image/png" });
  const [contribution] = contributeMediaDuplicateHandlers({ deriveDuplicateName: async ({ sourceName }) => `${sourceName} copy` });
  assert.equal(contribution?.resource, "media");
  const handler = contribution!.build(deps);
  assert.equal(handler.permission, "media.upload");
  const copy = (overrides: { slug?: string; title?: string; status?: string }) =>
    handler.duplicate({ principalId: "new-owner", id: source.id, overrides });
  await assert.rejects(copy({ status: "draft" }), error => error instanceof ToolInputError && error.message.includes("does not support the 'status' override"));
  await assert.rejects(copy({ slug: source.slug }), error => error instanceof MediaConflictError && error.message.includes(source.slug));
  assert.deepEqual((await deps.mediaRepo.list({ workspaceId: WORKSPACE_ID })).map(asset => asset.id), [source.id]);
  const blob = await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: source.source.sha256 });
  assert.equal(blob?.status, "active");
  assert.deepEqual(await deps.blobStore.get({ storageKey: blob!.storageKey }), pngBytes(8));

  await copy({ slug: "operator-copy", title: "Image v1.2" });
  const saved = await deps.mediaRepo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "operator-copy" });
  assert.equal(saved?.title, "Image v1.2");
  assert.equal(saved?.createdBy, "new-owner");
  assert.equal(saved?.source.sha256, source.source.sha256);
  assert.deepEqual(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: source.id }), source);
});

test("duplicate refuses a trashed asset or missing blob before creating any copy", async () => {
  const { deps, source } = await seed({ bytes: pngBytes(8), contentType: "image/png" });
  await deps.mediaRepo.save({ ...source, status: "trashed" });
  await assert.rejects(duplicate({ deps, source, caps: {} }), error =>
    error instanceof ToolInputError && error.message.includes("is in the trash and was not copied"));
  await deps.mediaRepo.save({ ...source, id: "missing-blob", slug: "missing", source: { sha256: "b".repeat(64) } });
  await assert.rejects(duplicate({ deps, source: { id: "missing-blob" }, caps: {} }), error =>
    error instanceof ToolInputError && error.message.includes("has no stored blob for hash") && error.message.includes("nothing was copied"));
  assert.deepEqual((await deps.mediaRepo.list({ workspaceId: WORKSPACE_ID })).map(asset => asset.id).sort(), [source.id, "missing-blob"].sort());
});
