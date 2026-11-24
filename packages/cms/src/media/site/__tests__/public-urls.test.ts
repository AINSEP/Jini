import { describe, expect, it, vi } from "vitest";
import type { MediaRecord, TransformDefinitionRecord, TransformDefinitionRepoPort } from "../../index.js";
import { CORE_PUBLIC_TRANSFORM_NAME } from "../bootstrap.js";
import { resolveMediaPublicUrls } from "../public-urls.js";

/** @file The batched `/m/...` URL resolution over injected lookup ports (fakes; the host binding pins the real stores). */

const W = "ws-1";
const NOW = "2026-09-03T00:00:00.000Z";

function asset(id: string, overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id, workspaceId: W, title: "", slug: "", alt: "", caption: "", credit: "", source: { sha256: `sha-${id}-0123456789` },
    status: "active", createdAt: NOW, updatedAt: NOW, version: 1, width: null, height: null, cssClass: null, htmlAttributes: null, ...overrides,
  } as MediaRecord;
}

const v = (a: MediaRecord) => a.source.sha256.slice(0, 12);

function typeStore(types: Record<string, string>) {
  return { getMany: vi.fn(async ({ sha256s }: { workspaceId: string; sha256s: string[] }) => new Map(sha256s.filter((s) => types[s]).map((s) => [s, types[s]!]))) };
}

function transforms(rows: Array<{ version: number; format: string }>, workspaceId = W): TransformDefinitionRepoPort & { listByName: ReturnType<typeof vi.fn> } {
  const records = rows.map((r) => ({ id: `t${r.version}`, workspaceId, name: CORE_PUBLIC_TRANSFORM_NAME, version: r.version, params: { format: r.format }, owner: "core", createdAt: NOW })) as unknown as TransformDefinitionRecord[];
  return {
    listByName: vi.fn(async (q: { workspaceId: string; name: string }) => records.filter((r) => r.workspaceId === q.workspaceId && r.name === q.name)),
    findByNameVersion: vi.fn(async () => null),
    insert: vi.fn(async () => { throw new Error("read-only"); }),
  } as unknown as TransformDefinitionRepoPort & { listByName: ReturnType<typeof vi.fn> };
}

describe("resolveMediaPublicUrls", () => {
  it("resolves every asset to null when no content-type store is wired", async () => {
    const a = asset("a");
    const result = await resolveMediaPublicUrls({ assets: [a], workspaceId: W, contentTypeStore: null, transformRepo: transforms([{ version: 1, format: "webp" }]) });
    expect(result.get("a")).toBeNull();
  });

  it("returns an empty map for no assets and consults no port for an all-trashed or document batch", async () => {
    const store = typeStore({});
    const repo = transforms([{ version: 1, format: "webp" }]);
    expect((await resolveMediaPublicUrls({ assets: [], workspaceId: W, contentTypeStore: store, transformRepo: repo })).size).toBe(0);
    const result = await resolveMediaPublicUrls({ assets: [asset("t", { status: "trashed" }), asset("d", { kind: "document" })], workspaceId: W, contentTypeStore: store, transformRepo: repo });
    expect([...result]).toEqual([["t", null], ["d", null]]);
    expect(store.getMany).not.toHaveBeenCalled();
    expect(repo.listByName).not.toHaveBeenCalled();
  });

  it("keys the URL by slug when valid, else by id, with the source hash as the cache key", async () => {
    const repo = transforms([{ version: 1, format: "webp" }]);
    const bySlug = asset("a", { slug: "cover-photo" });
    const byId = asset("b");
    const result = await resolveMediaPublicUrls({ assets: [bySlug, byId], workspaceId: W, contentTypeStore: typeStore({}), transformRepo: repo });
    expect(result.get("a")).toBe(`/m/cover-photo/${CORE_PUBLIC_TRANSFORM_NAME}.v1/image.webp?v=${v(bySlug)}`);
    expect(result.get("b")).toBe(`/m/b/${CORE_PUBLIC_TRANSFORM_NAME}.v1/image.webp?v=${v(byId)}`);
  });

  it("uses the latest public transform revision for version and format, mapping jpeg to jpg", async () => {
    const a = asset("a");
    const result = await resolveMediaPublicUrls({ assets: [a], workspaceId: W, contentTypeStore: typeStore({}), transformRepo: transforms([{ version: 1, format: "webp" }, { version: 2, format: "jpeg" }]) });
    expect(result.get("a")).toBe(`/m/a/${CORE_PUBLIC_TRANSFORM_NAME}.v2/image.jpg?v=${v(a)}`);
  });

  it("falls back to the raw format string outside the known extension set", async () => {
    const a = asset("a");
    const result = await resolveMediaPublicUrls({ assets: [a], workspaceId: W, contentTypeStore: typeStore({}), transformRepo: transforms([{ version: 1, format: "avif" }]) });
    expect(result.get("a")).toBe(`/m/a/${CORE_PUBLIC_TRANSFORM_NAME}.v1/image.avif?v=${v(a)}`);
  });

  it("resolves an image to null when no public transform is registered, or the repo is another workspace's, or the port is unwired", async () => {
    const a = asset("a");
    const store = typeStore({});
    expect((await resolveMediaPublicUrls({ assets: [a], workspaceId: W, contentTypeStore: store, transformRepo: transforms([]) })).get("a")).toBeNull();
    expect((await resolveMediaPublicUrls({ assets: [a], workspaceId: W, contentTypeStore: store, transformRepo: transforms([{ version: 1, format: "png" }], "other") })).get("a")).toBeNull();
    expect((await resolveMediaPublicUrls({ assets: [a], workspaceId: W, contentTypeStore: store, transformRepo: null })).get("a")).toBeNull();
  });

  it("resolves SVG, video and audio to the byte-passthrough original without a transform, in one batched lookup", async () => {
    const svg = asset("s", { slug: "vector-logo" }), video = asset("v", { slug: "clip" }), audio = asset("au", { slug: "sound" }), image = asset("i");
    const store = typeStore({ [svg.source.sha256]: "image/svg+xml", [video.source.sha256]: "video/mp4", [audio.source.sha256]: "audio/mpeg", [image.source.sha256]: "image/png" });
    const result = await resolveMediaPublicUrls({ assets: [svg, video, audio, image], workspaceId: W, contentTypeStore: store, transformRepo: null });
    expect(Object.fromEntries(result)).toEqual({
      s: `/m/vector-logo/original.svg?v=${v(svg)}`,
      v: `/m/clip/original.mp4?v=${v(video)}`,
      au: `/m/sound/original.mp3?v=${v(audio)}`,
      i: null,
    });
    expect(store.getMany).toHaveBeenCalledTimes(1);
  });

  it("does not let a video asset depend on the registered image transform", async () => {
    const video = asset("v");
    const repo = transforms([{ version: 3, format: "webp" }]);
    const result = await resolveMediaPublicUrls({ assets: [video], workspaceId: W, contentTypeStore: typeStore({ [video.source.sha256]: "video/webm" }), transformRepo: repo });
    expect(result.get("v")).toBe(`/m/v/original.webm?v=${v(video)}`);
  });
});
