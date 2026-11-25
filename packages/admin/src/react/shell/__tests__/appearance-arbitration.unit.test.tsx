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
