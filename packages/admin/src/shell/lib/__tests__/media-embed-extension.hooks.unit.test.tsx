// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { mediaPreviewKind, readMediaEmbedAttrs, useMediaEmbedNodeView } from "../media-embed-extension.hooks.js";

const asset = { assetId: "clip", transformName: "poster", alt: "View of canal", cssClass: "wide", htmlAttributes: 'aria-label="Canal"' };

it("normalizes non-string node attributes without discarding valid per-placement overrides", () => {
  expect(readMediaEmbedAttrs(asset)).toEqual(asset);
  expect(readMediaEmbedAttrs({ assetId: 17, transformName: null, alt: [], cssClass: {}, htmlAttributes: false })).toEqual({
    assetId: "", transformName: "", alt: "", cssClass: null, htmlAttributes: null,
  });
  expect(mediaPreviewKind({ contentType: " Video/MP4; charset=utf-8 " })).toBe("video");
  expect(mediaPreviewKind({ contentType: "image/webp" })).toBe("image");
});

it("ignores a stale video answer after replacement and uses an image when the current lookup fails", async () => {
  let resolveClip!: (value: string) => void;
  const clip = new Promise<string>(resolve => { resolveClip = resolve; });
  const contentTypeOf = vi.fn(({ id }: { id: string }) => {
    if (id === "clip") return clip;
    if (id === "photo") return Promise.reject(new Error("No content header"));
    throw new Error(`Unexpected asset ${id}`);
  });
  const deps = { locale: "es", translate: ({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`,
    mediaOriginalUrl: ({ id }: { id: string }) => `/media/${id}/original`, contentTypeOf };
  const updateAttributes = vi.fn();
  const deleteNode = vi.fn();
  const { result, rerender } = renderHook((attrs: Record<string, unknown>) => useMediaEmbedNodeView({ node: { attrs }, updateAttributes, deleteNode }, deps),
    { initialProps: { assetId: "clip" } });
  expect(result.current).toMatchObject({ previewSrc: "", previewKind: "pending" });
  expect(contentTypeOf).not.toHaveBeenCalled();
  rerender(asset);
  expect(result.current).toMatchObject({ previewSrc: "/media/clip/original", previewKind: "pending", editInitial: {
    alt: "View of canal", cssClass: "wide", htmlAttributes: 'aria-label="Canal"',
  } });
  rerender({ ...asset, assetId: "photo" });
  await waitFor(() => expect(result.current.previewKind).toBe("image"));
  await act(async () => { resolveClip("video/mp4"); });
  expect(result.current.previewSrc).toBe("/media/photo/original");
  expect(result.current.previewKind).toBe("image");
  expect(contentTypeOf.mock.calls).toEqual([[{ id: "clip" }], [{ id: "photo" }]]);
});

it("writes replacement and edit fields separately, closes their dialogs and removes the node", async () => {
  const updateAttributes = vi.fn();
  const deleteNode = vi.fn();
  const deps = { locale: "es", translate: ({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`,
    mediaOriginalUrl: ({ id }: { id: string }) => `/media/${id}`, contentTypeOf: async () => "video/webm" };
  const { result } = renderHook(() => useMediaEmbedNodeView({ node: { attrs: asset }, updateAttributes, deleteNode }, deps));
  await waitFor(() => expect(result.current.previewKind).toBe("video"));
  expect(result.current.t({ key: "Replace" })).toBe("es:Replace");
  act(() => result.current.openPicker());
  expect(result.current.picking).toBe(true);
  act(() => result.current.closePicker());
  expect(result.current.picking).toBe(false);
  act(() => result.current.openPicker());
  act(() => result.current.replaceWith({ id: "photo", alt: "", title: "Photo title" }));
  expect(result.current.picking).toBe(false);
  act(() => result.current.replaceWith({ id: "photo-2", alt: "A wide view", title: "Photo 2" }));
  act(() => result.current.openEdit());
  expect(result.current.editing).toBe(true);
  act(() => result.current.closeEdit());
  expect(result.current.editing).toBe(false);
  expect(updateAttributes).toHaveBeenCalledTimes(2);
  act(() => result.current.openEdit());
  const edits = { alt: "Canal on a cloudy morning", cssClass: null, htmlAttributes: 'aria-label="Quiet canal"' };
  act(() => result.current.saveEdit(edits));
  expect(result.current.editing).toBe(false);
  expect(updateAttributes.mock.calls).toEqual([
    [{ assetId: "photo", transformName: "public", alt: "Photo title" }],
    [{ assetId: "photo-2", transformName: "public", alt: "A wide view" }],
    [edits],
  ]);
  act(() => result.current.remove());
  expect(deleteNode.mock.calls).toEqual([[]]);
});
