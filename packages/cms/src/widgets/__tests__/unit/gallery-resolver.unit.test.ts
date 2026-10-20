import { describe, expect, it } from "vitest";
import { resolveGalleryEmbeds, type GalleryMediaResolver } from "../../gallery-resolver.js";
import type { PageHtmlEmbedRef } from "../../html/html-embeds.js";
import type { WidgetRenderIR } from "../../types.js";

/**
 * @file Direct branch coverage for `resolveGalleryEmbeds`: per-marker acceptance (config, key,
 * budget), the media batch it builds (legacy id vs slug refs), the media it keeps (canonical id,
 * no video/audio in a legacy gallery) and the issues it reports.
 */

function ref(id: string | null, config: Record<string, unknown>, type = "gallery"): PageHtmlEmbedRef {
  return { type, id, slug: null, name: null, variant: null, header: true, config };
}

function image(assetId: string, extra: Record<string, unknown> = {}): WidgetRenderIR {
  return { componentId: "media-image", props: { assetId, ...extra } };
}

function recordingMedia(found: ReadonlyMap<string, WidgetRenderIR> = new Map()) {
  const batches: PageHtmlEmbedRef[][] = [];
  const resolveMedia: GalleryMediaResolver = async ({ refs }) => { batches.push([...refs]); return found; };
  return { batches, resolveMedia };
}

function issues() {
  const reported: Array<{ key: string | null; messages: readonly string[] }> = [];
  return { reported, reportIssue: (issue: { key: string | null; messages: readonly string[] }) => { reported.push(issue); } };
}

const legacy = (...mediaIds: string[]) => ({ layout: "grid", images: mediaIds.map((mediaId) => ({ mediaId, alt: "" })) });
const slugs = (...slugList: string[]) => ({ mode: "media", layout: "grid", items: slugList.map((slug) => ({ slug })) });

describe("resolveGalleryEmbeds marker acceptance", () => {
  it("reports an invalid config under the marker's key and resolves nothing for it", async () => {
    const { reported, reportIssue } = issues();
    const { batches, resolveMedia } = recordingMedia();
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", { layout: "grid", images: [] })], resolveMedia }, { reportIssue });
    expect(result.size).toBe(0);
    expect(batches).toEqual([]);
    expect(reported).toEqual([{ key: "g1", messages: ["images must contain between 1 and 50 images"] }]);
  });

  it("refuses a valid marker with no occurrence key, reporting no messages", async () => {
    const { reported, reportIssue } = issues();
    const { resolveMedia } = recordingMedia();
    const result = await resolveGalleryEmbeds({ refs: [ref(null, legacy("a"))], resolveMedia }, { reportIssue });
    expect(result.size).toBe(0);
    expect(reported).toEqual([{ key: null, messages: [] }]);
  });

  it("skips an invalid marker silently when no reporter is supplied", async () => {
    const { resolveMedia } = recordingMedia();
    expect((await resolveGalleryEmbeds({ refs: [ref("g1", {})], resolveMedia })).size).toBe(0);
  });

  it("allows an empty image list only for a media-type marker", async () => {
    const { batches, resolveMedia } = recordingMedia();
    const result = await resolveGalleryEmbeds({ refs: [ref("m1", { layout: "grid", images: [] }, "media")], resolveMedia });
    expect(batches).toEqual([]);
    expect(result.get("m1")).toEqual({ componentId: "media", props: { config: { layout: "grid", images: [] }, media: {} } });
  });

  it("unwraps a placement's content config and passes the unwrapped config through", async () => {
    const { resolveMedia } = recordingMedia(new Map([["a", image("a")]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", { content: legacy("a") })], resolveMedia });
    expect(result.get("g1")!.props.config).toEqual(legacy("a"));
  });

  it("skips a gallery past the media budget silently when no reporter is supplied", async () => {
    const { batches, resolveMedia } = recordingMedia();
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a", "b"))], resolveMedia }, { maxMedia: 1 });
    expect(result.size).toBe(0);
    expect(batches).toEqual([]);
  });

  it("reports a gallery past the media budget under its key", async () => {
    const { reported, reportIssue } = issues();
    const { resolveMedia } = recordingMedia();
    await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a", "b"))], resolveMedia }, { maxMedia: 1, reportIssue });
    expect(reported).toEqual([{ key: "g1", messages: ["gallery media exceeds the page budget of 1 distinct assets"] }]);
  });

  it("does not charge already-requested assets against the budget again", async () => {
    const { batches, resolveMedia } = recordingMedia();
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a")), ref("g2", legacy("a"))], resolveMedia }, { maxMedia: 1 });
    expect([...result.keys()]).toEqual(["g1", "g2"]);
    expect(batches.map((batch) => batch.length)).toEqual([1]);
  });
});

describe("resolveGalleryEmbeds media batch", () => {
  it("requests a legacy mediaId by id", async () => {
    const { batches, resolveMedia } = recordingMedia();
    await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a"))], resolveMedia });
    expect(batches).toEqual([[{ type: "media", id: "a", slug: null, name: null, variant: null, header: true }]]);
  });

  it("requests a slug item by slug", async () => {
    const { batches, resolveMedia } = recordingMedia();
    await resolveGalleryEmbeds({ refs: [ref("g1", slugs("photo"))], resolveMedia });
    expect(batches).toEqual([[{ type: "media", id: null, slug: "photo", name: null, variant: null, header: true }]]);
  });

  it("requests html-mode data-media-slug references by slug", async () => {
    const { batches, resolveMedia } = recordingMedia();
    await resolveGalleryEmbeds({ refs: [ref("g1", { mode: "html", html: '<img data-media-slug="hero">' })], resolveMedia });
    expect(batches.map((batch) => batch.map((r) => r.slug))).toEqual([["hero"]]);
  });

  it("requests no media for URL-only images", async () => {
    const { batches, resolveMedia } = recordingMedia();
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", { layout: "grid", images: [{ src: "https://example.com/x.jpg", alt: "" }] })], resolveMedia });
    expect(batches).toEqual([]);
    expect(result.get("g1")!.props.media).toEqual({});
  });

  it("reports a timed-out media batch with no key", async () => {
    const { reported, reportIssue } = issues();
    await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a"))], resolveMedia: () => new Promise(() => {}) }, { timeoutMs: 1, reportIssue });
    expect(reported).toEqual([{ key: null, messages: ["gallery media resolution timed out"] }]);
  });

  it("returns an empty map on timeout, reporting nothing without a reporter", async () => {
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a"))], resolveMedia: () => new Promise(() => {}) }, { timeoutMs: 1 });
    expect(result.size).toBe(0);
  });
});

describe("resolveGalleryEmbeds kept media", () => {
  it("keeps a legacy image resolved under its canonical id", async () => {
    const { resolveMedia } = recordingMedia(new Map([["a", image("a", { alt: "A" })]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a"))], resolveMedia });
    expect(result.get("g1")).toEqual({ componentId: "gallery", props: { config: legacy("a"), media: { a: { assetId: "a", alt: "A" } } } });
  });

  it("drops a legacy id that resolved through a slug alias, silently without a reporter", async () => {
    const { resolveMedia } = recordingMedia(new Map([["alias", image("canonical")]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("alias"))], resolveMedia });
    expect(result.get("g1")!.props.media).toEqual({});
  });

  it("reports a legacy id that resolved through a slug alias under that id", async () => {
    const { reported, reportIssue } = issues();
    const { resolveMedia } = recordingMedia(new Map([["alias", image("canonical")]]));
    await resolveGalleryEmbeds({ refs: [ref("g1", legacy("alias"))], resolveMedia }, { reportIssue });
    expect(reported).toEqual([{ key: "alias", messages: ["gallery mediaId must be the canonical media id, not a slug"] }]);
  });

  it("drops audio from a legacy gallery", async () => {
    const { resolveMedia } = recordingMedia(new Map([["a", image("a", { contentType: "audio/mpeg" })]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a"))], resolveMedia });
    expect(result.get("g1")!.props.media).toEqual({});
  });

  it("keeps a legacy image whose content type is not a string", async () => {
    const { resolveMedia } = recordingMedia(new Map([["a", image("a", { contentType: 5 })]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a"))], resolveMedia });
    expect(result.get("g1")!.props.media).toEqual({ a: { assetId: "a", contentType: 5 } });
  });

  it("keeps an image/* legacy item", async () => {
    const { resolveMedia } = recordingMedia(new Map([["a", image("a", { contentType: "image/png" })]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a"))], resolveMedia });
    expect(Object.keys(result.get("g1")!.props.media as object)).toEqual(["a"]);
  });

  it("keeps slug media whatever its canonical id or content type", async () => {
    const { resolveMedia } = recordingMedia(new Map([["clip", image("clip-id", { contentType: "video/mp4" })]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", slugs("clip"))], resolveMedia });
    expect(result.get("g1")!.props.media).toEqual({ clip: { assetId: "clip-id", contentType: "video/mp4" } });
  });

  it("applies slug rules to a key authored both as a legacy id and as a slug on one page", async () => {
    const { resolveMedia } = recordingMedia(new Map([["k", image("other-id")]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("k")), ref("g2", slugs("k"))], resolveMedia });
    expect(result.get("g1")!.props.media).toEqual({ k: { assetId: "other-id" } });
  });

  it("shares one media record across all accepted markers", async () => {
    const { resolveMedia } = recordingMedia(new Map([["a", image("a")], ["b", image("b")]]));
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", legacy("a")), ref("g2", legacy("b"))], resolveMedia });
    expect(result.get("g1")!.props.media).toBe(result.get("g2")!.props.media);
  });

  it("reports each unresolved slug under its own key", async () => {
    const { reported, reportIssue } = issues();
    const { resolveMedia } = recordingMedia(new Map([["found", image("f")]]));
    await resolveGalleryEmbeds({ refs: [ref("g1", slugs("found", "lost"))], resolveMedia }, { reportIssue });
    expect(reported).toEqual([{ key: "lost", messages: ["unknown media slug: lost"] }]);
  });

  it("skips unresolved slugs silently without a reporter", async () => {
    const { resolveMedia } = recordingMedia();
    const result = await resolveGalleryEmbeds({ refs: [ref("g1", slugs("lost"))], resolveMedia });
    expect(result.get("g1")!.props.media).toEqual({});
  });
});
