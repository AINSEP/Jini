import { expect, it, vi } from "vitest";
import { contributeMediaPublish } from "../publish-content.js";
import { bindMediaPublishContributor, MediaApplyBlockedError } from "../publish-content.js";
import { createHash } from "node:crypto";
import { InMemoryAssetBlobRepo, InMemoryBlobStore, InMemoryVersionedMediaRepo, computeBlobStorageKey, type MediaRecord } from "../../index.js";
import { createHostBlobWriteBindings } from "../blob-write-bindings.js";
import { InMemoryMediaContentTypeStore } from "../content-type-store.js";
import { InMemoryChangeSetRepo } from "../../../core/commands/repo.memory.js";

it("refuses a missing staged blob without writing media", async () => {
  const save = vi.fn();
  const sha256 = "a".repeat(64);
  const handler = contributeMediaPublish().build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" },
    ports: { media: { repo: { findById: async () => null, findBySlug: async () => null, list: async () => [], save },
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
    authorize: async () => ({ allowed: true, reason: "grant" }), outbox: { enqueue: async () => {} }, changeSets: new InMemoryChangeSetRepo(), ports: { media } };
  const record: MediaRecord = { id: "video", workspaceId: "site", kind: "media", title: "Video", slug: "video", alt: "", caption: "", credit: "",
    source: { sha256 }, status: "active", createdAt: "now", updatedAt: "now", version: 1, width: null, height: null, cssClass: null, htmlAttributes: null };
  const entity = { entityType: "media", id: "video", schemaVersion: 1, hashVersion: 1, contentHash: "hash", requiredBlobs: [sha256], state: { ...record } };
  const { contributeMediaPublish: bound } = bindMediaPublishContributor({ createBlobWriteBindings, uploadCaps });
  const handler = bound().build(deps);
  return { deps, media, repo, blobStore, contentTypeStore, record, entity, handler, createBlobWriteBindings, uploadCaps };
}

it("bound ports match the existing contributor without adding writer fields to the bag", async () => {
  const f = await boundFixture();
  const direct = contributeMediaPublish().build({ ...f.deps, ports: { media: { ...f.media, createBlobWriteBindings: f.createBlobWriteBindings, uploadCaps: f.uploadCaps } } });
  expect(await f.handler.precheck({ entity: f.entity })).toBe(await direct.precheck({ entity: f.entity }));
  expect(f.handler.permission).toBe(direct.permission);
  expect(f.media).not.toHaveProperty("uploadCaps");
  expect(f.media).not.toHaveProperty("createBlobWriteBindings");
});

it("the bound contributor records the normalized video's sniffed content type", async () => {
  const f = await boundFixture();
  await f.handler.apply({ entity: f.entity, expectedVersion: undefined, principalId: "human", idempotencyKey: "video" });
  expect(await f.contentTypeStore.getMany({ workspaceId: "site", sha256s: [f.record.source.sha256] })).toEqual(new Map([[f.record.source.sha256, "video/mp4"]]));
  expect((await f.repo.findById({ workspaceId: "site", id: "video" }))?.source.sha256).toBe(f.record.source.sha256);
  expect(f.createBlobWriteBindings).toHaveBeenCalledWith({ blobStore: f.blobStore });
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
