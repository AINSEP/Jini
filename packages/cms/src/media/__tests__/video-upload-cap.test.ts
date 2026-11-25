import assert from "node:assert/strict";
import { test } from "vitest";
import { uploadMedia } from "../media-service.js";
import { replaceMediaFile, type MediaFileReplacementRepoPort } from "../replace-media-file.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";

const MIB = 1024 * 1024;
/** The host's two caps: images and everything else at 50 MiB, video at 500 MiB. */
const CAPS = { maxUploadBytes: 50 * MIB, maxVideoUploadBytes: 500 * MIB };

function fixture() {
  let ids = 0;
  const mediaRepo: MediaFileReplacementRepoPort = Object.assign(new InMemoryMediaRepo({}), {
    replaceFileIfVersion: async () => ({ applied: true }),
    saveRenditionIfSource: async () => ({ applied: true }),
  });
  const assetBlobRepo = new InMemoryAssetBlobRepo({});
  const base = { clock: { nowMs: () => Date.parse("2026-11-25T00:00:00Z") }, idGen: { newId: () => `id-${++ids}` }, blobStore: new InMemoryBlobStore() };
  return {
    uploadDeps: { ...base, mediaRepo, blobRepo: assetBlobRepo, renditionRepo: new InMemoryAssetRenditionRepo({}) },
    replaceDeps: { ...base, workspaceId: "ws", mediaRepo, assetBlobRepo },
  };
}

const MP4_HEADER = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
const sizedBytes = (byteLength: number) => { const bytes = new Uint8Array(byteLength); bytes.set(MP4_HEADER); return bytes; };

const upload = (f: ReturnType<typeof fixture>, contentType: string, byteLength: number) => uploadMedia({ deps: f.uploadDeps, input: {
  workspaceId: "ws", filename: contentType === "video/mp4" ? "clip.mp4" : "pic.png", contentType, bytes: sizedBytes(byteLength), createdByPrincipal: "owner" } }, CAPS);

test("a 60 MiB video is accepted when the host sets a video cap above its general cap", async () => {
  const { media } = await upload(fixture(), "video/mp4", 60 * MIB);
  assert.equal(media.source.sha256.length, 64, "stored, not refused");
});

test("a 60 MiB image is still refused with the plain-words limit sentence", async () => {
  await assert.rejects(upload(fixture(), "image/png", 60 * MIB), /the limit is 50 MB\./);
});

test("a video over the video cap is refused naming the video limit", async () => {
  await assert.rejects(upload(fixture(), "video/mp4", 500 * MIB + 1), /the limit is 500 MB\./);
});

test("replacing a file with a 60 MiB video honours the video cap, a 60 MiB image does not", async () => {
  const f = fixture();
  const { media } = await uploadMedia({ deps: f.uploadDeps, input: { workspaceId: "ws", filename: "a.png", contentType: "image/png", bytes: new Uint8Array([1]), createdByPrincipal: "o" } });
  const mp4 = sizedBytes(60 * MIB);
  assert.ok(await replaceMediaFile({ deps: f.replaceDeps, media, bytes: mp4, contentType: "video/mp4", principalId: "o" }, CAPS));
  const png = new Uint8Array(60 * MIB);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await assert.rejects(replaceMediaFile({ deps: f.replaceDeps, media, bytes: png, contentType: "image/png", principalId: "o" }, CAPS), /exceeds the upload size cap/);
});

test("an uploaded record carries captions: null, the shape the repository reads back", async () => {
  const { media } = await uploadMedia({ deps: fixture().uploadDeps, input: { workspaceId: "ws", filename: "a.png", contentType: "image/png", bytes: new Uint8Array([1]), createdByPrincipal: "o" } });
  assert.equal(media.captions, null);
});
