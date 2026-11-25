import assert from "node:assert/strict";
import { passthroughBlobFence } from "./support/passthrough-blob-fence.js";
import { test } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { buildMediaRegistrations, type MediaToolDeps } from "../tool-registrations.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { uploadMedia } from "../media-service.js";
import { CONVERT_VIDEO_TOOL_ID } from "../convert-video-tool.js";
import type { MediaTranscoderPort } from "../video-transcode.js";

const WORKSPACE_ID = "ws-convert-video-tool";
const context = (input: Record<string, unknown>): ToolExecutionContext =>
  ({ executionId: "exec-1", principal: { id: "principal-1" }, run: { id: "run-1" }, input, signal: new AbortController().signal });

function deps(): MediaToolDeps {
  let counter = 0;
  return {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    workspaceId: WORKSPACE_ID,
    clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") },
    idGen: { newId: () => `id-${++counter}` },
    mediaRepo: new InMemoryMediaRepo({}),
    assetBlobRepo: new InMemoryAssetBlobRepo({}),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}),
    blobStore: new InMemoryBlobStore(), blobFence: passthroughBlobFence,
  };
}
const mp4 = (marker: number) => { const bytes = new Uint8Array(32); bytes.set([0, 0, 0, 16], 0); bytes.set(Buffer.from("ftypisom"), 4); bytes.fill(marker, 16); return bytes; };
const transcoder: MediaTranscoderPort = { transcode: async () => ({ ok: true, bytes: mp4(9) }) };
const videoConversion = { transcoder, linkDerivedMedia: async () => {}, randomHex: ({ bytes }: { bytes: number }) => "cd".repeat(bytes) };

async function seed(base: MediaToolDeps, { bytes, filename }: { bytes: Uint8Array; filename: string }): Promise<string> {
  const { media } = await uploadMedia({ deps: { ...base, blobRepo: base.assetBlobRepo, renditionRepo: base.assetRenditionRepo },
    input: { workspaceId: WORKSPACE_ID, bytes, filename, contentType: "video/mp4", createdByPrincipal: "principal-1" } });
  return media.id;
}

test("media_convert_video is absent when the host provides no transcoder", () => {
  const ids = buildMediaRegistrations(deps()).map(registration => registration.descriptor.id);
  assert.ok(ids.includes("media_upload_asset"));
  assert.ok(!ids.includes(CONVERT_VIDEO_TOOL_ID));
});

test("media_convert_video is present with a transcoder and asks the owner for approval", () => {
  const registration = buildMediaRegistrations(deps(), { videoConversion }).find(r => r.descriptor.id === CONVERT_VIDEO_TOOL_ID);
  assert.ok(registration);
  assert.equal(registration.descriptor.metadata?.approval?.confirmation, "direct");
  assert.equal(registration.descriptor.metadata?.approval?.class, "edit");
  assert.equal(registration.descriptor.sideEffects, "mutates-durable-state");
  assert.equal(registration.descriptor.readOnly, false);
  assert.deepEqual((registration.descriptor.inputSchema as { required: string[] }).required, ["mediaId"]);
});

test("media_convert_video creates a separate web copy and reports both ids", async () => {
  const base = deps();
  const originalId = await seed(base, { bytes: mp4(1), filename: "Party.mp4" });
  const tool = buildMediaRegistrations(base, { videoConversion }).find(r => r.descriptor.id === CONVERT_VIDEO_TOOL_ID)!;
  const result = await tool.handler(context({ mediaId: originalId })) as { converted: boolean; originalId: string; convertedId: string; media: { title: string } };
  assert.equal(result.converted, true);
  assert.equal(result.originalId, originalId);
  assert.notEqual(result.convertedId, originalId);
  assert.equal(result.media.title, "Party (web)");
  assert.equal((await base.mediaRepo.list({ workspaceId: WORKSPACE_ID })).length, 2);
});

test("media_convert_video refuses a non-video in plain words with an ERR- id", async () => {
  const base = deps();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const { media } = await uploadMedia({ deps: { ...base, blobRepo: base.assetBlobRepo, renditionRepo: base.assetRenditionRepo },
    input: { workspaceId: WORKSPACE_ID, bytes: png, filename: "logo.png", contentType: "image/png", createdByPrincipal: "principal-1" } });
  const tool = buildMediaRegistrations(base, { videoConversion }).find(r => r.descriptor.id === CONVERT_VIDEO_TOOL_ID)!;
  const result = await tool.handler(context({ mediaId: media.id })) as { converted: boolean; error: { reason: string; message: string } };
  assert.equal(result.converted, false);
  assert.equal(result.error.reason, "not-video");
  assert.equal(result.error.message, "Only videos can be converted for the web, and this item is not a video. (ERR-CDCD-CDCD-CDCD-CDCD)");
  assert.equal((await base.mediaRepo.list({ workspaceId: WORKSPACE_ID })).length, 1);
});
