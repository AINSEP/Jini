import { expect, it, vi } from "vitest";
import { InMemoryVersionedMediaRepo } from "../../versioned-repo.js";
import { InMemoryAssetBlobRepo } from "../../repo.memory.js";
import { InMemoryBlobStore } from "../../blob-store.memory.js";
import type { MediaRecord } from "../../types.js";
import type { MediaPublishPorts } from "../../publish-ports.js";
import type { PackedEntity } from "../../../publish/transfer/index.js";
import { InMemoryMediaContentTypeStore } from "../content-type-store.js";
import { verifyPublishedMedia } from "../verify-published-media.js";

const workspaceId = "workspace";
const sha256 = "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6";
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const record: MediaRecord = {
  id: "video", workspaceId, title: "Video", slug: "intro", alt: "", caption: "", credit: "",
  source: { sha256 }, status: "active", createdAt: "created", updatedAt: "updated", version: 1,
  width: null, height: null, cssClass: null, htmlAttributes: null,
};
const entity: PackedEntity = {
  entityType: "media", id: record.id, state: { ...record }, schemaVersion: 1, hashVersion: 1,
  contentHash: "unused", requiredBlobs: [sha256],
};
const orFallback: Parameters<typeof verifyPublishedMedia>[0]["orFallback"] = async ({ work, fallback }) => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

function ports(records: MediaRecord[]): MediaPublishPorts {
  return {
    repo: new InMemoryVersionedMediaRepo({}, { initialRows: records }),
    assetBlobRepo: new InMemoryAssetBlobRepo({}),
    blobStore: new InMemoryBlobStore(),
    contentTypeStore: new InMemoryMediaContentTypeStore(),
  };
}

it("sniffs and persists a missing type only in the receiving workspace", async () => {
  const p = ports([record]);
  await p.blobStore.putIfAbsent({ workspaceId, sha256, bytes });
  expect(await p.contentTypeStore.getMany({ workspaceId, sha256s: [sha256] })).toEqual(new Map());
  expect(await verifyPublishedMedia({ ports: p, workspaceId, entities: [entity], orFallback })).toEqual([]);
  expect(await p.contentTypeStore.getMany({ workspaceId, sha256s: [sha256] })).toEqual(new Map([[sha256, "image/png"]]));
  expect(await p.contentTypeStore.getMany({ workspaceId: "other", sha256s: [sha256] })).toEqual(new Map());
});

it("reports a failed repair and still checks the next item", async () => {
  const p = ports([record]);
  await p.blobStore.putIfAbsent({ workspaceId, sha256, bytes });
  vi.spyOn(p.blobStore, "get").mockRejectedValue(new Error("storage unavailable"));
  const missing: PackedEntity = { ...entity, id: "missing", state: { ...entity.state, slug: "lost-photo" } };
  expect(await verifyPublishedMedia({ ports: p, workspaceId, entities: [entity, missing], orFallback })).toEqual([
    "Media 'intro': the site could not read its file type, so a video may show as a broken image.",
    "Media 'lost-photo' was published but is not on the site.",
  ]);
  expect(await p.contentTypeStore.getMany({ workspaceId, sha256s: [sha256] })).toEqual(new Map());
});

it("does not access blobs for an inactive row", async () => {
  const p = ports([{ ...record, status: "trashed" }]);
  const get = vi.spyOn(p.blobStore, "get");
  const exists = vi.spyOn(p.blobStore, "exists");
  expect(await verifyPublishedMedia({ ports: p, workspaceId, entities: [entity], orFallback })).toEqual([]);
  expect(get).not.toHaveBeenCalled();
  expect(exists).not.toHaveBeenCalled();
});

it("warns when a referenced poster is absent", async () => {
  const p = ports([{ ...record, htmlAttributes: '{"poster":"/m/missing-poster/original"}' }]);
  await p.blobStore.putIfAbsent({ workspaceId, sha256, bytes });
  await p.contentTypeStore.set({ workspaceId, sha256, contentType: "image/png" });
  expect(await verifyPublishedMedia({ ports: p, workspaceId, entities: [entity], orFallback })).toEqual([
    "Media 'intro' uses 'missing-poster' in its HTML attributes, but 'missing-poster' is not on the site, so it will not load.",
  ]);
});

it("propagates a failed batched type read", async () => {
  const p = ports([record]);
  const error = new Error("type storage unavailable");
  vi.spyOn(p.contentTypeStore, "getMany").mockRejectedValue(error);
  await expect(verifyPublishedMedia({ ports: p, workspaceId, entities: [entity], orFallback })).rejects.toBe(error);
});

it("reports a missing published file without attempting to infer the type from absent bytes", async () => {
  const p = ports([record]);
  const get = vi.spyOn(p.blobStore, "get");
  expect(await verifyPublishedMedia({ ports: p, workspaceId, entities: [entity], orFallback })).toEqual([
    "Media 'intro' is on the site without its file, so it cannot be shown.",
  ]);
  expect(get.mock.calls).toEqual([]);
});
