import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "vitest";

import { computeBlobStorageKey, InMemoryAssetBlobRepo, InMemoryBlobStore, InMemoryVersionedMediaRepo, MediaConflictError, MediaValidationError, type MediaRecord } from "../../index.js";
import type { BlobFence } from "@jini-ai/core/contracts/blob-gc";
import { importMediaEntity, restoreImportedMedia, type ImportMediaEntityDeps } from "../import-media-entity.js";
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

test("malformed source and missing bytes are separate import refusals and leave the destination empty", async () => {
  const deps = makeDeps();
  const base = { workspaceId: WORKSPACE_ID, record: makeRecord(), bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer", baseVersion: null };
  assert.deepEqual(await importMediaEntity({ deps, input: { ...base, record: makeRecord({ source: { sha256: "invalid-sha" } }) } }),
    { status: "blocked", code: "precondition", reason: "malformed source sha256 'invalid-sha'" });
  assert.deepEqual(await importMediaEntity({ deps, input: { ...base, bytes: null } }),
    { status: "blocked", code: "missing-blob", reason: `required blob '${HELLO_SHA256}' was never received by this destination` });
  assert.deepEqual(await deps.mediaRepo.list({ workspaceId: WORKSPACE_ID }), []);
  assert.deepEqual(await deps.assetBlobRepo.list({ workspaceId: WORKSPACE_ID }), []);
});

test("resurrects a verified tombstoned blob for a new row without re-stamping the original owner", async () => {
  const deps = makeDeps();
  const { storageKey } = await deps.blobStore.put({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256, bytes: HELLO_BYTES });
  await deps.assetBlobRepo.save({ id: "old", workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256, storageKey, status: "tombstoned",
    tombstonedAt: "2026-09-17", createdAt: "2026-09-16", createdByPrincipal: "original-owner" });
  const record = makeRecord();
  assert.deepEqual(await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record, bytes: HELLO_BYTES,
    blobCreatedByPrincipal: "new-owner", baseVersion: null } }), { status: "imported", id: "source-asset-1", blobWritten: false });
  const renewed = await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 });
  assert.deepEqual(renewed, { id: "old", workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256, storageKey, status: "active",
    tombstonedAt: undefined, createdAt: "2026-09-16", createdByPrincipal: "original-owner" });
  assert.equal((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: record.id }))?.source.sha256, HELLO_SHA256);
});

// --- Gap fill (cloud A2): races at the compare-and-set write, replacement refusals, rollback. ---

const OTHER_BYTES = new TextEncoder().encode("other bytes");
const OTHER_SHA256 = createHash("sha256").update(OTHER_BYTES).digest("hex");

/** A real in-memory repo whose next conditional write first lets `race` run, as a concurrent writer would. */
class RacingMediaRepo extends InMemoryVersionedMediaRepo {
  race: ((repo: InMemoryVersionedMediaRepo) => Promise<{ applied: boolean } | void>) | null = null;
  private async raced(write: () => Promise<{ applied: boolean }>): Promise<{ applied: boolean }> {
    const race = this.race;
    this.race = null;
    const forced = race ? await race(this) : undefined;
    return forced ?? write();
  }
  override async insertIfAbsent(record: MediaRecord): Promise<{ applied: boolean }> {
    return this.raced(() => super.insertIfAbsent(record));
  }
  override async saveIfVersion(required: { record: MediaRecord; ifVersion: number }): Promise<{ applied: boolean }> {
    return this.raced(() => super.saveIfVersion(required));
  }
}

function racingDeps() {
  const mediaRepo = new RacingMediaRepo({});
  return { ...makeDeps(), mediaRepo };
}

function importInput(overrides: Partial<{ record: MediaRecord; bytes: Uint8Array | null; baseVersion: number | null; sourceReplacement: { version: number; sourceSha256: string } }> = {}) {
  return { workspaceId: WORKSPACE_ID, record: makeRecord(), bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null, ...overrides };
}

test("a slug taken by another id between the precondition read and the insert is reported with the real holder", async () => {
  const deps = racingDeps();
  deps.mediaRepo.race = async (repo) => {
    await repo.save(makeRecord({ id: "raced-holder" }));
    throw new MediaConflictError({ message: "unique slug" });
  };
  assert.deepEqual(await importMediaEntity({ deps, input: importInput() }),
    { status: "blocked", code: "slug-taken", reason: "slug 'a-photo' is already held by a different media ('raced-holder')" });
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
});

test("a slug race whose holder vanished again names it unknown, and a non-conflict write error propagates", async () => {
  const deps = racingDeps();
  deps.mediaRepo.race = async () => { throw new MediaConflictError({ message: "unique slug" }); };
  assert.deepEqual(await importMediaEntity({ deps, input: importInput() }),
    { status: "blocked", code: "slug-taken", reason: "slug 'a-photo' is already held by a different media ('unknown')" });
  deps.mediaRepo.race = async () => { throw new Error("disk full"); };
  await assert.rejects(importMediaEntity({ deps, input: importInput() }), /^Error: disk full$/);
});

test("an insert that loses to a concurrent insert of the same id reports the version it found", async () => {
  const deps = racingDeps();
  deps.mediaRepo.race = async (repo) => { await repo.save(makeRecord({ version: 3, slug: "elsewhere" })); };
  assert.deepEqual(await importMediaEntity({ deps, input: importInput() }),
    { status: "conflict", reason: "expected no existing row, found version 3" });
  assert.equal((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }))?.slug, "elsewhere");
});

test("a refused write whose re-read shows no mismatch still reports a conflict, never success", async () => {
  const deps = racingDeps();
  deps.mediaRepo.race = async () => ({ applied: false });
  assert.deepEqual(await importMediaEntity({ deps, input: importInput() }),
    { status: "conflict", reason: "expected no existing row, but the id is already in use" });
  await importMediaEntity({ deps, input: importInput() });
  deps.mediaRepo.race = async () => ({ applied: false });
  assert.deepEqual(await importMediaEntity({ deps, input: importInput({ baseVersion: 1 }) }),
    { status: "conflict", reason: "expected version 1, but a concurrent write landed first" });
});

test("an update whose row was deleted mid-flight reports the row gone", async () => {
  const deps = racingDeps();
  await importMediaEntity({ deps, input: importInput() });
  deps.mediaRepo.race = async (repo) => { await repo.remove({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }); };
  assert.deepEqual(await importMediaEntity({ deps, input: importInput({ baseVersion: 1 }) }),
    { status: "conflict", reason: "expected version 1, but the row is gone" });
});

test("a record with no source is refused as malformed before any read", async () => {
  const deps = makeDeps();
  const record = { ...makeRecord(), source: undefined } as unknown as MediaRecord;
  assert.deepEqual(await importMediaEntity({ deps, input: importInput({ record }) }),
    { status: "blocked", code: "precondition", reason: "missing or malformed media source" });
});

test("an existing blob row stored under a key other than the fenced one fails closed with no media row", async () => {
  const deps = makeDeps();
  await deps.assetBlobRepo.save({ id: "b1", workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256, storageKey: "elsewhere/key",
    status: "active", createdAt: "2026-09-16", createdByPrincipal: "owner" });
  await assert.rejects(importMediaEntity({ deps, input: importInput() }),
    (error: unknown) => error instanceof MediaValidationError && error.message === "Stored blob key does not match the fenced key");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
});

test("a blob store that puts new bytes under a different key than the fence fails closed with no media row", async () => {
  const deps = { ...makeDeps(), storageKeyFor: () => "fenced/other-key" };
  await assert.rejects(importMediaEntity({ deps, input: importInput() }),
    (error: unknown) => error instanceof MediaValidationError && error.message === "Stored blob key does not match the fenced key");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
});

const REVIEWED = { version: 1, sourceSha256: HELLO_SHA256 };
const LIVE_CHANGED = "The live file changed after review. Plan publishing again and review Overwrite on live.";

test("a reviewed replacement is refused when the live row is missing, at another version, or on other bytes", async () => {
  const replacement = importInput({ record: makeRecord({ source: { sha256: OTHER_SHA256 } }), bytes: OTHER_BYTES, sourceReplacement: REVIEWED });
  const missing = makeDeps();
  assert.deepEqual(await importMediaEntity({ deps: missing, input: { ...replacement, baseVersion: null } }), { status: "conflict", reason: LIVE_CHANGED });
  const deps = makeDeps();
  await importMediaEntity({ deps, input: importInput() });
  assert.deepEqual(await importMediaEntity({ deps, input: { ...replacement, baseVersion: 1, sourceReplacement: { ...REVIEWED, version: 2 } } }),
    { status: "conflict", reason: LIVE_CHANGED });
  assert.deepEqual(await importMediaEntity({ deps, input: { ...replacement, baseVersion: 1, sourceReplacement: { ...REVIEWED, sourceSha256: OTHER_SHA256 } } }),
    { status: "conflict", reason: LIVE_CHANGED });
  assert.equal((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }))?.source.sha256, HELLO_SHA256);
});

/** The real repo with its optional atomic-replace capability absent, as an older destination has it. */
function withoutAtomicReplace(repo: InMemoryVersionedMediaRepo): InMemoryVersionedMediaRepo {
  return new Proxy(repo, { get: (target, key, receiver) => (key === "replaceFileIfVersion" ? undefined : Reflect.get(target, key, receiver)) });
}

test("a reviewed replacement on a destination without atomic replace is refused and leaves the row alone", async () => {
  const deps = makeDeps();
  await importMediaEntity({ deps, input: importInput() });
  const result = await importMediaEntity({ deps: { ...deps, mediaRepo: withoutAtomicReplace(deps.mediaRepo) }, input: importInput({
    record: makeRecord({ source: { sha256: OTHER_SHA256 } }), bytes: OTHER_BYTES, baseVersion: 1, sourceReplacement: REVIEWED }) });
  assert.deepEqual(result, { status: "blocked", code: "precondition",
    reason: "This destination cannot replace media files atomically. Update the live site and plan publishing again." });
  assert.equal((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }))?.version, 1);
});

/** Imports v1, then makes `replaceFileIfVersion` behave as `outcome` says for the reviewed replacement. */
async function replaceWithOutcome(outcome: () => Promise<{ applied: boolean }>) {
  const deps = makeDeps();
  await importMediaEntity({ deps, input: importInput() });
  deps.mediaRepo.replaceFileIfVersion = outcome;
  return importMediaEntity({ deps, input: importInput({ record: makeRecord({ source: { sha256: OTHER_SHA256 } }),
    bytes: OTHER_BYTES, baseVersion: 1, sourceReplacement: REVIEWED }) });
}

test("a reviewed replacement that loses its compare-and-set reports a conflict", async () => {
  assert.deepEqual(await replaceWithOutcome(async () => ({ applied: false })),
    { status: "conflict", reason: "The live file changed during replacement. Plan publishing again." });
});

test("a reviewed replacement hitting a slug conflict is worded through the outward port; other failures propagate", async () => {
  assert.deepEqual(await replaceWithOutcome(async () => { throw new MediaConflictError({ message: "slug clash" }); }),
    { status: "blocked", code: "slug-taken", reason: "slug clash" });
  await assert.rejects(replaceWithOutcome(async () => { throw new Error("db offline"); }), /^Error: db offline$/);
});

/** v1 on HELLO, then v2 via an import that keeps (`sameBytes`) or replaces the source. Returns v1 as `prior`. */
async function importedTwice({ sameBytes }: { sameBytes: boolean }) {
  const deps = makeDeps();
  await importMediaEntity({ deps, input: importInput() });
  const prior = await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" });
  assert.ok(prior);
  const second = sameBytes
    ? importInput({ record: makeRecord({ title: "Retitled" }), baseVersion: 1 })
    : importInput({ record: makeRecord({ source: { sha256: OTHER_SHA256 } }), bytes: OTHER_BYTES, baseVersion: 1, sourceReplacement: REVIEWED });
  assert.equal((await importMediaEntity({ deps, input: second })).status, "imported");
  return { deps, prior };
}

test("restoreImportedMedia puts back the prior row when the bytes did not change", async () => {
  const { deps, prior } = await importedTwice({ sameBytes: true });
  await restoreImportedMedia({ deps, prior });
  assert.deepEqual(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), prior);
});

test("restoreImportedMedia switches a replaced source back to the prior blob atomically", async () => {
  const { deps, prior } = await importedTwice({ sameBytes: false });
  await restoreImportedMedia({ deps, prior });
  const restored = await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" });
  assert.equal(restored?.source.sha256, HELLO_SHA256);
  assert.equal(restored?.version, 1);
});

test("restoreImportedMedia refuses when the live row is gone or was edited again", async () => {
  const changed = "Could not restore media 'source-asset-1' after publishing failed. Restore the publish restore point; the live file changed.";
  const { deps, prior } = await importedTwice({ sameBytes: true });
  await assert.rejects(restoreImportedMedia({ deps, prior: { ...prior, version: 5 } }), { message: changed });
  await deps.mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: "source-asset-1" });
  await assert.rejects(restoreImportedMedia({ deps, prior }), { message: changed });
});

test("restoreImportedMedia refuses a source switch-back when the prior blob or atomic replace is unavailable", async () => {
  const unavailable = "Could not restore media 'source-asset-1' after publishing failed. Restore the publish restore point; the live file changed or its original blob is unavailable.";
  const { deps, prior } = await importedTwice({ sameBytes: false });
  await assert.rejects(restoreImportedMedia({ deps: { ...deps, assetBlobRepo: new InMemoryAssetBlobRepo({}) }, prior }), { message: unavailable });
  await assert.rejects(restoreImportedMedia({ deps: { ...deps, mediaRepo: withoutAtomicReplace(deps.mediaRepo) }, prior }), { message: unavailable });
  assert.equal((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }))?.source.sha256, OTHER_SHA256);
});

test("restoreImportedMedia refuses when the compare-and-set loses to a concurrent edit", async () => {
  const { deps, prior } = await importedTwice({ sameBytes: true });
  deps.mediaRepo.saveIfVersion = async () => ({ applied: false });
  await assert.rejects(restoreImportedMedia({ deps, prior }),
    { message: "Could not restore media 'source-asset-1': the live file changed during rollback. Restore the publish restore point." });
});
