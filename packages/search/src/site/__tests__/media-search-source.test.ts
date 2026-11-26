import { expect, it, vi } from "vitest";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";
import { encodeSearchKey } from "../../index.js";
import { createMediaSearchAccessPort, createMediaSearchSource, isPublicSearchImage, MEDIA_SEARCH_COLLECTION } from "../media-search-source.js";

it("a public indexed image made private is refused by the live access read", async () => {
  const key = { siteId: "site", workspaceId: "w", collection: MEDIA_SEARCH_COLLECTION, documentId: "image" };
  let record = { id: "image", workspaceId: "w", kind: "media", status: "active", version: 1, updatedAt: "2026-01-01", title: "Image", description: "Description", source: { sha256: "hash", contentType: "image/png" } } as MediaRecord;
  const loadMedia = vi.fn(async () => record);
  const access = createMediaSearchAccessPort({ loadMedia, publicAccess: isPublicSearchImage });
  const source = createMediaSearchSource({ loadMedia, scanMedia: async () => ({ records: [record] }), publicAccess: isPublicSearchImage, publicPath: () => "/m/image", now: () => 0 });
  expect((await source.load({ ...key, occurredAtMs: 0 })).document?.body).toBe("Description");
  expect(await access.visibleKeys({ siteId: "site", keys: [key] })).toEqual(new Set([encodeSearchKey({ key })]));
  record = { ...record, source: { ...record.source, private: true } };
  expect(await access.visibleKeys({ siteId: "site", keys: [key] })).toEqual(new Set());
  expect((await source.load({ ...key, occurredAtMs: 0 })).document).toBeNull();
});
