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
import { buildWidgetAreaFieldsJson, buildWidgetInstanceFieldsJson } from "../../entry-payload.js";
import type { PageHtmlEmbedRef } from "../../html/html-embeds.js";
import type { MediaContentTypeStorePort, PostRecord, PostRepoPort, WidgetHostPorts } from "../../host-ports.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import { THEME_OWNED_MARKER_TYPES, HTML_EMBED_RESOLVERS, resolveGalleryWidgetMedia, resolvePageWidgets, type ResolveHtmlPageEmbedsDeps } from "../../resolver-service.js";
import { createContactFormResolver, registerCoreResolver } from "../../resolvers/index.js";
import type { FormDefinitionReadPort, FormDefinitionView } from "../../resolvers/ports.js";
import type { TaxonomyListPort, TermListPort } from "../../../taxonomy/index.js";
import type { WidgetPlacementNode, WidgetResolveContext } from "../../types.js";

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

function widgetRow(id: string, config: Record<string, unknown>, payload: { status?: "active" | "trash" | "purged"; fieldsJson?: unknown } = {}): EntryRecord {
  return {
    id, workspaceId: WS, type: "widget", slug: `${id}-slug`, status: "draft", title: id, bodyJson: null,
    fieldsJson: payload.fieldsJson ?? buildWidgetInstanceFieldsJson({ payload: { widgetType: "text", config, status: payload.status ?? "active" } }),
    publishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1,
  };
}

function embedNode(placementId: unknown, widgetEntryId: unknown, content?: unknown): JsonObject {
  return { type: "widgetEmbed", attrs: { placementId, widgetEntryId, ...(content === undefined ? {} : { content }) } } as JsonObject;
}

const media = (refs: PageHtmlEmbedRef[], d: ResolveHtmlPageEmbedsDeps) => HTML_EMBED_RESOLVERS.media!(refs, d, CTX);
const widget = (refs: PageHtmlEmbedRef[], d: ResolveHtmlPageEmbedsDeps) => HTML_EMBED_RESOLVERS.widget!(refs, d, CTX);
const form = (refs: PageHtmlEmbedRef[], d: ResolveHtmlPageEmbedsDeps) => HTML_EMBED_RESOLVERS.form!(refs, d, CTX);
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

  it("omits metadata for an asset id with no media record", async () => {
    const props = await resolveBody({ type: "doc", content: [{ type: "media", attrs: { assetId: "a1" } }, { type: "media", attrs: { assetId: "nope" } }] });
    expect(Object.keys(props.mediaAssetMetadata as object)).toEqual(["a1"]);
  });

  it("resolves no transform versions when the public transform is not registered", async () => {
    const props = await resolveBody({ type: "doc", content: [{ type: "media", attrs: { assetId: "a1" } }] }, { transformRepo: new InMemoryTransformDefinitionRepo({}) });
    expect(props.mediaTransformVersions).toEqual({});
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

async function entryRepoWith(rows: EntryRecord[]): Promise<InMemoryEntryRepo> {
  const entryRepo = new InMemoryEntryRepo();
  for (const row of rows) await entryRepo.save(row);
  return entryRepo;
}

describe("widget embed resolution", () => {
  const textIr = (body: string) => ({ componentId: "text", props: { body } });

  it("resolves an id reference to its widget's IR, keyed by the id", async () => {
    const resolved = await widget([ref({ type: "widget", id: "w1" })], deps({ entryRepo: await entryRepoWith([widgetRow("w1", { body: "one" })]) }));
    expect(resolved.get("w1")).toEqual(textIr("one"));
  });

  it("resolves a slug-only reference to its widget's IR, keyed by the slug", async () => {
    const resolved = await widget([ref({ type: "widget", slug: "w1-slug" })], deps({ entryRepo: await entryRepoWith([widgetRow("w1", { body: "one" })]) }));
    expect([...resolved]).toEqual([["w1-slug", textIr("one")]]);
  });

  it("ignores the slug when the reference also carries an id", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "one" }), widgetRow("w2", { body: "two" })]);
    const resolved = await widget([ref({ type: "widget", id: "w1", slug: "w2-slug" })], deps({ entryRepo }));
    expect([...resolved]).toEqual([["w1", textIr("one")]]);
  });

  it("looks each distinct slug up once", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "one" })]);
    const findBySlug = vi.spyOn(entryRepo, "findBySlug");
    await widget([ref({ type: "widget", slug: "w1-slug" }), ref({ type: "widget", slug: "w1-slug" })], deps({ entryRepo }));
    expect(findBySlug).toHaveBeenCalledTimes(1);
  });

  it("leaves an unknown slug absent and warns", async () => {
    const resolved = await widget([ref({ type: "widget", slug: "nope" })], deps());
    expect(resolved.size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "widget" reference — no widget with that slug')).toBe(true);
  });

  it("warns for a reference with neither id nor slug", async () => {
    const resolved = await widget([ref({ type: "widget" })], deps());
    expect(resolved.size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "widget" reference — missing or invalid "id"/"slug" in data-embed-config')).toBe(true);
  });

  it("leaves a nonexistent id absent rather than present-with-placeholder", async () => {
    expect((await widget([ref({ type: "widget", id: "missing" })], deps())).size).toBe(0);
  });

  it.each(["trash", "purged"] as const)("leaves a %s widget instance absent", async (status) => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "one" }, { status })]);
    expect((await widget([ref({ type: "widget", id: "w1" })], deps({ entryRepo }))).size).toBe(0);
  });

  it("skips a widget row whose payload is malformed", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", {}, { fieldsJson: { ext: {} } })]);
    expect((await widget([ref({ type: "widget", id: "w1" })], deps({ entryRepo }))).size).toBe(0);
  });

  it("merges a placement's content over the saved config under the placement key only", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "saved", title: "T" })]);
    const resolved = await widget([ref({ type: "widget", id: "w1", placementKey: "k1", config: { content: { body: "override" } } })], deps({ entryRepo }));
    expect([...resolved]).toEqual([["k1", { componentId: "text", props: { body: "override", title: "T" } }]]);
  });

  it("resolves a slug-addressed placement's content override", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "saved" })]);
    const resolved = await widget([ref({ type: "widget", slug: "w1-slug", placementKey: "k1", config: { content: { body: "override" } } })], deps({ entryRepo }));
    expect(resolved.get("k1")).toEqual(textIr("override"));
  });

  it("keeps the saved IR for an un-keyed occurrence of a widget another occurrence overrides", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "saved" })]);
    const resolved = await widget([
      ref({ type: "widget", id: "w1" }),
      ref({ type: "widget", id: "w1", placementKey: "k1", config: { content: { body: "override" } } }),
    ], deps({ entryRepo }));
    expect(resolved.get("w1")).toEqual(textIr("saved"));
    expect(resolved.get("k1")).toEqual(textIr("override"));
  });

  it("ignores a placement content value that is not an object", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "saved" })]);
    const resolved = await widget([ref({ type: "widget", id: "w1", placementKey: "k1", config: { content: "nope" } })], deps({ entryRepo }));
    expect(resolved.size).toBe(0);
  });

  it("drops a placement override whose widget does not exist", async () => {
    const resolved = await widget([ref({ type: "widget", id: "missing", placementKey: "k1", config: { content: { body: "x" } } })], deps());
    expect(resolved.size).toBe(0);
  });

  it("drops a placement override whose widget is trashed", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", {}, { status: "trash" })]);
    const resolved = await widget([ref({ type: "widget", id: "w1", placementKey: "k1", config: { content: { body: "x" } } })], deps({ entryRepo }));
    expect(resolved.size).toBe(0);
  });

  it("drops a placement override for an unknown slug", async () => {
    const resolved = await widget([ref({ type: "widget", slug: "nope", placementKey: "k1", config: { content: { body: "x" } } })], deps());
    expect(resolved.size).toBe(0);
  });
});

describe("form embed resolution", () => {
  const definitions: FormDefinitionView[] = [{ id: "form-1", slug: "contact", status: "active", fields: [] }];
  const formRepo: FormDefinitionReadPort = {
    findById: async ({ id }) => definitions.find((d) => d.id === id) ?? null,
    findBySlug: async ({ slug }) => definitions.find((d) => d.slug === slug) ?? null,
  };
  const formIr = { componentId: "contact-form", props: { formDefinitionId: "form-1", slug: "contact", fields: [], successMessage: null } };
  beforeEach(() => { registerCoreResolver({ typeKey: "contact-form", resolver: createContactFormResolver({ formDefinitionRepo: formRepo }) }); });

  it("resolves an id and a slug reference to the same contact form, keyed as authored", async () => {
    const resolved = await form([ref({ type: "form", id: "form-1" }), ref({ type: "form", slug: "contact" })], deps());
    expect([...resolved]).toEqual([["form-1", formIr], ["contact", formIr]]);
  });

  it("degrades an unknown form to the placeholder IR", async () => {
    const resolved = await form([ref({ type: "form", slug: "nope" })], deps());
    expect([...resolved]).toEqual([["nope", { componentId: "widget-placeholder", props: {} }]]);
  });

  it("deduplicates repeated keys and skips a reference with neither id nor slug", async () => {
    const resolved = await form([ref({ type: "form", id: "form-1" }), ref({ type: "form", id: "form-1" }), ref({ type: "form" })], deps());
    expect([...resolved.keys()]).toEqual(["form-1"]);
  });
});

describe("region placements", () => {
  function areaRow(id: string, placements: WidgetPlacementNode[], extra: Partial<EntryRecord> = {}): EntryRecord {
    return {
      ...widgetRow(id, {}), type: "widget_area",
      fieldsJson: buildWidgetAreaFieldsJson({ payload: { regionKey: "sidebar", doc: { schemaVersion: 1, placements } } }),
      ...extra,
    };
  }
  const placement = (placementId: string, widgetEntryId: string, extra: Partial<WidgetPlacementNode> = {}): WidgetPlacementNode => ({ placementId, widgetEntryId, enabled: true, ...extra });

  async function resolveRegions(rows: EntryRecord[], bind: Record<string, string>, resolvedRegions = ["sidebar"]) {
    const bindingRepo = new InMemoryWidgetRegionBindingRepo();
    for (const [regionKey, areaEntryId] of Object.entries(bind)) await bindingRepo.upsert({ workspaceId: WS, regionKey, areaEntryId, updatedAt: "2026-01-01T00:00:00.000Z" });
    const { regions } = await resolvePageWidgets({ deps: { bindingRepo, entryRepo: await entryRepoWith(rows) }, input: { workspaceId: WS, resolvedRegions } });
    return regions;
  }

  it("resolves a bound region's enabled placements in order, skipping disabled ones", async () => {
    const regions = await resolveRegions(
      [areaRow("area-1", [placement("p1", "w2"), placement("p2", "w1", { enabled: false }), placement("p3", "w1")]), widgetRow("w1", { body: "one" }), widgetRow("w2", { body: "two" })],
      { sidebar: "area-1" },
    );
    expect(regions).toEqual({ sidebar: [{ componentId: "text", props: { body: "two" } }, { componentId: "text", props: { body: "one" } }] });
  });

  it("degrades a placement whose widget is missing to the placeholder IR", async () => {
    const regions = await resolveRegions([areaRow("area-1", [placement("p1", "missing")])], { sidebar: "area-1" });
    expect(regions.sidebar).toEqual([{ componentId: "widget-placeholder", props: {} }]);
  });

  it("applies a placement's content over the saved config for that placement only", async () => {
    const regions = await resolveRegions(
      [areaRow("area-1", [placement("p1", "w1", { content: { body: "override" } }), placement("p2", "w1")]), widgetRow("w1", { body: "saved" })],
      { sidebar: "area-1" },
    );
    expect(regions.sidebar).toEqual([{ componentId: "text", props: { body: "override" } }, { componentId: "text", props: { body: "saved" } }]);
  });

  it("resolves an unbound region to no widgets", async () => {
    expect(await resolveRegions([], {})).toEqual({ sidebar: [] });
  });

  it("resolves a region bound to a missing area entry to no widgets", async () => {
    expect(await resolveRegions([], { sidebar: "area-1" })).toEqual({ sidebar: [] });
  });

  it("resolves a region bound to an entry that is not a widget_area to no widgets", async () => {
    expect(await resolveRegions([areaRow("area-1", [placement("p1", "w1")], { type: "widget" }), widgetRow("w1", {})], { sidebar: "area-1" })).toEqual({ sidebar: [] });
  });

  it("resolves a region whose widget_area payload is malformed to no widgets", async () => {
    expect(await resolveRegions([areaRow("area-1", [], { fieldsJson: { ext: {} } })], { sidebar: "area-1" })).toEqual({ sidebar: [] });
  });
});

describe("taxonomy embed resolution", () => {
  const taxonomyRepo: TaxonomyListPort = { list: async () => [{ id: "tax-1", name: "Topics", hierarchical: true, status: "active", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 }] };
  const termRepo: TermListPort = {
    listByTaxonomy: async ({ taxonomyId }) => [{ id: "t1", taxonomyId, parentId: null, name: "News", status: "active", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 }],
  };

  it("delegates to the taxonomy resolver with the host's taxonomy and term repositories", async () => {
    const resolved = await HTML_EMBED_RESOLVERS.taxonomy!([ref({ type: "taxonomy", id: "tax-1" })], deps({ taxonomyRepo, termRepo }), CTX);
    expect(resolved.get("tax-1")).toEqual({ componentId: "taxonomy-list", props: { id: "tax-1", name: "Topics", hierarchical: true, terms: [{ id: "t1", name: "News", parentId: null }] } });
  });
});

describe("gallery embed resolution", () => {
  const legacyConfig = { layout: "grid", images: [{ mediaId: "a1", alt: "" }] };

  it("resolves a gallery's images through the media resolver", async () => {
    const resolved = await HTML_EMBED_RESOLVERS.gallery!([ref({ type: "gallery", id: "g1", config: legacyConfig })], deps(), CTX);
    const ir = resolved.get("g1")!;
    expect(ir.componentId).toBe("gallery");
    expect(ir.props.config).toEqual(legacyConfig);
    expect({ ...(ir.props.media as JsonObject) }).toEqual({ a1: { assetId: "a1", slug: "a1-slug", transformName: "public", version: 3, alt: "Alt", width: 640, height: 480, cssClass: null, htmlAttributes: null } });
  });

  it("reports an invalid gallery with the workspace id and leaves it unresolved", async () => {
    const resolved = await HTML_EMBED_RESOLVERS.gallery!([ref({ type: "gallery", id: "g1", config: { layout: "grid", images: [] } })], deps(), CTX);
    expect(resolved.size).toBe(0);
    expect(warn).toHaveBeenCalledWith("[widgets] unresolved gallery embed", { workspaceId: WS, key: "g1", messages: ["images must contain between 1 and 50 images"] });
  });

  it("exposes the media resolver to gallery widgets", async () => {
    const resolved = await resolveGalleryWidgetMedia({ refs: [ref({ id: "a1" })], deps: deps(), context: CTX });
    expect(resolved.get("a1")!.props).toMatchObject({ assetId: "a1", transformName: "public" });
  });
});

describe("inline media content embeds", () => {
  const items = { mode: "media", layout: "grid", items: [{ slug: "a1-slug" }] };
  const mediaProps = (resolved: ReadonlyMap<string, { props: JsonObject }>) => ({ ...(resolved.get("m1")!.props.media as JsonObject) });

  it("resolves a media marker's inline content as a media gallery IR", async () => {
    const resolved = await media([ref({ id: "m1", config: { content: items } })], deps());
    expect(resolved.get("m1")!.componentId).toBe("media");
    expect(resolved.get("m1")!.props.config).toEqual(items);
    expect(Object.keys(mediaProps(resolved))).toEqual(["a1-slug"]);
  });

  it("treats a media marker carrying items directly as inline content", async () => {
    const resolved = await media([ref({ id: "m1", config: items })], deps());
    expect(Object.keys(mediaProps(resolved))).toEqual(["a1-slug"]);
  });

  it("treats a media marker carrying html as inline content", async () => {
    const resolved = await media([ref({ id: "m1", config: { html: "{{media:a1-slug}}" } })], deps());
    expect(Object.keys(mediaProps(resolved))).toEqual(["a1-slug"]);
  });

  it("warns about invalid inline content and leaves it unresolved", async () => {
    const resolved = await media([ref({ id: "m1", config: { html: 7 } })], deps());
    expect(resolved.size).toBe(0);
    expect(warn).toHaveBeenCalledWith("[widgets] unresolved media content", { key: "m1", messages: ["html must be a string of at most 65536 characters"] });
  });

  it("resolves a media marker with a config but no inline content as an ordinary asset", async () => {
    const resolved = await media([ref({ id: "a1", config: { variant: "public" } })], deps());
    expect(resolved.get("a1")!.componentId).toBe("media-image");
  });

  it("returns ordinary and inline media results together", async () => {
    const resolved = await media([ref({ id: "a1" }), ref({ id: "m1", config: { content: items } })], deps());
    expect([...resolved.keys()]).toEqual(["a1", "m1"]);
  });
});

describe("post embed resolution", () => {
  const postEmbed = (refs: PageHtmlEmbedRef[], d: ResolveHtmlPageEmbedsDeps) => HTML_EMBED_RESOLVERS.post!(refs, d, CTX);
  const emptyContext = { mediaTransformVersions: {}, mediaAssetMetadata: {}, inlineWidgets: {} };

  it("renders a published post found by id as post-content", async () => {
    const resolved = await postEmbed([ref({ type: "post", id: "post-1" })], deps({ postRepo, host: hostPorts([post({ publishAt: "2026-02-02T00:00:00.000Z" })]) }));
    expect(resolved.get("post-1")).toEqual({
      componentId: "post-content",
      props: { title: "Hello", slug: "hello", updatedAt: "2026-02-01T00:00:00.000Z", publishAt: "2026-02-02T00:00:00.000Z", bodyJson: { type: "doc", content: [] }, ...emptyContext },
    });
  });

  it("finds a slug-only reference by slug and defaults an absent publishAt to null", async () => {
    const resolved = await postEmbed([ref({ type: "post", slug: "hello" })], deps({ postRepo, host: hostPorts([post()]) }));
    expect(resolved.get("hello")!.props).toMatchObject({ title: "Hello", publishAt: null });
  });

  it("resolves the post body's own media and inline widgets", async () => {
    const entryRepo = await entryRepoWith([widgetRow("w1", { body: "one" })]);
    const bodyJson = { type: "doc", content: [{ type: "media", attrs: { assetId: "a1" } }, embedNode("p1", "w1")] };
    const resolved = await postEmbed([ref({ type: "post", id: "post-1" })], deps({ entryRepo, postRepo, host: hostPorts([post({ bodyJson })]) }));
    const props = resolved.get("post-1")!.props;
    expect(props.mediaTransformVersions).toEqual({ public: 3 });
    expect(props.inlineWidgets).toEqual({ p1: { componentId: "text", props: { body: "one" } } });
  });

  it("refuses a reference with neither id nor slug", async () => {
    expect((await postEmbed([ref({ type: "post" })], deps({ postRepo }))).size).toBe(0);
    expect(warnedWith('[widgets] resolveHtmlPageEmbeds: unresolved "post" reference — missing or invalid "id"/"slug" in data-embed-config')).toBe(true);
  });

  it("degrades an unpublished or missing post", async () => {
    expect((await postEmbed([ref({ type: "post", id: "missing" })], deps({ postRepo }))).size).toBe(0);
    expect(warn).toHaveBeenCalledWith('[widgets] resolveHtmlPageEmbeds: unresolved "post" reference — no such published post', { workspaceId: WS, postId: "missing" });
  });

  it("degrades every reference when no post repository is supplied", async () => {
    expect((await postEmbed([ref({ type: "post", id: "post-1" })], deps())).size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      '[widgets] resolveHtmlPageEmbeds: "post" embeds present but no postRepo dependency was supplied — every occurrence degrades to the placeholder',
      { workspaceId: WS, occurrences: 1 },
    );
  });

  it("stays silent without a post repository when there are no references", async () => {
    expect((await postEmbed([], deps())).size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

it('comments markers belong to the host renderer rather than the CMS content resolver', () => {
  expect(THEME_OWNED_MARKER_TYPES.has('comments')).toBe(true);
  expect(HTML_EMBED_RESOLVERS['comments']).toBeUndefined();
});
