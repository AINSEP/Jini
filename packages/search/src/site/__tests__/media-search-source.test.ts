import { expect, it, vi } from "vitest";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";
import { encodeSearchKey } from "../../index.js";
import {
  createMediaSearchAccessPort, createMediaSearchChangeSink, createMediaSearchSource,
  isPublicSearchImage, MEDIA_SEARCH_COLLECTION, unionSearchAccessPorts, type MediaSearchPorts,
} from "../media-search-source.js";

const updatedAt = "2026-01-01T00:00:00.000Z";
const image = (id: string, overrides: Partial<MediaRecord> = {}): MediaRecord => ({
  id, workspaceId: "w", kind: "media", status: "active", version: 5, createdAt: updatedAt, updatedAt,
  title: `Title for ${id}`, slug: id, alt: "Alternative text", credit: "Photographer", caption: "Image caption",
  width: null, height: null, cssClass: null, htmlAttributes: null,
  source: { sha256: "hash", contentType: "image/png" }, ...overrides,
});

function mediaSource(overrides: Partial<MediaSearchPorts> = {}) {
  return createMediaSearchSource({
    loadMedia: async () => { throw new Error("unexpected media lookup"); },
    scanMedia: async () => { throw new Error("unexpected media scan"); },
    publicAccess: isPublicSearchImage,
    publicPath: ({ record }) => `/m/${record.slug}`,
    now: () => Date.parse(updatedAt) + 300,
    ...overrides,
  });
}

it("a public indexed image made private is refused by the live access read", async () => {
  const key = { siteId: "site", workspaceId: "w", collection: MEDIA_SEARCH_COLLECTION, documentId: "image" };
  let record = { id: "image", workspaceId: "w", kind: "media", status: "active", version: 1, updatedAt: "2026-01-01", title: "Image", description: "Description", source: { sha256: "hash", contentType: "image/png" } } as MediaRecord;
  const loadMedia = vi.fn(async () => record);
  const access = createMediaSearchAccessPort({ loadMedia, publicAccess: isPublicSearchImage });
  const source = createMediaSearchSource({ loadMedia, scanMedia: async () => ({ records: [record] }), publicAccess: isPublicSearchImage, publicPath: () => "/m/image", now: () => 0 });
  expect((await source.load({ ...key, occurredAtMs: 0 })).document?.body).toBe("Description");
  expect(await access.visibleKeys({ siteId: "site", keys: [key], audiences: [] })).toEqual(new Set([encodeSearchKey({ key })]));
  record = { ...record, source: { ...record.source, private: true } };
  expect(await access.visibleKeys({ siteId: "site", keys: [key], audiences: [] })).toEqual(new Set());
  expect((await source.load({ ...key, occurredAtMs: 0 })).document).toBeNull();
});

it("claims media change events by nonempty aggregate id, not by payload", () => {
  const source = mediaSource();
  const event = { name: "media.search_changed", workspaceId: "w", occurredAt: updatedAt, payload: { mediaId: "payload-id" } };
  expect(source.documentIdOf({ event: { ...event, aggregateId: "asset-id" } })).toBe("asset-id");
  expect(source.documentIdOf({ event })).toBeNull();
  expect(source.documentIdOf({ event: { ...event, aggregateId: "" } })).toBeNull();
  expect(source.documentIdOf({ event: { ...event, name: "media.created", aggregateId: "asset-id" } })).toBeNull();
});

it("load turns a missing or foreign-workspace image into a fresh tombstone", async () => {
  const key = { siteId: "site", workspaceId: "w", collection: "media_image", documentId: "lake" };
  const occurredAtMs = Date.parse(updatedAt) + 15;
  let record: MediaRecord | null = image("lake", { description: "A windless lake" });
  const loadMedia = vi.fn<MediaSearchPorts["loadMedia"]>(async ({ workspaceId, id }) => {
    if (workspaceId !== "w" || id !== "lake") throw new Error("incorrect load scope");
    return record;
  });
  const source = mediaSource({ loadMedia });
  expect(await source.load({ ...key, occurredAtMs })).toEqual({
    key, revision: Date.parse(updatedAt) * 1000 + 5,
    document: { key, revision: Date.parse(updatedAt) * 1000 + 5, title: "Title for lake", url: "/m/lake",
      body: "A windless lake", visibility: { kind: "public" } },
  });
  record = image("lake", { workspaceId: "foreign" });
  expect(await source.load({ ...key, occurredAtMs })).toEqual({ key, revision: occurredAtMs * 1000 + 5, document: null });
  record = null;
  expect(await source.load({ ...key, occurredAtMs })).toEqual({ key, revision: occurredAtMs * 1000 + 999, document: null });
  expect(loadMedia.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ workspaceId: "w", id: "lake" }]));
});

it("backfill enforces publication and workspace while honoring the media store cursor", async () => {
  const scanMedia = vi.fn<MediaSearchPorts["scanMedia"]>(async (input, options) => {
    if (input.workspaceId !== "w" || input.limit !== 8) throw new Error("unexpected media scan scope");
    if (options?.cursor === undefined) return {
      records: [
        image("lake", { slug: "blue-lake", description: "A windless lake" }),
        image("other", { workspaceId: "other" }),
        image("library", { kind: "document" }),
        image("trashed", { status: "trashed" }),
        image("private", { source: { sha256: "hash", contentType: "image/png", private: true } }),
        image("video", { source: { sha256: "hash", contentType: "video/mp4" } }),
        image("unknown", { source: { sha256: "hash" } }),
      ],
      nextCursor: "opaque:next",
    };
    if (options.cursor !== "opaque:next") throw new Error("unexpected media cursor");
    return { records: [image("plain")] };
  });
  const source = mediaSource({ scanMedia });
  const input = { siteId: "site", workspaceId: "w", limit: 8 };
  const item = (documentId: string, url: string, body: string) => {
    const key = { siteId: "site", workspaceId: "w", collection: "media_image", documentId };
    const revision = Date.parse(updatedAt) * 1000 + 5;
    return { key, revision, document: { key, revision, url, body, title: `Title for ${documentId}`, visibility: { kind: "public" } } };
  };
  expect(await source.scan(input)).toEqual({
    records: [item("lake", "/m/blue-lake", "A windless lake")], nextCursor: "opaque:next",
  });
  expect(await source.scan(input, { cursor: "opaque:next" })).toEqual({ records: [item("plain", "/m/plain", "")] });
  expect(scanMedia.mock.calls).toEqual([
    [{ workspaceId: "w", limit: 8 }, {}],
    [{ workspaceId: "w", limit: 8 }, { cursor: "opaque:next" }],
  ]);
});

it("unions visibility decisions without showing a denied key", async () => {
  const loadMedia = vi.fn<MediaSearchPorts["loadMedia"]>(async ({ workspaceId, id }) => {
    if (workspaceId !== "w") throw new Error("unexpected lookup workspace");
    if (id === "lake") return image(id);
    if (id === "private") return image(id, { source: { sha256: "hash", private: true, contentType: "image/png" } });
    if (id === "missing") return null;
    if (id === "foreign") return image(id, { workspaceId: "other" });
    throw new Error(`unexpected lookup: ${id}`);
  });
  const key = (collection: string, documentId: string, siteId = "site") => ({ siteId, workspaceId: "w", collection, documentId });
  const input = { siteId: "site", audiences: ["paid"], keys: [
    key("media_image", "lake"), key("media_image", "private"), key("media_image", "missing"),
    key("media_image", "foreign"), key("media_image", "other-site", "site-b"), key("page", "about"), key("page", "draft"),
  ] };
  const pages = vi.fn(async (request: typeof input) => {
    const allowed = request.siteId === "site" && request.audiences.includes("paid")
      && request.keys.some(hit => hit.siteId === "site" && hit.workspaceId === "w" && hit.collection === "page" && hit.documentId === "about");
    return new Set(allowed ? ["site/w/page/about"] : []);
  });
  const port = unionSearchAccessPorts({ ports: [
    createMediaSearchAccessPort({ loadMedia, publicAccess: isPublicSearchImage }),
    { visibleKeys: request => pages({ ...request, keys: [...request.keys], audiences: [...request.audiences] }) },
  ] });
  expect(await port.visibleKeys(input)).toEqual(new Set(["site/w/media_image/lake", "site/w/page/about"]));
  expect(pages.mock.calls).toEqual([[input]]);
  expect(loadMedia.mock.calls).toEqual(["lake", "private", "missing", "foreign"].map(id => [{ workspaceId: "w", id }]));
});

it("enqueues stable write-specific media events but never a Library document event", async () => {
  const enqueue = vi.fn<Parameters<typeof createMediaSearchChangeSink>[0]["outbox"]["enqueue"]>(async () => {});
  const sink = createMediaSearchChangeSink({ outbox: { enqueue }, nowIso: () => updatedAt });
  const input = { workspaceId: "w", mediaId: "lake", kind: "media", marker: "v4" };
  await sink.changed(input);
  await sink.changed(input);
  await sink.changed({ ...input, marker: "purge-v5" });
  await sink.changed({ ...input, mediaId: "library-id", kind: "document" });
  const event = (id: string) => ({
    id, name: "media.search_changed", occurredAt: updatedAt, workspaceId: "w",
    aggregateId: "lake", payload: { mediaId: "lake" },
  });
  expect(enqueue.mock.calls).toEqual([
    [event("media.search_changed:w:lake:v4")],
    [event("media.search_changed:w:lake:v4")],
    [event("media.search_changed:w:lake:purge-v5")],
  ]);
});
