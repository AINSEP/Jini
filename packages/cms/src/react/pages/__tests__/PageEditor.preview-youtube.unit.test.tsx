// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewEmbedIds, type LoadPreviewEmbedIds } from "../hooks/use-preview-embed-ids.hooks.js";

afterEach(() => vi.useRealTimers());

it("keeps the current embed IDs when two pending lookups settle out of order", async () => {
  vi.useFakeTimers();
  const reads: Array<(answer: { youtubeIds: string[] }) => void> = [];
  const load: LoadPreviewEmbedIds = () => new Promise((resolve) => reads.push(resolve));
  const { result, rerender } = renderHook(({ templateChoice }) => usePreviewEmbedIds({
    id: "page", templateChoice, version: 1, previewRevision: 1, pendingHtml: null, load,
  }), { initialProps: { templateChoice: "old" } });
  act(() => vi.advanceTimersByTime(500));
  rerender({ templateChoice: "new" });
  act(() => vi.advanceTimersByTime(500));
  expect(reads).toHaveLength(2);
  await act(async () => reads[1]!({ youtubeIds: ["new-id"] }));
  expect(result.current).toEqual(["new-id"]);
  await act(async () => reads[0]!({ youtubeIds: ["old-id"] }));
  expect(result.current).toEqual(["new-id"]);
});
