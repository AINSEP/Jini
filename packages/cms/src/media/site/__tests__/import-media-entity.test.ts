import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "vitest";

import { computeBlobStorageKey, InMemoryAssetBlobRepo, InMemoryBlobStore, InMemoryVersionedMediaRepo, type MediaRecord } from "../../index.js";
import type { BlobFence } from "@jini-ai/core/contracts/blob-gc";
import { importMediaEntity, type ImportMediaEntityDeps } from "../import-media-entity.js";
import { bytesMatchSha256, isValidSha256Hex } from "../../../publish/transfer/blob-staging.js";

/**
 * @file Characterization of `importMediaEntity` (`../import-media-entity.ts`) in the package: the
 * source id survives the import, and the byte/slug preconditions refuse before any write. The host
 * keeps its wider suite (render, rethrow, race cases) against this same module.
 */

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const HELLO_BYTES = new TextEncoder().encode("hello world");
/** Pinned literal, not recomputed, so a hashing regression cannot rubber-stamp itself. */
const HELLO_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

function makeRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "source-asset-1", workspaceId: WORKSPACE_ID, title: "A Photo", slug: "a-photo", alt: "", caption: "", credit: "",
    source: { sha256: HELLO_SHA256 }, status: "active", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", version: 1, width: null, height: null, cssClass: null, htmlAttributes: null,
    ...overrides,
  };
}

function makeDeps() {
  let n = 0;
  const blobStore = new InMemoryBlobStore();
  return {
    mediaRepo: new InMemoryVersionedMediaRepo({}),
    assetBlobRepo: new InMemoryAssetBlobRepo({}),
    blobStore,
    blobFence: {
      withKeys: async ({ work }) => work(),
      withAsset: async ({ work }) => work(),
    } satisfies BlobFence,
    storageKeyFor: computeBlobStorageKey,
    verifyStoredBlob: async ({ storageKey, sha256, byteLength }: { storageKey: string; sha256: string; byteLength: number }) => {
      const stored = await blobStore.get({ storageKey });
      if (stored.byteLength !== byteLength || !bytesMatchSha256({ bytes: stored, claimedSha256: sha256 })) {
        throw new Error("Stored blob failed verification");
      }
    },
    createHash, clock: { nowIso: () => "2026-09-18T00:00:00.000Z" },
    idGen: { newId: () => `generated-${++n}` },
    sha256: { isValidSha256Hex, bytesMatchSha256 },
    outwardErrorMessage: ({ error }: { error: Error }) => error.message,
  } satisfies ImportMediaEntityDeps;
}

test("import verifies an existing object's size and hash before publishing", async () => {
  for (const corrupt of [HELLO_BYTES.slice(1), new TextEncoder().encode("HELLO WORLD")]) {
    const deps = makeDeps();
    await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
      bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
    const blob = await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 });
    assert.ok(blob);
    await deps.blobStore.put({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256, bytes: corrupt });
    await assert.rejects(importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID,
      record: makeRecord({ id: "second-asset", slug: "second-photo" }), bytes: HELLO_BYTES,
      blobCreatedByPrincipal: "importer-2", baseVersion: null } }), /Stored blob failed verification/);
    assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "second-asset" }), null);
    assert.deepEqual(await deps.blobStore.get({ storageKey: blob.storageKey }), corrupt);
    assert.equal((await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 }))?.createdByPrincipal, "importer-1");
  }
});

test("each writer holds the byte fence across write and publish", async () => {
  const deps = makeDeps();
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entry = new Promise<"entered">((resolve) => { entered = () => resolve("entered"); });
  let held = false;
  let verified = false;
  const verify = deps.verifyStoredBlob;
  const insert = deps.mediaRepo.insertIfAbsent.bind(deps.mediaRepo);
  deps.blobFence.withKeys = async ({ workspaceId, storageKeys, work }) => {
    assert.equal(workspaceId, WORKSPACE_ID);
    assert.deepEqual(storageKeys, [`ws/${WORKSPACE_ID}/blobs/b9/${HELLO_SHA256}`]);
    entered();
    await gate;
    held = true;
    try { return await work(); } finally { held = false; }
  };
  deps.verifyStoredBlob = async (input) => { assert.equal(held, true); await verify(input); verified = true; };
  deps.mediaRepo.insertIfAbsent = async (input) => {
    assert.equal(held, true);
    assert.equal(verified, true);
    return insert(input);
  };
  const pending = importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  try {
    assert.equal(await Promise.race([entry, pending.then(() => "completed")]), "entered");
    assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
    assert.equal(await deps.blobStore.exists({ storageKey: `ws/${WORKSPACE_ID}/blobs/b9/${HELLO_SHA256}` }), false);
  } finally { release(); }
  assert.deepEqual(await pending, { status: "imported", id: "source-asset-1", blobWritten: true });
  assert.equal(verified, true);
});

test("importMediaEntity saves the row under the SOURCE id and stamps a new blob", async () => {
  const deps = makeDeps();
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.deepEqual(result, { status: "imported", id: "source-asset-1", blobWritten: true });
  assert.equal((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }))?.id, "source-asset-1");
  const blob = await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 });
  assert.equal(blob?.createdByPrincipal, "importer-1");
});

test("importMediaEntity refuses bytes that do not hash to the claimed sha256 and writes nothing", async () => {
  const deps = makeDeps();
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: new TextEncoder().encode("tampered"), blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.equal(result.status, "blocked");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
  assert.equal(await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 }), null);
});

test("importMediaEntity blocks a slug held by a different id", async () => {
  const deps = makeDeps();
  await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord({ id: "holder" }),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord({ id: "other" }),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.equal(result.status, "blocked");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "other" }), null);
});

test("importMediaEntity checks the staged bytes through the host's injected sha256 rule", async () => {
  // The digest rule arrives through deps (the media domain never reaches the publish transfer module);
  // a checker that refuses every claim must block the write before any repo read.
  const deps = { ...makeDeps(), sha256: { isValidSha256Hex: () => true, bytesMatchSha256: () => false } };
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.equal(result.status, "blocked");
  assert.equal(result.status === "blocked" ? result.code : undefined, "precondition");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
});

/** Words every classified refusal through the injected port and records which error it was handed. */
function recordingOutwardPort() {
  const seen: Error[] = [];
  return { seen, outwardErrorMessage: ({ error }: { error: Error }) => { seen.push(error); return `outward:${error.constructor.name}`; } };
}

test("importMediaEntity words a write-once source refusal through the host's outward error port", async () => {
  // Stored error text never leaves engine code raw: the host decides what a caller may read.
  const port = recordingOutwardPort();
  const deps = { ...makeDeps(), outwardErrorMessage: port.outwardErrorMessage,
    sha256: { isValidSha256Hex: () => true, bytesMatchSha256: () => true } };
  await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID,
    record: makeRecord({ source: { sha256: "a".repeat(64) } }), bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: 1 } });
  assert.deepEqual(result, { status: "blocked", code: "precondition", reason: "outward:MediaSourceImmutableError" });
  assert.equal(port.seen.length, 1);
});

test("importMediaEntity words a reviewed-replacement refusal through the host's outward error port", async () => {
  const port = recordingOutwardPort();
  const deps = { ...makeDeps(), outwardErrorMessage: port.outwardErrorMessage,
    sha256: { isValidSha256Hex: () => true, bytesMatchSha256: () => true } };
  await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID,
    record: makeRecord({ source: { sha256: "a".repeat(64) } }), bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1",
    baseVersion: 1, sourceReplacement: { version: 1, sourceSha256: HELLO_SHA256 } } });
  assert.equal(port.seen.length, 1);
  assert.deepEqual(result, { status: "blocked", code: "precondition", reason: `outward:${port.seen[0]?.constructor.name}` });
});

/** Why: a reviewed replacement is a write like any other, so its size cap follows the file's type
 *  (owner decision 2026-11-24: video 500 MiB, everything else 50 MiB). Omitting the video cap keeps
 *  every other host on the one general cap. */
async function replaceWith({ bytes, caps }: { bytes: Uint8Array; caps: { maxUploadBytes?: number; maxVideoUploadBytes?: number } }) {
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const deps = { ...makeDeps(), ...caps };
  await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  return importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord({ source: { sha256 } }), bytes,
    blobCreatedByPrincipal: "importer-1", baseVersion: 1, sourceReplacement: { version: 1, sourceSha256: HELLO_SHA256 } } });
}

function sizedBytes({ size, magic }: { size: number; magic: readonly number[] }): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(magic, 0);
  return bytes;
}

const MP4_MAGIC = [0, 0, 0, 16, ...Buffer.from("ftypisom")];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SIXTY_MIB = 60 * 1024 * 1024;
const CAPS = { maxUploadBytes: 50 * 1024 * 1024, maxVideoUploadBytes: 500 * 1024 * 1024 };

test("importMediaEntity replaces a 60 MiB video when the host gives the video cap", async () => {
  const result = await replaceWith({ bytes: sizedBytes({ size: SIXTY_MIB, magic: MP4_MAGIC }), caps: CAPS });
  assert.equal(result.status, "imported");
});

test("importMediaEntity still refuses a 60 MiB image replacement when a video cap is given", async () => {
  const result = await replaceWith({ bytes: sizedBytes({ size: SIXTY_MIB, magic: PNG_MAGIC }), caps: CAPS });
  assert.equal(result.status, "blocked");
});

test("importMediaEntity without a video cap refuses a 60 MiB video at the general cap", async () => {
  const result = await replaceWith({ bytes: sizedBytes({ size: SIXTY_MIB, magic: MP4_MAGIC }), caps: {} });
  assert.equal(result.status, "blocked");
});
