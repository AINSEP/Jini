import { expect, test } from "vitest";
import { resolveActiveThemeId, type ActiveThemeIdResolutionDeps } from "../../../presentation/site/active-theme-id.js";
import { hasRequestRenderTheme, resolveRenderThemeId, setRequestRenderTheme } from "../render-theme-override.js";

const storedDeps = (themeId: string) => ({
  workspaceId: "ws",
  presentationRepo: { findByWorkspaceId: async () => ({ activeThemeId: themeId }) },
}) as unknown as ActiveThemeIdResolutionDeps;

test("a stamped request reports an override and renders with it, never reading the stored theme", async () => {
  const response = { locals: {} as Record<string, unknown> };
  expect(hasRequestRenderTheme({ response })).toBe(false);
  setRequestRenderTheme({ response, themeId: "preview-theme" });
  expect(hasRequestRenderTheme({ response })).toBe(true);
  const throwing = { workspaceId: "ws", presentationRepo: { findByWorkspaceId: async () => { throw new Error("must not read"); } } } as unknown as ActiveThemeIdResolutionDeps;
  await expect(resolveRenderThemeId({ response, resolveStoredThemeId: () => resolveActiveThemeId(throwing) })).resolves.toBe("preview-theme");
});

test("render-theme-reader-ignores-override: an unstamped request reports none and falls back to the stored theme", async () => {
  expect(hasRequestRenderTheme({ response: { locals: {} } })).toBe(false);
  expect(hasRequestRenderTheme({ response: {} })).toBe(false);
  expect(hasRequestRenderTheme({ response: undefined })).toBe(false);
  await expect(resolveRenderThemeId({ response: { locals: {} }, resolveStoredThemeId: () => resolveActiveThemeId(storedDeps("stored")) })).resolves.toBe("stored");
});

test("an empty-string override resolves as itself but does not count as an override to the reader", async () => {
  const response = { locals: {} as Record<string, unknown> };
  setRequestRenderTheme({ response, themeId: "" });
  expect(hasRequestRenderTheme({ response })).toBe(false);
  await expect(resolveRenderThemeId({ response, resolveStoredThemeId: () => resolveActiveThemeId(storedDeps("stored")) })).resolves.toBe("");
});
