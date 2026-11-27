import assert from "node:assert/strict";
import { ToolInputError } from "@jini-ai/core";
import { expect, it, vi } from "vitest";
import { findMediaByIdOrSlug } from "../../media/media-service.js";
import { InMemoryMediaRepo } from "../../media/repo.memory.js";
import type { MediaRecord } from "../../media/types.js";
import { resolveFeaturedImageRef, resolveFeaturedMediaIdForWrite, type FeaturedImageDeps } from "../featured-image.js";
import { PostValidationError } from "../post.js";
import type { PostToolDeps } from "../post-tool-deps.js";
import { resolveFeaturedImageInput } from "../post-tool-input.js";
import { createPostFeaturedImageRefusals } from "../post-tool-policy.js";

const asset: MediaRecord = {
  id: "asset-id", slug: "cover", workspaceId: "site", status: "active", title: "Cover",
  alt: "", caption: "", credit: "", source: { sha256: "cover-hash" }, createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z", version: 1, height: null, width: null, cssClass: null, htmlAttributes: null,
};
function setup() {
  const mediaRepo = new InMemoryMediaRepo({}, { initialRows: [
    asset, { ...asset, id: "old", slug: "trashed", status: "trashed" },
    { ...asset, id: "video-id", slug: "video", source: { sha256: "video-hash" } },
    { ...asset, id: "other", workspaceId: "other-site", slug: "private" },
    { ...asset, id: "uncatalogued-id", slug: "uncatalogued", source: { sha256: "unk-hash" } },
    { ...asset, id: "other-cover", slug: "asset-id", source: { sha256: "other-hash" } },
  ] });
  const lookup = vi.fn(findMediaByIdOrSlug);
  const getMany = vi.fn<NonNullable<FeaturedImageDeps["mediaContentTypeStore"]>["getMany"]>(async ({ workspaceId, sha256s }) => {
    if (workspaceId !== "site") throw new Error("unexpected media scope");
    const typed = new Map([["cover-hash", "image/avif"], ["video-hash", "video/mp4"]]);
    return new Map([...typed].filter(([key]) => sha256s.includes(key)));
  });
  const deps: FeaturedImageDeps = { mediaRepo, findMediaByIdOrSlug: lookup, mediaContentTypeStore: { getMany } };
  const toolDeps = { ...deps, workspaceId: "site", featuredImageRefusals: createPostFeaturedImageRefusals({ mediaAssetReadToolId: "media.find" }) } as PostToolDeps;
  const rest = (featuredMediaId: string | null | undefined) => resolveFeaturedMediaIdForWrite({ deps, input: { workspaceId: "site", featuredMediaId } });
  return { deps, lookup, getMany, rest, toolDeps };
}

it("resolves a slug and an ambiguous id to the canonical asset id in the caller's workspace", async () => {
  const { deps, lookup, getMany, rest, toolDeps } = setup();
  expect(await rest("  cover  ")).toBe("asset-id");
  expect(await resolveFeaturedImageInput(toolDeps, { featuredImage: " asset-id " })).toBe("asset-id");
  expect(lookup.mock.calls).toEqual([
    [{ deps: { mediaRepo: deps.mediaRepo }, input: { workspaceId: "site", idOrSlug: "cover" } }],
    [{ deps: { mediaRepo: deps.mediaRepo }, input: { workspaceId: "site", idOrSlug: "asset-id" } }],
  ]);
  expect(getMany.mock.calls).toEqual([
    [{ workspaceId: "site", sha256s: ["cover-hash"] }], [{ workspaceId: "site", sha256s: ["cover-hash"] }],
  ]);
});

it("allows an asset whose MIME type has not yet been recorded or whose host has no type store", async () => {
  const { deps, rest, getMany } = setup();
  expect(await rest("uncatalogued")).toBe("uncatalogued-id");
  expect(getMany).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", sha256s: ["unk-hash"] });
  expect(await resolveFeaturedImageRef({ deps: { ...deps, mediaContentTypeStore: undefined }, input: { workspaceId: "site", ref: "cover" } }))
    .toEqual({ ok: true, id: "asset-id" });
});

it.each([
  ["private", "featuredMediaId: no media asset has the id 'private'.", "featuredImage: no media asset has the id or slug 'private'. Find one with media.find, or upload one first.", []],
  ["trashed", "featuredMediaId: media asset 'trashed' is in Trash. Restore it first, or pick another image.", "featuredImage: media asset 'trashed' is in Trash. Restore it first, or pick another image.", []],
  ["video", "featuredMediaId: media asset 'video' is video/mp4, not an image. A featured image must be an image.", "featuredImage: media asset 'video' is video/mp4, not an image. A featured image must be an image.", [[{ workspaceId: "site", sha256s: ["video-hash"] }], [{ workspaceId: "site", sha256s: ["video-hash"] }]]],
] as const)("rejects the %s cover with caller-specific recovery text", async (ref, restMessage, toolMessage, typeCalls) => {
  const { rest, toolDeps, getMany } = setup();
  await assert.rejects(rest(` ${ref} `), { constructor: PostValidationError, message: restMessage });
  await assert.rejects(resolveFeaturedImageInput(toolDeps, { featuredImage: ` ${ref} ` }), { constructor: ToolInputError, message: toolMessage });
  expect(getMany.mock.calls).toEqual(typeCalls);
});

it("distinguishes omission and clearing, rejecting malformed assistant refs before accessing media", async () => {
  const { rest, toolDeps, lookup } = setup();
  expect(await rest(undefined)).toBeUndefined();
  expect(await rest(null)).toBeNull();
  expect(await rest("  ")).toBe("  "); // the domain shape validator owns the REST rejection
  expect(await resolveFeaturedImageInput(toolDeps, {})).toBeUndefined();
  expect(await resolveFeaturedImageInput(toolDeps, { featuredImage: null })).toBeNull();
  for (const featuredImage of ["", "  ", 42, {}, true, ["cover"]]) {
    await assert.rejects(resolveFeaturedImageInput(toolDeps, { featuredImage }), {
      constructor: ToolInputError, message: "featuredImage must be a media asset id or slug, or null to remove the featured image.",
    });
  }
  const { mediaRepo: _mediaRepo, ...withoutLibrary } = toolDeps;
  await assert.rejects(resolveFeaturedImageInput(withoutLibrary, { featuredImage: "cover" }), {
    constructor: ToolInputError,
    message: "featuredImage: the media library is not available to this assistant session, so a featured image cannot be set here. Set it in the post editor instead.",
  });
  expect(lookup).not.toHaveBeenCalled();
});
