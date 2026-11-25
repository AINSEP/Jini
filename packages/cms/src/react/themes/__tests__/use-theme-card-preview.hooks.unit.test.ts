import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useThemeCardPreview } from "../hooks/use-theme-card-preview.hooks.js";

test("D-22: an advertised PNG is used immediately, with no JPEG probe", () => {
  const { result } = renderHook(() => useThemeCardPreview({ themeId: "tovu-starter", previewImageUrl: "/theme-assets/tovu-starter/screenshots/index.png" }));
  expect(result.current.src).toBe("/theme-assets/tovu-starter/screenshots/index.png");
  expect(result.current.failed).toBe(false);
  act(() => result.current.handleError());
  expect(result.current.failed).toBe(true);
});

test("a theme without screenshots renders a placeholder", () => {
  const { result } = renderHook(() => useThemeCardPreview({ themeId: "none", previewImageUrl: null }));
  expect(result.current.failed).toBe(true);
});

test("older servers retain JPEG then PNG fallback, and a rescan can restore an image", () => {
  const { result, rerender } = renderHook(({ url }: { url?: string | null }) => useThemeCardPreview({ themeId: "signal", previewImageUrl: url }), { initialProps: { url: undefined } as { url?: string | null } });
  expect(result.current.src).toBe("/theme-assets/signal/screenshots/index.jpg");
  act(() => result.current.handleError());
  expect(result.current.src).toBe("/theme-assets/signal/screenshots/index.png");
  act(() => result.current.handleError());
  expect(result.current.failed).toBe(true);
  rerender({ url: "/theme-assets/signal/screenshots/index.png" });
  expect(result.current.failed).toBe(false);
  expect(result.current.src).toBe("/theme-assets/signal/screenshots/index.png");
});
