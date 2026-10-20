import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { JsonObject } from "@jini-ai/core/primitives";
import { InMemoryEntryRepo, type EntryRecord } from "../../../entries/index.js";
import {
  InMemoryMediaRepo,
  InMemoryTransformDefinitionRepo,
  findMediaByIdOrSlug,
  getLatestTransformDefinition,
  type MediaRecord,
} from "../../../media/index.js";
import { buildWidgetInstanceFieldsJson } from "../../entry-payload.js";
import type { PageHtmlEmbedRef } from "../../html/html-embeds.js";
import type { MediaContentTypeStorePort, PostRecord, PostRepoPort, WidgetHostPorts } from "../../host-ports.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import { HTML_EMBED_RESOLVERS, resolvePageWidgets, type ResolveHtmlPageEmbedsDeps } from "../../resolver-service.js";
import type { WidgetResolveContext } from "../../types.js";

/**
 * @file Direct coverage for `resolver-service.ts`'s TipTap walkers (`widgetEmbed` and ref-based
 * `image`/`media` nodes), its `media` embed resolver's per-ref decision, and its `content` embed
 * resolver's per-ref decision (preview override vs. published-post lookup).
 */

const WS = "ws-1";
const CTX: WidgetResolveContext = { workspaceId: WS, preview: false };

function mediaRecord(overrides: Partial<MediaRecord> & Pick<MediaRecord, "id">): MediaRecord {
  return {
    workspaceId: WS, title: overrides.id, slug: `${overrides.id}-slug`, alt: "Alt", caption: "", credit: "",
    source: { sha256: `sha-${overrides.id}` }, status: "active", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", version: 1, width: 640, height: 480, cssClass: null, htmlAttributes: null,
    ...overrides,
  };
}

function transform(name: string, version: number) {
  return { id: `${name}-${version}`, workspaceId: WS, name, version, params: { format: "webp" as const }, owner: "core", createdAt: "2026-01-01T00:00:00.000Z" };
}

function ref(overrides: Partial<PageHtmlEmbedRef>): PageHtmlEmbedRef {
  return { type: "media", id: null, slug: null, name: null, variant: null, header: true, ...overrides };
}

function post(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-1", workspaceId: WS, title: "Hello", slug: "hello", bodyJson: { type: "doc", content: [] }, status: "published",
    kind: "post", bodyFormat: "doc", updatedAt: "2026-02-01T00:00:00.000Z", version: 1, ...overrides,
  };
}

function contentTypes(types: Record<string, string>): MediaContentTypeStorePort {
  return { getMany: async ({ sha256s }) => new Map(sha256s.flatMap((sha) => (types[sha] ? [[sha, types[sha]!] as const] : []))) };
}

const unexpected = async (): Promise<never> => { throw new Error("unexpected call"); };
const postRepo: PostRepoPort = { findById: unexpected, findBySlug: unexpected };

function hostPorts(posts: readonly PostRecord[] = []): ResolveHtmlPageEmbedsDeps["host"] {
  const postPorts: WidgetHostPorts["posts"] = {
    isTrashed: () => false,
    isVersionConflict: (_error): _error is Error & { currentVersion: number } => false,
    isNotFound: () => false,
    updatePost: unexpected,
    restorePostForward: unexpected,
    findPublishedPostById: async ({ input }) => posts.find((p) => p.id === input.id) ?? null,
    findPublishedPostBySlug: async ({ input }) => posts.find((p) => p.slug === input.slug) ?? null,
  };
  return { media: { findMediaByIdOrSlug, getLatestTransformDefinition, publicTransformName: "public" }, posts: postPorts };
}

function deps(overrides: Partial<ResolveHtmlPageEmbedsDeps> = {}): ResolveHtmlPageEmbedsDeps {
  return {
    entryRepo: new InMemoryEntryRepo(),
    host: hostPorts(),
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [mediaRecord({ id: "a1" }), mediaRecord({ id: "gone", status: "trashed" })] }),
    transformRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [transform("public", 1), transform("public", 3), transform("thumb", 2)] }),
    ...overrides,
  };
}

function widgetRow(id: string, config: Record<string, unknown>): EntryRecord {
  return {
    id, workspaceId: WS, type: "widget", slug: id, status: "draft", title: id, bodyJson: null,
    fieldsJson: buildWidgetInstanceFieldsJson({ payload: { widgetType: "text", config, status: "active" } }),
    publishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1,
  };
}

function embedNode(placementId: unknown, widgetEntryId: unknown, content?: unknown): JsonObject {
  return { type: "widgetEmbed", attrs: { placementId, widgetEntryId, ...(content === undefined ? {} : { content }) } } as JsonObject;
}

const media = (refs: PageHtmlEmbedRef[], d: ResolveHtmlPageEmbedsDeps) => HTML_EMBED_RESOLVERS.media!(refs, d, CTX);
const content = (refs: PageHtmlEmbedRef[], d: ResolveHtmlPageEmbedsDeps) => HTML_EMBED_RESOLVERS.content!(refs, d, CTX);

let warn: MockInstance<typeof console.warn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

function warnedWith(message: string): boolean {
  return warn.mock.calls.some(([first]) => first === message);
}

describe("media embed resolution", () => {
  it("resolves an id through the latest public transform into a media-image IR", async () => {
    const resolved = await media([ref({ id: "a1" })], deps());
    expect(resolved.get("a1")).toEqual({
      componentId: "media-image",
      props: { assetId: "a1", slug: "a1-slug", transformName: "public", version: 3, alt: "Alt", width: 640, height: 480, cssClass: null, htmlAttributes: null },
    });
  });

  it("keys the result by the literal reference while normalizing assetId to the canonical id", async () => {
    const resolved = await media([ref({ id: "a1-slug" })], deps());
    expect(resolved.get("a1-slug")!.props).toMatchObject({ assetId: "a1", slug: "a1-slug" });
  });

  it("looks a slug-only reference up by slug", async () => {
    const resolved = await media([ref({ slug: "a1-slug" })], deps());
    expect(resolved.get("a1-slug")!.props.assetId).toBe("a1");
  });

  it("prefers a slug match over an id match for a slug-only reference", async () => {
    const d = deps({ mediaRepo: new InMemoryMediaRepo({}, { initialRows: [mediaRecord({ id: "x", slug: "other" }), mediaRecord({ id: "b2", slug: "x" })] }) });
    expect((await media([ref({ slug: "x" })], d)).get("x")!.props.assetId).toBe("b2");
  });

  it("uses the marker's variant as the transform name", async () => {
    const resolved = await media([ref({ id: "a1", variant: "thumb" })], deps());
    expect(resolved.get("a1")!.props).toMatchObject({ transformName: "thumb", version: 2 });
  });

  it("emits a null slug for a record with an empty slug", async () => {
    const d = deps({ mediaRepo: new InMemoryMediaRepo({}, { initialRows: [mediaRecord({ id: "a1", slug: "" })] }) });
    expect((await media([ref({ id: "a1" })], d)).get("a1")!.props.slug).toBeNull();
  });

  it("refuses a reference with neither id nor slug", async () => {
    expect((await media([ref({})], deps())).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "media" reference — missing or invalid "id"/"slug"/"variant" in data-embed-config')).toBe(true);
  });

  it("refuses an implausible transform name", async () => {
    expect((await media([ref({ id: "a1", variant: "../x" })], deps())).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "media" reference — missing or invalid "id"/"slug"/"variant" in data-embed-config')).toBe(true);
  });

  it("degrades a missing asset with a no-such-asset warning", async () => {
    expect((await media([ref({ id: "nope" })], deps())).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "media" reference — no such asset')).toBe(true);
  });

  it("degrades a trashed asset with a no-such-asset warning", async () => {
    expect((await media([ref({ id: "gone" })], deps())).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "media" reference — no such asset')).toBe(true);
  });

  it("degrades an unregistered transform with a transform-not-registered warning", async () => {
    expect((await media([ref({ id: "a1", variant: "hero" })], deps())).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "media" reference — transform not registered')).toBe(true);
  });

  it.each(["video/mp4", "audio/mpeg"])("builds a transform-less player IR for %s", async (type) => {
    const resolved = await media([ref({ id: "a1" })], deps({ mediaContentTypeStore: contentTypes({ "sha-a1": type }) }));
    expect(resolved.get("a1")).toEqual({
      componentId: "media-image",
      props: { assetId: "a1", slug: "a1-slug", contentType: type, alt: "Alt", width: 640, height: 480, cssClass: null, htmlAttributes: null },
    });
  });

  it("keeps the image transform path for an image content type", async () => {
    const resolved = await media([ref({ id: "a1" })], deps({ mediaContentTypeStore: contentTypes({ "sha-a1": "image/png" }) }));
    expect(resolved.get("a1")!.props).toMatchObject({ transformName: "public", version: 3 });
  });

  it("keeps the image transform path when the store has no type for the bytes", async () => {
    const resolved = await media([ref({ id: "a1" })], deps({ mediaContentTypeStore: contentTypes({}) }));
    expect(resolved.get("a1")!.props).toMatchObject({ transformName: "public" });
  });

  it("degrades every reference when the media repositories are absent", async () => {
    const { mediaRepo: _absent, ...withoutMediaRepo } = deps();
    expect((await media([ref({ id: "a1" })], withoutMediaRepo)).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: "media" embeds present but no mediaRepo/transformRepo dependency was supplied — every occurrence degrades to the placeholder')).toBe(true);
  });
});

describe("content embed resolution", () => {
  const override = { id: "post-1", title: "Draft", slug: "hello", updatedAt: "2026-03-01T00:00:00.000Z", bodyJson: { type: "doc", content: [] } };
  const emptyContext = { mediaTransformVersions: {}, mediaAssetMetadata: {}, inlineWidgets: {} };

  it("renders a published post found by id as post-content with the occurrence's header", async () => {
    const resolved = await content([ref({ type: "content", id: "post-1", header: false })], deps({ postRepo, host: hostPorts([post({ publishAt: "2026-02-02T00:00:00.000Z" })]) }));
    expect(resolved.get("post-1")).toEqual({
      componentId: "post-content",
      props: { title: "Hello", slug: "hello", updatedAt: "2026-02-01T00:00:00.000Z", publishAt: "2026-02-02T00:00:00.000Z", bodyJson: { type: "doc", content: [] }, header: false, ...emptyContext },
    });
  });

  it("finds a slug-only reference by slug and defaults an absent publishAt to null", async () => {
    const resolved = await content([ref({ type: "content", slug: "hello" })], deps({ postRepo, host: hostPorts([post()]) }));
    expect(resolved.get("hello")!.props).toMatchObject({ title: "Hello", publishAt: null });
  });

  it("refuses a reference with neither id nor slug", async () => {
    expect((await content([ref({ type: "content" })], deps({ postRepo }))).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "content" reference — missing or invalid "id"/"slug" in data-embed-config')).toBe(true);
  });

  it("degrades an unpublished or missing post", async () => {
    expect((await content([ref({ type: "content", id: "missing" })], deps({ postRepo }))).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "content" reference — no such published entity')).toBe(true);
  });

  it("degrades an html-format post reaching the registry resolver", async () => {
    expect((await content([ref({ type: "content", id: "post-1" })], deps({ postRepo, host: hostPorts([post({ bodyFormat: "html" })]) }))).size).toBe(0);
    expect(warn.mock.calls.some(([first]) => String(first).startsWith('[widgets] resolveHtmlPageEmbeds: unresolved "content" reference — html-format entity'))).toBe(true);
  });

  it("substitutes the pending override for a matching id without touching the repository", async () => {
    const resolved = await content([ref({ type: "content", id: "post-1" })], deps({ pendingContentOverride: override }));
    expect(resolved.get("post-1")).toEqual({
      componentId: "post-content",
      props: { title: "Draft", slug: "hello", updatedAt: "2026-03-01T00:00:00.000Z", publishAt: null, bodyJson: override.bodyJson, header: true, ...emptyContext },
    });
  });

  it("keeps the override's own publishAt", async () => {
    const resolved = await content([ref({ type: "content", id: "post-1" })], deps({ pendingContentOverride: { ...override, publishAt: "2026-04-01T00:00:00.000Z" } }));
    expect(resolved.get("post-1")!.props.publishAt).toBe("2026-04-01T00:00:00.000Z");
  });

  it("matches the override by slug for a slug-only reference", async () => {
    const resolved = await content([ref({ type: "content", slug: "hello" })], deps({ pendingContentOverride: override }));
    expect(resolved.get("hello")!.props.title).toBe("Draft");
  });

  it("matches by id, not slug, when the reference carries an id", async () => {
    const resolved = await content([ref({ type: "content", id: "other", slug: "hello" })], deps({ pendingContentOverride: override }));
    expect(resolved.size).toBe(0);
  });

  it("leaves a non-matching reference unresolved when only the override is available", async () => {
    const resolved = await content([ref({ type: "content", slug: "elsewhere" })], deps({ pendingContentOverride: override }));
    expect(resolved.size).toBe(0);
  });

  it("falls through to the repository for a reference the override does not match", async () => {
    const resolved = await content([ref({ type: "content", id: "post-2" })], deps({ postRepo, pendingContentOverride: override, host: hostPorts([post({ id: "post-2", title: "Saved" })]) }));
    expect(resolved.get("post-2")!.props.title).toBe("Saved");
  });

  it("degrades every reference when neither a post repository nor an override is supplied", async () => {
    expect((await content([ref({ type: "content", id: "post-1" })], deps())).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: "content" embeds present but no postRepo dependency was supplied — every occurrence degrades to the placeholder')).toBe(true);
  });
});

describe("post-content media context", () => {
  const resolveBody = async (bodyJson: JsonObject, extra: Partial<ResolveHtmlPageEmbedsDeps> = {}) => {
    const resolved = await content([ref({ type: "content", id: "post-1" })], deps({ postRepo, host: hostPorts([post({ bodyJson })]), ...extra }));
    return resolved.get("post-1")!.props;
  };

  it("collects ref-based image and media nodes at any depth, in a single public-transform lookup", async () => {
    const props = await resolveBody({
      type: "doc",
      content: [
        { type: "image", attrs: { assetId: "a1" } },
        { type: "blockquote", content: [{ type: "media", attrs: { assetId: "a1" } }, "text", null] },
      ],
    });
    expect(props.mediaTransformVersions).toEqual({ public: 3 });
    expect(props.mediaAssetMetadata).toEqual({ a1: { width: 640, height: 480, cssClass: null, htmlAttributes: null, slug: "a1-slug", contentType: null } });
  });

  it("ignores legacy src-only images, non-string asset ids, attr-less media and other node types", async () => {
    const props = await resolveBody({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/x.png" } },
        { type: "media", attrs: { assetId: 7 } },
        { type: "media", attrs: null },
        { type: "paragraph", attrs: { assetId: "a1" } },
      ],
    });
    expect(props.mediaAssetMetadata).toEqual({});
  });

  it("descends into an image node's own content", async () => {
    const props = await resolveBody({ type: "doc", content: [{ type: "image", attrs: {}, content: [{ type: "media", attrs: { assetId: "a1" } }] }] });
    expect(Object.keys(props.mediaAssetMetadata as object)).toEqual(["a1"]);
  });

  it("records the stored content type of each found asset", async () => {
    const props = await resolveBody({ type: "doc", content: [{ type: "media", attrs: { assetId: "a1" } }] }, { mediaContentTypeStore: contentTypes({ "sha-a1": "video/mp4" }) });
    expect((props.mediaAssetMetadata as Record<string, JsonObject>).a1!.contentType).toBe("video/mp4");
  });
});

describe("inline widgetEmbed collection", () => {
  const resolvePage = async (pageBodyJson: unknown, rows: EntryRecord[]) => {
    const entryRepo = new InMemoryEntryRepo();
    for (const row of rows) await entryRepo.save(row);
    return resolvePageWidgets({ deps: { bindingRepo: new InMemoryWidgetRegionBindingRepo(), entryRepo }, input: { workspaceId: WS, resolvedRegions: [], pageBodyJson } });
  };

  it("resolves every embed at any depth, keyed by placement id, in document order", async () => {
    const { inlineResolved } = await resolvePage(
      { type: "doc", content: [embedNode("p1", "w1"), { type: "blockquote", content: [embedNode("p2", "w2")] }] },
      [widgetRow("w1", { body: "one" }), widgetRow("w2", { body: "two" })],
    );
    expect([...inlineResolved.keys()]).toEqual(["p1", "p2"]);
    expect(inlineResolved.get("p1")!.props).toMatchObject({ body: "one" });
  });

  it("applies an embed's own content object over the saved config for that placement only", async () => {
    const { inlineResolved } = await resolvePage(
      { type: "doc", content: [embedNode("p1", "w1", { body: "override" }), embedNode("p2", "w1")] },
      [widgetRow("w1", { body: "saved" })],
    );
    expect(inlineResolved.get("p1")!.props).toMatchObject({ body: "override" });
    expect(inlineResolved.get("p2")!.props).toMatchObject({ body: "saved" });
  });

  it("ignores an embed content value that is not an object", async () => {
    const { inlineResolved } = await resolvePage({ type: "doc", content: [embedNode("p1", "w1", "nope")] }, [widgetRow("w1", { body: "saved" })]);
    expect(inlineResolved.get("p1")!.props).toMatchObject({ body: "saved" });
  });

  it("skips embeds whose ids are not both strings, non-embed nodes and non-record attrs", async () => {
    const { inlineResolved } = await resolvePage(
      { type: "doc", content: [embedNode(1, "w1"), embedNode("p2", null), { type: "widgetEmbed", attrs: "x" }, "text", null, { type: "paragraph", attrs: { placementId: "p3", widgetEntryId: "w1" } }] },
      [widgetRow("w1", {})],
    );
    expect(inlineResolved.size).toBe(0);
  });

  it("descends into an embed node's own content", async () => {
    const { inlineResolved } = await resolvePage({ type: "doc", content: [{ ...embedNode("p1", "w1"), content: [embedNode("p2", "w1")] }] }, [widgetRow("w1", {})]);
    expect([...inlineResolved.keys()]).toEqual(["p1", "p2"]);
  });

  it("collects inline widgets for a post-content body too", async () => {
    const entryRepo = new InMemoryEntryRepo();
    await entryRepo.save(widgetRow("w1", { body: "one" }));
    const resolved = await content([ref({ type: "content", id: "post-1" })], deps({ entryRepo, postRepo, host: hostPorts([post({ bodyJson: { type: "doc", content: [embedNode("p1", "w1")] } })]) }));
    expect(Object.keys(resolved.get("post-1")!.props.inlineWidgets as object)).toEqual(["p1"]);
  });
});
