// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createPreviewEmbedIdsLoader, previewEmbedIdsPath, usePreviewEmbedIds, type LoadPreviewEmbedIds } from "../hooks/use-preview-embed-ids.hooks.js";

afterEach(() => vi.useRealTimers());

it("keeps the current embed IDs when two pending lookups settle out of order", async () => {
  vi.useFakeTimers();
  const reads: Array<(answer: { youtubeIds: string[] }) => void> = [];
  const load: LoadPreviewEmbedIds = () => new Promise((resolve) => reads.push(resolve));
  const { result, rerender } = renderHook(({ templateChoice }) => usePreviewEmbedIds({
    useEffect, useState, id: "page", templateChoice, version: 1, previewRevision: 1, pendingHtml: null, load,
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

it.each([
  { choice: "default template", templateChoice: null, pendingHtml: null, suffix: "", body: {} },
  { choice: "explicit bare template", templateChoice: "", pendingHtml: "", suffix: "?templateChoice=", body: { bodyHtml: "" } },
  { choice: "named template", templateChoice: "News & notes.html", pendingHtml: "<p>Unsaved draft</p>", suffix: "?templateChoice=News%20%26%20notes.html", body: { bodyHtml: "<p>Unsaved draft</p>" } },
])("inspects $choice with the preview's exact template and pending HTML", async ({ templateChoice, pendingHtml, suffix, body }) => {
  type Request = Parameters<typeof createPreviewEmbedIdsLoader>[0]["request"];
  const calls: Array<[Parameters<Request>[0], Parameters<Request>[1]]> = [];
  const request: Request = async <T,>(required: Parameters<Request>[0], options?: Parameters<Request>[1]): Promise<T> => {
    calls.push([required, options]);
    return { youtubeIds: ["embed-from-template"] } as T;
  };
  const load = createPreviewEmbedIdsLoader({ workspaceId: "writer-space", request, path: previewEmbedIdsPath });
  const signal = new AbortController().signal;

  const answer = await load({ id: "news/draft #1", templateChoice, pendingHtml }, pendingHtml === null ? undefined : { signal });

  expect(answer).toEqual({ youtubeIds: ["embed-from-template"] });
  expect(calls).toEqual([[
    { path: `/workspaces/writer-space/posts/news%2Fdraft%20%231/template-preview/embeds${suffix}`, method: "POST", body },
    pendingHtml === null ? {} : { signal },
  ]]);
});
