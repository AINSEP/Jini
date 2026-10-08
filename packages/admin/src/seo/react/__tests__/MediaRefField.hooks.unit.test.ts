import { act, renderHook } from "./harness/render.js";
import { describe, expect, it, vi } from "vitest";

import { useMediaRefField } from "./harness/hooks.js";
import { createFakeMediaPickerPort } from "./harness/api.js";
import type { AdminMedia } from "./harness/api.js";

/**
 * @file `useMediaRefField` — the picker-open state, selection, and clear/preview wiring behind
 * `MediaRefField.tsx`. `MediaRefField.unit.test.tsx` covers the rendered component (including the
 * real `MediaPickerDialog`); this file is the hook's own injected-port coverage, same split
 * `MediaPickerDialog.hooks.unit.test.tsx` uses for `useMediaPickerDialog`.
 */

function mediaItem(overrides: Partial<AdminMedia> = {}): AdminMedia {
  return {
    id: "asset-1",
    workspaceId: "w1",
    title: "Sunset",
    slug: "sunset",
    alt: "A sunset over water",
    caption: "",
    credit: "",
    sha256: "abc",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    width: null,
    height: null,
    cssClass: null,
    htmlAttributes: null,
    contentType: "image/png",
    publicUrl: null,
    ...overrides,
  };
}

describe("useMediaRefField — picker visibility", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useMediaRefField("", vi.fn(), { port: createFakeMediaPickerPort() }));
    expect(result.current.pickerOpen).toBe(false);
  });

  it("openPicker/closePicker toggle pickerOpen", () => {
    const { result } = renderHook(() => useMediaRefField("", vi.fn(), { port: createFakeMediaPickerPort() }));
    act(() => result.current.openPicker());
    expect(result.current.pickerOpen).toBe(true);
    act(() => result.current.closePicker());
    expect(result.current.pickerOpen).toBe(false);
  });
});

describe("useMediaRefField — accept", () => {
  it("asks the picker for images only", () => {
    const { result } = renderHook(() => useMediaRefField("", vi.fn(), { port: createFakeMediaPickerPort() }));
    expect(result.current.accept).toEqual(["image/*"]);
  });
});

describe("useMediaRefField — handleSelect", () => {
  // readable-slugs S5b: writes the slug, not the id — buildMediaRef now prefers item.slug.
  it("calls onChange with the EXACT '{slug}:public' ref for the selected item", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useMediaRefField("", onChange, { port: createFakeMediaPickerPort() }));

    act(() => result.current.handleSelect(mediaItem({ id: "asset-1", slug: "sunset" })));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("sunset:public");
  });

  it("closes the picker on selection", () => {
    const { result } = renderHook(() => useMediaRefField("", vi.fn(), { port: createFakeMediaPickerPort() }));
    act(() => result.current.openPicker());

    act(() => result.current.handleSelect(mediaItem()));

    expect(result.current.pickerOpen).toBe(false);
  });
});

describe("useMediaRefField — clear", () => {
  it("calls onChange('') — an OG image must be removable", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useMediaRefField("asset-1:public", onChange, { port: createFakeMediaPickerPort() }));

    act(() => result.current.clear());

    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("useMediaRefField — previewUrl", () => {
  it("is null for an empty value", () => {
    const { result } = renderHook(() => useMediaRefField("", vi.fn(), { port: createFakeMediaPickerPort() }));
    expect(result.current.previewUrl).toBeNull();
  });

  it("resolves an '{assetId}:transform' value through the injected port's mediaOriginalUrl", () => {
    const { result } = renderHook(() =>
      useMediaRefField("asset-1:public", vi.fn(), { port: createFakeMediaPickerPort() }),
    );
    // `createFakeMediaPickerPort`'s own `mediaOriginalUrl` deliberately returns a distinct
    // `fake://` scheme (see its doc) — proves this came from the INJECTED port, not a real
    // `api.mediaOriginalUrl` call.
    expect(result.current.previewUrl).toBe("fake://media-picker-original/asset-1");
  });

  it("passes an absolute URL value straight through, unresolved", () => {
    const { result } = renderHook(() =>
      useMediaRefField("https://cdn.example/pic.png", vi.fn(), { port: createFakeMediaPickerPort() }),
    );
    expect(result.current.previewUrl).toBe("https://cdn.example/pic.png");
  });
});
