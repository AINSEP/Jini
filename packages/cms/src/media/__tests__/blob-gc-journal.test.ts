import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import type { BlobJournalIdentity, BlobPurgeReason } from "@jini-ai/core/contracts/blob-gc";
import { classifyJournalEntry, planRenditionJournal } from "../blob-gc-journal.js";
import { computeBlobStorageKey } from "../blob-key.js";
import { purgeMedia, rollbackUploadedMedia, trashMedia, uploadMedia } from "../media-service.js";
import { resolveMediaRendition } from "../rendition-service.js";
import { registerTransform } from "../transform-registry.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { InMemoryImageTransformer } from "../image-transformer.js";
import { InMemoryVersionedMediaRepo } from "../index.js";
import { importMediaEntity, type ImportMediaEntityDeps } from "../site/import-media-entity.js";
import { replaceMediaFile, type MediaFileReplacementRepoPort } from "../replace-media-file.js";
import { bytesMatchSha256, isValidSha256Hex } from "../../publish/transfer/blob-staging.js";

/**
 * J1a/J1c: the journal's provenance contract (each key journaled with ITS OWN digest and an exact
 * reason) and the writer-side eligibility binding (a writer taking ownership of a key clears any
 * pending journal eligibility for that key). Sweeps stay dark: nothing here unlinks bytes.
 */

const WS = "workspace-1";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const keyFor = ({ workspaceId, sha256 }: { workspaceId: string; sha256: string }) => computeBlobStorageKey({ workspaceId, sha256 });

function makeDeps() {
  let counter = 0;
  const cleared: Array<{ keys: readonly string[]; activeAtClear: boolean }> = [];
  const blobRepo = new InMemoryAssetBlobRepo({});
  const deps = {
    createHash, clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z") },
    idGen: { newId: () => `id-${(counter += 1)}` },
    mediaRepo: new InMemoryMediaRepo({}),
    blobRepo,
    renditionRepo: new InMemoryAssetRenditionRepo({}),
    transformRepo: new InMemoryTransformDefinitionRepo({}),
    blobStore: new InMemoryBlobStore(),
    imageTransformer: new InMemoryImageTransformer(),
    referenceCheck: { findReferences: async () => [] },
    journalEligibility: {
      clearForKeys: async ({ workspaceId, storageKeys }: { workspaceId: string; storageKeys: readonly string[] }) => {
        const rows = await Promise.all(storageKeys.map(async key => (await blobRepo.list({ workspaceId })).find(row => row.storageKey === key)));
        cleared.push({ keys: [...storageKeys], activeAtClear: rows.every(row => row?.status === "active") });
      },
    },
  };
  return { deps, cleared };
}

type JournalPayload = { reason?: BlobPurgeReason; renditions: readonly BlobJournalIdentity[]; unverifiedRenditionKeys: readonly string[] };

async function uploadOne(deps: ReturnType<typeof makeDeps>["deps"], content: string) {
  return (await uploadMedia({ deps, input: { workspaceId: WS, bytes: new TextEncoder().encode(content), filename: "a.png", contentType: "image/png", createdByPrincipal: "owner" } })).media;
}

async function purgeCapturing(deps: ReturnType<typeof makeDeps>["deps"], mediaId: string, reason?: BlobPurgeReason) {
  const payloads: JournalPayload[] = [];
  await trashMedia({ deps, input: { workspaceId: WS, id: mediaId } });
  await purgeMedia({ deps: { ...deps, cleanupJournal: async (input: JournalPayload) => { payloads.push(input); } },
    input: { workspaceId: WS, id: mediaId, ...(reason === undefined ? {} : { reason }) } });
  return payloads;
}

test("purge journals each rendition with its own digest, never the source digest", async () => {
  const { deps } = makeDeps();
  const media = await uploadOne(deps, "source");
  const thumbSha = sha("thumb-bytes");
  await deps.renditionRepo.save({ id: "thumb", workspaceId: WS, assetId: media.id, transformName: "thumb", version: 1, storageKey: keyFor({ workspaceId: WS, sha256: thumbSha }), sha256: thumbSha, createdAt: "now" });
  const [payload] = await purgeCapturing(deps, media.id, "owner-purge");
  // The original passthrough row shares the original's key: it is deduplicated out, never journaled as a rendition.
  assert.deepEqual(payload!.renditions, [{ workspaceId: WS, storageKey: keyFor({ workspaceId: WS, sha256: thumbSha }), sha256: thumbSha, role: "rendition", reason: "owner-purge" }]);
  assert.equal(payload!.renditions.some(identity => identity.sha256 === media.source.sha256), false);
  assert.deepEqual(payload!.unverifiedRenditionKeys, []);
});

test("a rendition row without its own digest is reported unverified, never journaled", async () => {
  const { deps } = makeDeps();
  const media = await uploadOne(deps, "legacy-source");
  await deps.renditionRepo.save({ id: "legacy", workspaceId: WS, assetId: media.id, transformName: "thumb", version: 1, storageKey: "legacy-thumb-key", createdAt: "now" });
  const [payload] = await purgeCapturing(deps, media.id, "owner-purge");
  assert.deepEqual(payload!.renditions, []);
  assert.deepEqual(payload!.unverifiedRenditionKeys, ["legacy-thumb-key"]);
});

test("purge without a reason omits it and the verifier keeps every entry", async () => {
  const { deps } = makeDeps();
  const media = await uploadOne(deps, "no-reason");
  const thumbSha = sha("t2");
  await deps.renditionRepo.save({ id: "t", workspaceId: WS, assetId: media.id, transformName: "thumb", version: 1, storageKey: keyFor({ workspaceId: WS, sha256: thumbSha }), sha256: thumbSha, createdAt: "now" });
  const [payload] = await purgeCapturing(deps, media.id);
  assert.equal("reason" in payload!, false);
  assert.equal("reason" in payload!.renditions[0]!, false);
  assert.deepEqual(classifyJournalEntry({ entry: payload!.renditions[0]!, storageKeyFor: keyFor }), { verdict: "keep", why: "legacy-no-reason" });
});

test("upload rollback journals renditions as upload-rollback and the verifier keeps them", async () => {
  const { deps } = makeDeps();
  const media = await uploadOne(deps, "rolled");
  const thumbSha = sha("t3");
  await deps.renditionRepo.save({ id: "t", workspaceId: WS, assetId: media.id, transformName: "thumb", version: 1, storageKey: keyFor({ workspaceId: WS, sha256: thumbSha }), sha256: thumbSha, createdAt: "now" });
  const payloads: JournalPayload[] = [];
  await rollbackUploadedMedia({ deps: { ...deps, cleanupJournal: async (input: JournalPayload) => { payloads.push(input); } }, input: { workspaceId: WS, media } });
  assert.equal(payloads[0]!.reason, "upload-rollback");
  assert.deepEqual(classifyJournalEntry({ entry: payloads[0]!.renditions[0]!, storageKeyFor: keyFor }), { verdict: "keep", why: "upload-rollback" });
});

test("legacy tombstone without reason is never unlinked; trash-ttl stays dark by default", () => {
  const s = sha("x");
  const base = { workspaceId: WS, storageKey: keyFor({ workspaceId: WS, sha256: s }), sha256: s, role: "original" as const };
  assert.deepEqual(classifyJournalEntry({ entry: base, storageKeyFor: keyFor }), { verdict: "keep", why: "legacy-no-reason" });
  assert.deepEqual(classifyJournalEntry({ entry: { ...base, reason: "trash-ttl" }, storageKeyFor: keyFor }), { verdict: "keep", why: "trash-ttl-disabled" });
  assert.deepEqual(classifyJournalEntry({ entry: { ...base, reason: "trash-ttl" }, storageKeyFor: keyFor }, { allowTrashTtl: true }), { verdict: "candidate" });
  assert.deepEqual(classifyJournalEntry({ entry: { ...base, reason: "owner-purge" }, storageKeyFor: keyFor }), { verdict: "candidate" });
  assert.deepEqual(classifyJournalEntry({ entry: { ...base, reason: "manual" as never }, storageKeyFor: keyFor }), { verdict: "keep", why: "unknown-reason" });
  assert.deepEqual(classifyJournalEntry({ entry: { ...base, role: undefined as never, reason: "owner-purge" }, storageKeyFor: keyFor }), { verdict: "keep", why: "unknown-role" });
});

test("an entry whose digest is invalid or disagrees with its key is kept", () => {
  const s = sha("y");
  const entry = { workspaceId: WS, storageKey: keyFor({ workspaceId: WS, sha256: s }), sha256: s, role: "rendition" as const, reason: "owner-purge" as const };
  assert.deepEqual(classifyJournalEntry({ entry: { ...entry, sha256: "short" }, storageKeyFor: keyFor }), { verdict: "keep", why: "invalid-digest" });
  assert.deepEqual(classifyJournalEntry({ entry: { ...entry, sha256: sha("other") }, storageKeyFor: keyFor }), { verdict: "keep", why: "key-digest-mismatch" });
});

test("plan keeps conflicting digests for one key out of the journal", () => {
  const a = sha("a"), b = sha("b");
  const plan = planRenditionJournal({ workspaceId: WS, original: { storageKey: "orig" }, reason: "owner-purge",
    renditions: [{ storageKey: "k", sha256: a }, { storageKey: "k", sha256: b }, { storageKey: "orig", sha256: sha("o") }] });
  assert.deepEqual(plan, { renditions: [], unverifiedKeys: ["k"] });
});

test("every upload claim clears journal eligibility for its key after ownership is active", async () => {
  const { deps, cleared } = makeDeps();
  const first = await uploadOne(deps, "same-bytes");
  const key = keyFor({ workspaceId: WS, sha256: first.source.sha256 });
  await uploadOne(deps, "same-bytes"); // dedup hit
  await trashMedia({ deps, input: { workspaceId: WS, id: first.id } });
  await purgeMedia({ deps, input: { workspaceId: WS, id: first.id } });
  await uploadOne(deps, "same-bytes"); // third owner; blob stayed active via the second
  assert.deepEqual(cleared.map(call => call.keys), [[key], [key], [key]]);
  assert.equal(cleared.every(call => call.activeAtClear), true);
});

test("a tombstone resurrection clears journal eligibility for the resurrected key", async () => {
  const { deps, cleared } = makeDeps();
  const media = await uploadOne(deps, "resurrect-me");
  await trashMedia({ deps, input: { workspaceId: WS, id: media.id } });
  await purgeMedia({ deps, input: { workspaceId: WS, id: media.id } });
  assert.equal((await deps.blobRepo.findByHash({ workspaceId: WS, sha256: media.source.sha256 }))!.status, "tombstoned");
  cleared.length = 0;
  await uploadOne(deps, "resurrect-me");
  assert.deepEqual(cleared, [{ keys: [keyFor({ workspaceId: WS, sha256: media.source.sha256 })], activeAtClear: true }]);
});

test("the original passthrough row records the source digest", async () => {
  const { deps } = makeDeps();
  const media = await uploadOne(deps, "passthrough");
  const [row] = await deps.renditionRepo.listByAsset({ workspaceId: WS, assetId: media.id });
  assert.equal(row!.sha256, media.source.sha256);
});

test("a rendition write records its own output digest and clears eligibility for its key", async () => {
  const { deps, cleared } = makeDeps();
  const media = await uploadOne(deps, "render-source");
  await registerTransform({ deps, input: { workspaceId: WS, name: "public", params: { format: "webp" }, owner: "core" } });
  cleared.length = 0;
  await resolveMediaRendition({ deps, input: { workspaceId: WS, assetId: media.id, transformName: "public", version: 1 } });
  const row = (await deps.renditionRepo.listByAsset({ workspaceId: WS, assetId: media.id })).find(r => r.transformName === "public")!;
  const stored = await deps.blobStore.get({ storageKey: row.storageKey });
  assert.equal(row.sha256, createHash("sha256").update(stored!).digest("hex"));
  assert.notEqual(row.sha256, media.source.sha256);
  assert.deepEqual(cleared.map(call => call.keys), [[row.storageKey]]);
});

test("an import claiming a key clears its journal eligibility after the row is active", async () => {
  const { deps } = makeDeps();
  const media = await uploadOne(deps, "imported-bytes");
  const cleared: Array<{ keys: readonly string[]; active: boolean }> = [];
  let n = 0;
  const assetBlobRepo = new InMemoryAssetBlobRepo({});
  const importDeps = {
    mediaRepo: new InMemoryVersionedMediaRepo({}), assetBlobRepo, blobStore: new InMemoryBlobStore(),
    blobFence: { withKeys: async <T>({ work }: { work: () => Promise<T> }) => work(), withAsset: async <T>({ work }: { work: () => Promise<T> }) => work() },
    storageKeyFor: keyFor, verifyStoredBlob: async () => {},
    createHash, clock: { nowIso: () => "2026-09-18T00:00:00.000Z" }, idGen: { newId: () => `g-${++n}` },
    sha256: { isValidSha256Hex, bytesMatchSha256 }, outwardErrorMessage: ({ error }: { error: Error }) => error.message,
    journalEligibility: { clearForKeys: async ({ workspaceId, storageKeys }: { workspaceId: string; storageKeys: readonly string[] }) => {
      const row = await assetBlobRepo.findByHash({ workspaceId, sha256: media.source.sha256 });
      cleared.push({ keys: [...storageKeys], active: row?.status === "active" });
    } },
  } satisfies ImportMediaEntityDeps;
  await importMediaEntity({ deps: importDeps, input: { workspaceId: WS, record: media, bytes: new TextEncoder().encode("imported-bytes"), blobCreatedByPrincipal: "importer", baseVersion: null } });
  assert.deepEqual(cleared, [{ keys: [keyFor({ workspaceId: WS, sha256: media.source.sha256 })], active: true }]);
});

test("a file replacement clears journal eligibility for the key it now owns", async () => {
  const { deps, cleared } = makeDeps();
  const media = await uploadOne(deps, "before-replace");
  const mediaRepo: MediaFileReplacementRepoPort = Object.assign(deps.mediaRepo, {
    replaceFileIfVersion: async () => ({ applied: true }), saveRenditionIfSource: async () => ({ applied: true }),
  });
  cleared.length = 0;
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await replaceMediaFile({ deps: { createHash, workspaceId: WS, clock: deps.clock, idGen: deps.idGen, mediaRepo, assetBlobRepo: deps.blobRepo, blobStore: deps.blobStore,
    journalEligibility: deps.journalEligibility }, media, bytes, contentType: "image/jpeg", principalId: "owner" });
  const newKey = keyFor({ workspaceId: WS, sha256: createHash("sha256").update(bytes).digest("hex") });
  assert.deepEqual(cleared, [{ keys: [newKey], activeAtClear: true }]);
});
