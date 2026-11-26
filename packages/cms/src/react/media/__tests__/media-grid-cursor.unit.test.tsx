// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { AdminMedia, MediaGridPage } from "@jini-ai/core/contracts/site/cms-admin-media";
import { useFetchQuery } from "@jini-ai/ui/fetch-query";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { useGridPages, type MediaGridPort, type MediaGridPageRequest, type MediaGridView } from "../hooks/use-grid-pages.hooks.js";

/**
 * @file The grid's server paging seen from the screen's hook: a late page of a view nobody is looking at
 * is dropped, and a direct link beyond page one is one exact lookup, never a walk over pages. Why-comment:
 * sorting or filtering one fetched page cannot reproduce a globally ordered, filtered list, so counts and
 * order stay the server's.
 */

const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;

function asset(id: string): AdminMedia {
  return { id, title: id, status: "active", contentType: "image/png", createdAt: "2026-01-01T00:00:00.000Z" } as AdminMedia;
}

const COUNTS = { all: 5, images: 3, videos: 2, trash: 0 };

/** A port whose every answer the test releases by hand, and which records each request. */
function deferredPort() {
  const waiting: Array<{ view: MediaGridView; page: MediaGridPageRequest; resolve: (page: MediaGridPage) => void }> = [];
  const port: MediaGridPort = {
    listMediaGrid: (view, page = {}) => {
      return new Promise<MediaGridPage>((resolve) => waiting.push({ view, page, resolve }));
    },
  };
  return { port, waiting };
}

const answer = (ids: string[], nextCursor: string | null): MediaGridPage => ({ media: ids.map(asset), nextCursor, counts: COUNTS, hasUntypedActive: false });

describe("media grid cursor paging", () => {
  it("Trash policy comes from the current first page, even when that page is empty", async () => {
    const { port, waiting } = deferredPort();
    const { result, rerender } = renderHook(({ tab }) => useGridPages({ useCallback, useState, port, tab, orderBy: "created", listKey: ["media"], useFetchQuery }), { wrapper, initialProps: { tab: "trash" as const } as { tab: "trash" | "images" } });
    await waitFor(() => expect(waiting.length).toBe(1));
    await act(async () => waiting[0]!.resolve({ ...answer([], "cursor-1"), retentionDays: 30 }));
    await waitFor(() => expect(result.current.retentionDays).toBe(30));
    expect(result.current.items).toEqual([]);

    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.loadMore(); });
    await waitFor(() => expect(waiting.length).toBe(2));
    expect(waiting[1]!.page.cursor).toBe("cursor-1");
    await act(async () => { waiting[1]!.resolve({ ...answer(["legacy"], null), retentionDays: 60 }); await pending; });
    expect(result.current.retentionDays).toBe(30);
    expect(result.current.items?.map((item) => item.id)).toEqual(["legacy"]);

    rerender({ tab: "images" });
    await waitFor(() => expect(waiting.length).toBe(3));
    expect(result.current.retentionDays).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it("changing tabs during load more drops the stale response and keeps exact counts", async () => {
    const { port, waiting } = deferredPort();
    const { result, rerender } = renderHook(({ tab }) => useGridPages({ useCallback, useState, port, tab, orderBy: "created", listKey: ["media"], useFetchQuery }), { wrapper, initialProps: { tab: "all" as const } as { tab: "all" | "videos" } });
    await waitFor(() => expect(waiting.length).toBe(1));
    await act(async () => waiting[0]!.resolve(answer(["a1", "a2"], "cursor-1")));
    await waitFor(() => expect(result.current.items?.map((item) => item.id)).toEqual(["a1", "a2"]));
    expect(result.current.retentionDays).toBeNull();

    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.loadMore(); });
    await waitFor(() => expect(waiting.length).toBe(2));
    expect(waiting[1]!.page.cursor).toBe("cursor-1");

    rerender({ tab: "videos" });
    await waitFor(() => expect(waiting.length).toBe(3));
    await act(async () => waiting[2]!.resolve({ media: [asset("v1")], nextCursor: null, counts: COUNTS, hasUntypedActive: false }));
    await waitFor(() => expect(result.current.items?.map((item) => item.id)).toEqual(["v1"]));

    // The All page that was in flight answers now: it belongs to a view nobody is looking at.
    await act(async () => { waiting[1]!.resolve(answer(["a3", "a4"], null)); await pending; });
    expect(result.current.items?.map((item) => item.id)).toEqual(["v1"]);
    expect(result.current.counts).toEqual(COUNTS);
    expect(result.current.hasMore).toBe(false);
  });

});
