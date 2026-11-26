import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "vitest";
import { uploadMedia } from "../media-service.js";
import { replaceMediaFile, type MediaFileReplacementRepoPort } from "../replace-media-file.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { readFileSync } from "node:fs";
import { isoBmffVideoBytes } from "./iso-bmff-fixture.js";
import { mediaFileExtension } from "../file-extension.js";

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
  const base = { createHash, clock: { nowMs: () => Date.parse("2026-11-25T00:00:00Z") }, idGen: { newId: () => `id-${++ids}` }, blobStore: new InMemoryBlobStore() };
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

/** A sniffed ISO-BMFF original padded to `byteLength`, so its size sits exactly where the test needs it. */
const paddedIsoBmff = (brand: string, byteLength: number) => { const bytes = new Uint8Array(byteLength); bytes.set(isoBmffVideoBytes(brand)); return bytes; };

async function storedOriginal(f: ReturnType<typeof fixture>, input: { filename: string; contentType: string; bytes: Uint8Array }) {
  const { media } = await uploadMedia({ deps: f.uploadDeps, input: { workspaceId: "ws", createdByPrincipal: "owner", ...input } }, { maxUploadBytes: 50 * MIB });
  const blob = await f.uploadDeps.blobRepo.findByHash({ workspaceId: "ws", sha256: media.source.sha256 });
  assert.ok(blob, "the original is recorded");
  // Blob keys are content hashes; the public suffix comes from the sniffed type, never the upload filename.
  return { media, suffix: mediaFileExtension({ contentType: media.source.contentType ?? "" }), stored: await f.uploadDeps.blobStore.get({ storageKey: blob.storageKey }) };
}

test("stores a sniffed QuickTime file unchanged at the policy limit", async () => {
  const bytes = paddedIsoBmff("qt  ", 50 * MIB);
  const { media, suffix, stored } = await storedOriginal(fixture(), { filename: "clip.mov", contentType: "video/quicktime", bytes });
  assert.equal(media.source.contentType, "video/quicktime");
  assert.equal(suffix, "mov", "stored under a .mov suffix");
  assert.ok(Buffer.from(stored).equals(Buffer.from(bytes)), "stored bytes are the original, unconverted");
});

test("stores a sniffed M4V file unchanged", async () => {
  const bytes = isoBmffVideoBytes("M4V ");
  const { media, suffix, stored } = await storedOriginal(fixture(), { filename: "clip.m4v", contentType: "video/x-m4v", bytes });
  assert.equal(media.source.contentType, "video/x-m4v");
  assert.equal(suffix, "m4v", "stored under a .m4v suffix");
  assert.ok(Buffer.from(stored).equals(bytes), "stored bytes are the original, unconverted");
});

test("a one-byte-over ordinary upload reports the configured 50 MiB limit", async () => {
  await assert.rejects(
    upload(fixture(), "image/png", 50 * MIB + 0.1 * MIB),
    (error: Error) => error.message.includes("That file is 50.1 MB; the limit is 50 MB."),
  );
});

test("the document limit is the shared media policy value, not a second literal", () => {
  const source = readFileSync(new URL("../document-ingress.ts", import.meta.url), "utf8");
  assert.ok(source.includes("MEDIA_MAX_UPLOAD_BYTES"), "document-ingress binds the shared policy value");
  assert.doesNotMatch(source, /50\s*\*\s*1024\s*\*\s*1024/);
});

test("the cms media entry re-exports the shared policy value at 50 MiB", async () => {
  const media = await import("../index.js");
  assert.equal(media.MEDIA_MAX_UPLOAD_BYTES, 50 * MIB);
  assert.equal(media.MAX_DOCUMENT_BYTES, media.MEDIA_MAX_UPLOAD_BYTES);
});
