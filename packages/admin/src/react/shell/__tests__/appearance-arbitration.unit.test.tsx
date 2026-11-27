import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createAppearanceDraftStore, useAdminAppearance, useSettingsAppearance } from "../appearance.js";

afterEach(cleanup);

test("an accepted in-flight read cannot retire a newer preview", () => {
  const store = createAppearanceDraftStore({}, {});
  const root = document.createElement("div");
  const paintAccent = vi.fn();
  const useThemeStateHook = () => ({ themeId: "theme" });
  const preview = renderHook(() => useSettingsAppearance({ store, root, accentColor: "draft", ready: true, useThemeStateHook, advancePreview: () => 2, paintAccent }));
  const port = { loadAppearance: async () => ({ color: "saved" }), subscribeToSettingsRefresh: () => () => {} };
  renderHook(() => useAdminAppearance({ store, root, port, useThemeStateHook, useAppearanceSnapshotHook: () => ({ data: { appearance: { color: "saved" }, readPreviewVersion: 1 } }), useInvalidateHook: () => () => {}, paintAccent, resolveAccent: ({ appearance }) => appearance.color, queryPrefix: ["settings", "appearance"] }));
  expect(paintAccent).toHaveBeenLastCalledWith({ accentColor: "draft", root }, {});
  expect(store.get(root)?.get("theme")).toEqual({ accentColor: "draft", version: 2 });
  preview.unmount();
});

test("switches to a pending theme draft before its ledger read and removes only drafts superseded by a later read", () => {
  const root = document.createElement("div");
  const store = createAppearanceDraftStore({}, {});
  const paintAccent = vi.fn();
  let themeId = "light-kit";
  const useThemeStateHook = () => ({ themeId });
  const writer = renderHook(({ ready }) => useSettingsAppearance({
    store, root, accentColor: "new-accent", ready, useThemeStateHook, advancePreview: () => 9, paintAccent,
  }), { initialProps: { ready: false } });
  expect(paintAccent.mock.calls).toEqual([]);
  writer.rerender({ ready: true });
  expect(paintAccent.mock.calls).toEqual([[{ root, accentColor: "new-accent" }, {}]]);
  const port = { loadAppearance: async () => ({ color: "saved-accent" }), subscribeToSettingsRefresh: () => () => {} };
  const invalidate = vi.fn();
  let data: { appearance: { color: string }; readPreviewVersion: number } | undefined;
  const reader = renderHook(() => useAdminAppearance({
    store, root, port, useThemeStateHook, useAppearanceSnapshotHook: () => ({ data }),
    useInvalidateHook: () => invalidate, paintAccent, resolveAccent: ({ appearance }) => appearance.color, queryPrefix: ["settings", "appearance"],
  }));
  themeId = "dark-kit";
  reader.rerender();
  expect(paintAccent).toHaveBeenLastCalledWith({ root, accentColor: undefined }, {});
  themeId = "light-kit";
  reader.rerender();
  expect(paintAccent).toHaveBeenLastCalledWith({ root, accentColor: "new-accent" }, {});
  data = { appearance: { color: "saved-accent" }, readPreviewVersion: 9 };
  reader.rerender();
  expect(paintAccent).toHaveBeenLastCalledWith({ root, accentColor: "saved-accent" }, {});
  expect(store.get(root)?.has("light-kit")).toBe(false);
});
