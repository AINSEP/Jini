import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { bindAdminAppearance } from "../appearance.js";

afterEach(cleanup);

test("namespace and global refresh invalidate the bound appearance snapshot", () => {
  let refresh!: (scope: readonly string[] | null) => void;
  const unsubscribe = vi.fn();
  const invalidate = vi.fn();
  const root = document.createElement("div");
  const bound = bindAdminAppearance({
    hooks: {
      useThemeStateHook: () => ({ themeId: "classic" }),
      useAppearanceSnapshotHook: () => ({ data: undefined }),
      useInvalidateHook: () => invalidate,
    },
    deps: {
      namespace: "core.appearance", getRoot: () => root,
      loadAppearance: async () => ({ theme: "light", accentColor: "saved" }),
      subscribeToSettingsRefresh: listener => { refresh = listener; return unsubscribe; },
      advancePreview: () => 1, paintAccent: vi.fn(),
      resolveAccent: ({ appearance }) => appearance.accentColor,
    },
  });
  const mounted = renderHook(() => bound.useAdminAppearance({}));
  refresh(["unrelated"]);
  expect(invalidate).not.toHaveBeenCalled();
  refresh(["core.appearance"]);
  refresh(null);
  expect(invalidate.mock.calls).toEqual([[{ key: ["settings", "core.appearance"] }], [{ key: ["settings", "core.appearance"] }]]);
  mounted.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test("preview and snapshot share drafts across theme switches and newer drafts survive older reads", () => {
  const root = document.createElement("div");
  const paintAccent = vi.fn();
  let themeId = "first";
  let previewVersion = 0;
  let readPreviewVersion = 0;
  const appearance = { theme: "light" as const, accentColor: "saved", accentColors: { first: "first-saved", second: "second-saved" } };
  const bound = bindAdminAppearance({
    hooks: {
      useThemeStateHook: () => ({ themeId }),
      useAppearanceSnapshotHook: () => ({ data: { appearance, readPreviewVersion } }),
      useInvalidateHook: () => () => {},
    },
    deps: {
      namespace: "core.appearance", getRoot: () => root,
      loadAppearance: async () => appearance,
      subscribeToSettingsRefresh: () => () => {},
      advancePreview: () => ++previewVersion, paintAccent,
      resolveAccent: ({ appearance: value, themeId: id }) => value.accentColors?.[id],
    },
  });
  const preview = renderHook(({ accentColor }) => bound.useSettingsAppearance({ accentColor, ready: true }), { initialProps: { accentColor: "first-draft" } });
  const live = renderHook(() => bound.useAdminAppearance({}));
  expect(paintAccent).toHaveBeenLastCalledWith({ accentColor: "first-draft", root }, {});
  themeId = "second";
  live.rerender();
  expect(paintAccent).toHaveBeenLastCalledWith({ accentColor: "second-saved", root }, {});
  preview.rerender({ accentColor: "second-draft" });
  readPreviewVersion = 1;
  live.rerender();
  expect(paintAccent).toHaveBeenLastCalledWith({ accentColor: "second-draft", root }, {});
  themeId = "first";
  live.rerender();
  expect(paintAccent).toHaveBeenLastCalledWith({ accentColor: "first-saved", root }, {});
  themeId = "second";
  live.rerender();
  expect(paintAccent).toHaveBeenLastCalledWith({ accentColor: "second-draft", root }, {});
});
