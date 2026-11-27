import { act, renderHook } from "@testing-library/react";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { expect, it, vi } from "vitest";
import { usePostFeaturedImage } from "../hooks/use-post-featured-image.hooks.js";

const item: AdminMedia = {
  id: "selected", workspaceId: "workspace", title: "Selected", slug: "selected", alt: "", caption: "", credit: "",
  sha256: "hash", status: "active", createdAt: "created", updatedAt: "updated", version: 1,
  width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: null,
};
const deps = {
  port: { mediaOriginalUrl: ({ id }: { id: string }) => `/original/${id}` },
  renditionUrl: ({ id }: { id: string }) => `/rendition/${id}`,
};

it("chooses and clears only the selected id, closing the picker on selection", () => {
  const onChange = vi.fn();
  const { result } = renderHook(() => usePostFeaturedImage({ value: "previous", onChange, deps }));
  act(() => result.current.openPicker());
  expect(result.current.pickerOpen).toBe(true);
  act(() => result.current.handleSelect({ item }));
  expect(onChange.mock.calls).toEqual([["selected"]]);
  expect(result.current.pickerOpen).toBe(false);
  act(() => result.current.clear());
  expect(onChange.mock.calls).toEqual([["selected"], [null]]);
  expect(result.current.previewUrl).toBe("/rendition/previous");
});

it("falls from rendition to original to unavailable, resetting for a new id", () => {
  const { result, rerender } = renderHook(({ value }) => usePostFeaturedImage({ value, onChange: vi.fn(), deps }), {
    initialProps: { value: "first" },
  });
  expect(result.current.previewUrl).toBe("/rendition/first");
  expect(result.current.previewFailed).toBe(false);
  act(() => result.current.onPreviewError());
  expect(result.current.previewUrl).toBe("/original/first");
  expect(result.current.previewFailed).toBe(false);
  act(() => result.current.onPreviewError());
  expect(result.current.previewFailed).toBe(true);
  rerender({ value: "second" });
  expect(result.current.previewUrl).toBe("/rendition/second");
  expect(result.current.previewFailed).toBe(false);
});

it("cancel closes the picker without replacing the image and a host without renditions uses the original", () => {
  const onChange = vi.fn();
  const { result, rerender } = renderHook(({ value }: { value: string | null }) =>
    usePostFeaturedImage({ value, onChange, deps: { port: deps.port } }), { initialProps: { value: null } });
  expect(result.current.previewUrl).toBeNull();
  rerender({ value: "existing" });
  expect(result.current.previewUrl).toBe("/original/existing");
  act(() => result.current.openPicker());
  expect(result.current.pickerOpen).toBe(true);
  act(() => result.current.closePicker());
  expect(result.current.pickerOpen).toBe(false);
  expect(result.current.previewUrl).toBe("/original/existing");
  expect(onChange).not.toHaveBeenCalled();
  act(() => result.current.onPreviewError());
  expect(result.current.previewFailed).toBe(true);
});
