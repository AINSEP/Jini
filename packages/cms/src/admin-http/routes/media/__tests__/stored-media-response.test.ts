import { expect, it, vi } from "vitest";
import { toStoredMediaResponse } from "../stored-media-response.js";
import type { MediaRecord } from "../../../../media/types.js";

it("reports stored SVG bytes and does not read sizes for other content", async () => {
  const media: MediaRecord = { id: "media", workspaceId: "ws", title: "Image", slug: "image", alt: "", caption: "", credit: "", source: { sha256: "sha" }, status: "active", createdAt: "now", updatedAt: "now", version: 1, width: null, height: null, cssClass: null, htmlAttributes: null };
  const order: string[] = [];
  const resolvePublicUrls = vi.fn(async () => { order.push("url"); return new Map([["media", "/m/media"]]); });
  const resolveByteSizes = vi.fn(async () => { order.push("size"); return new Map([["sha", 0]]); });
  const input = { media, byteLength: 999, resolvePublicUrls, resolveByteSizes };
  expect((await toStoredMediaResponse({ ...input, contentType: "image/svg+xml" })).media.byteSize).toBe(0);
  expect(order).toEqual(["url", "size"]);
  expect(resolvePublicUrls.mock.calls).toEqual([[{ media: [media] }]]);
  expect(resolveByteSizes.mock.calls).toEqual([[{ media: [media] }]]);
  expect((await toStoredMediaResponse({ ...input, contentType: "image/png" })).media.byteSize).toBe(999);
  expect(resolveByteSizes).toHaveBeenCalledTimes(1);
  expect((await toStoredMediaResponse({ ...input, contentType: "image/svg+xml", resolveByteSizes: async () => new Map() })).media.byteSize).toBeNull();
});
