import { createRepoPublishHandler } from "../../../publish/content/repo-handler.js";
import { bytesMatchSha256, isValidSha256Hex } from "../../../publish/transfer/blob-staging.js";
import { expect, it, vi } from "vitest";
import { contributeMediaPublish } from "../publish-content.js";
import { bindMediaPublishContributor, MediaApplyBlockedError } from "../publish-content.js";
import { createHash } from "node:crypto";
import { InMemoryAssetBlobRepo, InMemoryBlobStore, InMemoryVersionedMediaRepo, computeBlobStorageKey, type MediaRecord } from "../../index.js";
import { createHostBlobWriteBindings } from "../blob-write-bindings.js";
import { InMemoryMediaContentTypeStore } from "../content-type-store.js";
import { InMemoryChangeSetRepo } from "../../../core/commands/repo.memory.js";
import { InMemoryOutbox } from "../../../redirects/__tests__/support/events.fixture.js";

it("refuses a missing staged blob without writing media", async () => {
  const save = vi.fn();
  const sha256 = "a".repeat(64);
  const handler = contributeMediaPublish({ createRepoPublishHandler }).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" },
    ports: { media: { createHash, sha256: { bytesMatchSha256, isValidSha256Hex }, repo: { findById: async () => null, findBySlug: async () => null, list: async () => [], save },
      assetBlobRepo: { findByHash: async () => null }, blobStore: { exists: async () => false } } } } as unknown as Parameters<ReturnType<typeof contributeMediaPublish>["build"]>[0]);
  const entity = { entityType: "media", id: "id", schemaVersion: 1, contentHash: "hash", hashVersion: 1, requiredBlobs: [sha256],
    state: { kind: "media", slug: "image", source: { sha256 } } };
  expect(await handler.precheck({ entity })).toBe(`required blob '${sha256}' is not available on this destination`);
  expect(save).not.toHaveBeenCalled();
});

async function boundFixture() {
  const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const repo = new InMemoryVersionedMediaRepo({});
  const blobStore = new InMemoryBlobStore();
  const contentTypeStore = new InMemoryMediaContentTypeStore();
  const media = { repo, blobStore, assetBlobRepo: new InMemoryAssetBlobRepo({}), contentTypeStore };
  await blobStore.put({ workspaceId: "site", sha256, bytes });
  const createBlobWriteBindings = vi.fn(createHostBlobWriteBindings);
  const uploadCaps = { maxUploadBytes: 1024, maxVideoUploadBytes: 2048 };
  const deps = { workspaceId: "site", clock: { nowMs: () => 0 }, idGen: { newId: () => "change" },
    authorize: async () => ({ allowed: true, reason: "grant" }), mutationActor: { id: "human", kind: "user" as const }, outbox: new InMemoryOutbox(), changeSets: new InMemoryChangeSetRepo(), ports: { media } };
  const record: MediaRecord = { id: "video", workspaceId: "site", kind: "media", title: "Video", slug: "video", alt: "", caption: "", credit: "",
    source: { sha256 }, status: "active", createdAt: "now", updatedAt: "now", version: 1, width: null, height: null, cssClass: null, htmlAttributes: null };
  const entity = { entityType: "media", id: "video", schemaVersion: 1, hashVersion: 1, contentHash: "hash", requiredBlobs: [sha256], state: { ...record } };
  const { contributeMediaPublish: bound } = bindMediaPublishContributor({ createRepoPublishHandler, sha256: { bytesMatchSha256, isValidSha256Hex }, createHash, createBlobWriteBindings, uploadCaps });
  const handler = bound().build(deps);
  return { deps, media, repo, blobStore, contentTypeStore, record, entity, handler, createBlobWriteBindings, uploadCaps };
}

it("bound ports match the existing contributor without adding writer fields to the bag", async () => {
  const f = await boundFixture();
  const direct = contributeMediaPublish({ createRepoPublishHandler }).build({ ...f.deps, ports: { media: { ...f.media, createHash, sha256: { bytesMatchSha256, isValidSha256Hex }, createBlobWriteBindings: f.createBlobWriteBindings, uploadCaps: f.uploadCaps } } });
  const precheck = await f.handler.precheck({ entity: f.entity });
  expect(precheck).toBe(await direct.precheck({ entity: f.entity }));
  expect(f.handler.permission).toBe(direct.permission);
  expect(f.handler.permission).toBe("content.write");
  expect(precheck).toBeNull();
  expect(f.media).not.toHaveProperty("uploadCaps");
  expect(f.media).not.toHaveProperty("createBlobWriteBindings");
});

it("the bound contributor records the normalized video's sniffed content type", async () => {
  const f = await boundFixture();
  const entity = { ...f.entity, state: { ...f.entity.state, source: { ...f.record.source, contentType: "video/webm" } } };
  await f.handler.apply({ entity, expectedVersion: undefined, principalId: "human", idempotencyKey: "video" });
  expect(await f.contentTypeStore.getMany({ workspaceId: "site", sha256s: [f.record.source.sha256] })).toEqual(new Map([[f.record.source.sha256, "video/mp4"]]));
  expect((await f.repo.findById({ workspaceId: "site", id: "video" }))?.source.sha256).toBe(f.record.source.sha256);
  expect(f.createBlobWriteBindings).toHaveBeenCalledWith({ blobStore: f.blobStore, bytesMatchSha256 });
});

it("the bound contributor refuses Library documents and missing blobs without writes", async () => {
  const f = await boundFixture();
  const insert = vi.spyOn(f.repo, "insertIfAbsent");
  const document = { ...f.entity, state: { ...f.entity.state, kind: "document" } };
  expect(await f.handler.precheck({ entity: document })).toBe("Library documents cannot be published");
  await expect(f.handler.apply({ entity: document, expectedVersion: undefined, principalId: "human", idempotencyKey: "document" })).rejects.toBeInstanceOf(MediaApplyBlockedError);
  await f.blobStore.remove({ storageKey: computeBlobStorageKey({ workspaceId: "site", sha256: f.record.source.sha256 }) });
  expect(await f.handler.precheck({ entity: f.entity })).toContain("is not available");
  expect(insert).not.toHaveBeenCalled();
  expect(await f.repo.findById({ workspaceId: "site", id: "video" })).toBeNull();
});

it("pack carries poster references with a stable content hash and excludes Library documents", async () => {
  const f = await boundFixture();
  const poster = '/m/club-cover/original';
  const asset = { ...f.record, htmlAttributes: `poster="${poster}"`, originalFilename: "camera.mov", createdBy: "first-editor" };
  await f.repo.save(asset);
  await f.repo.save({ ...f.record, id: "private-notes", slug: "private-notes", kind: "document" });
  const collect = async () => {
    const entities = [];
    for await (const entity of f.handler.pack()) entities.push(entity);
    return entities;
  };
  const [packed, ...rest] = await collect();
  expect(rest).toEqual([]);
  expect(packed).toMatchObject({ id: "video", requiredBlobs: [f.record.source.sha256],
    state: { htmlAttributes: `poster="${poster}"`, createdBy: "first-editor" } });
  expect(packed?.state).not.toHaveProperty("originalFilename");
  expect(f.handler.references!({ entity: packed! })).toEqual([{ entityType: "media", key: "club-cover" }]);
  await f.repo.remove({ workspaceId: "site", id: "video" });
  await f.repo.save({ ...asset, originalFilename: "renamed.mp4", createdBy: "rewritten-owner" });
  const [updated] = await collect();
  expect(updated?.state).toMatchObject({ createdBy: "rewritten-owner" });
  expect(updated?.state).not.toHaveProperty("originalFilename");
  expect(updated?.contentHash).toBe(packed?.contentHash);
});

it("a missing staged source becomes a blocked row at apply and does not persist media", async () => {
  const f = await boundFixture();
  const sha256 = f.record.source.sha256;
  await f.blobStore.remove({ storageKey: computeBlobStorageKey({ workspaceId: "site", sha256 }) });
  const promise = f.handler.apply({ entity: f.entity, expectedVersion: undefined, principalId: "human", idempotencyKey: "video-missing" });
  await expect(promise).rejects.toBeInstanceOf(MediaApplyBlockedError);
  await expect(promise).rejects.toMatchObject({ code: "blocked:missing-blob",
    message: `media 'video' cannot be applied — required blob '${sha256}' was never received by this destination` });
  expect(await f.repo.findById({ workspaceId: "site", id: "video" })).toBeNull();
  expect(await f.deps.changeSets.listByWorkspace({ workspaceId: "site" })).toEqual([]);
});

it("a failed publish-audit insert restores the prior media metadata and version", async () => {
  const f = await boundFixture();
  const args = { principalId: "human" };
  await f.handler.apply({ ...args, entity: f.entity, expectedVersion: undefined, idempotencyKey: "first" });
  const key = { workspaceId: "site", id: "video" };
  const before = await f.repo.findById(key);
  expect(before).toMatchObject({ title: "Video", version: 1 });
  const failure = new Error("change-set store unavailable");
  vi.spyOn(f.deps.changeSets, "insert").mockRejectedValueOnce(failure);
  const renamed = { ...f.entity, state: { ...f.entity.state, title: "Edited video" } };
  await expect(f.handler.apply({ ...args, entity: renamed, expectedVersion: 1, idempotencyKey: "update" })).rejects.toBe(failure);
  expect(await f.repo.findById(key)).toEqual(before);
  expect((await f.deps.changeSets.listByWorkspace({ workspaceId: "site" })).map(row => row.idempotencyKey)).toEqual(["first"]);
});
