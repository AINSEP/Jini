// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from "@jini-ai/ui/fetch-query";

import { AdminKitProvider } from "../../react/kit.js";
import { fakeAdminKit } from "../../react/testing-kit.js";
import { usePages } from "../hooks/use-pages.hooks.js";
import type { PageListRow, PagesEventsPort, PagesPort } from "../hooks/pages-port.hooks.js";

/**
 * @file `usePages` against its injected seams only — the host keeps the full behavioral suite
 * (driven through its own fake port and wired half). These pin the two seams this package added
 * when the list moved here: the `events` port (the host's resource-filtered content-refresh
 * notification) and the injected `pageAdminPath` rule "New Page" navigates through.
 */

const kit = fakeAdminKit({ query: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope } });
function wrapper({ children }: { children: ReactNode }) {
  return createElement(AdminKitProvider, { kit, children: createElement(FetchQueryProvider, { children }) });
}

const PAGE: PageListRow = { id: "pg1", title: "About", slug: "about", bodyJson: {}, status: "published", updatedAt: "2026-08-01T00:00:00.000Z", version: 1 };

function fakePort(pages: PageListRow[]): PagesPort {
  return {
    listPages: vi.fn(async () => ({ posts: pages.map((post) => ({ post })) })),
    createPage: vi.fn(async ({ title }: { title: string }) => ({ post: { ...PAGE, id: "pg-new", title, slug: "untitled" } })),
    updatePost: vi.fn(async ({ target }: { target: { id: string } }) => ({ post: { ...PAGE, id: target.id } })),
    deletePage: vi.fn(async ({ id }: { id: string }) => ({ post: { ...PAGE, id } })),
  };
}

function fakeEvents(): PagesEventsPort & { fire(): void; unsubscribe: ReturnType<typeof vi.fn> } {
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  return {
    unsubscribe,
    fire: () => listeners.forEach((listener) => listener()),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); unsubscribe(); };
    },
  };
}

describe("usePages — injected events port", () => {
  it("reloads the list when the host's events port fires, and unsubscribes on unmount", async () => {
    const port = fakePort([PAGE]);
    const events = fakeEvents();
    const { result, unmount } = renderHook(
      () => usePages({ port, navigate: vi.fn(), t: (k) => k, locale: "en", events, pageAdminPath: (page) => `/pages/${page.slug}` }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.pages).toEqual([PAGE]));
    const callsBefore = vi.mocked(port.listPages).mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    act(() => events.fire());
    await waitFor(() => expect(port.listPages).toHaveBeenCalledTimes(callsBefore + 1));

    unmount();
    expect(events.unsubscribe).toHaveBeenCalled();
  });
});

describe("usePages — injected pageAdminPath", () => {
  it("navigates a newly created page through the host's pageAdminPath rule", async () => {
    const port = fakePort([PAGE]);
    const navigate = vi.fn();
    const pageAdminPath = vi.fn((page: Pick<PageListRow, "id" | "slug">) => `/pages/by-host/${page.id}`);
    const { result } = renderHook(
      () => usePages({ port, navigate, t: (k) => k, locale: "en", events: fakeEvents(), pageAdminPath }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.pages).not.toBeNull());

    await act(async () => { await result.current.createPage(); });

    expect(pageAdminPath).toHaveBeenCalledWith(expect.objectContaining({ id: "pg-new" }));
    expect(navigate).toHaveBeenCalledWith("/pages/by-host/pg-new");
  });
});

it("flips publication using the selected row's basis, then moves only that row to trash", async () => {
  const unrelated = { ...PAGE, id: "stay", title: "Stay", slug: "stay" };
  const changed = { ...PAGE, status: "draft" as const, version: 2 };
  let rows = [PAGE, unrelated];
  const updatePost = vi.fn<PagesPort["updatePost"]>(async () => { rows = [changed, unrelated]; return { post: changed }; });
  const deletePage = vi.fn<PagesPort["deletePage"]>(async () => { rows = [unrelated]; return { post: changed }; });
  const port: PagesPort = { ...fakePort([]), listPages: async () => ({ posts: rows.map(post => ({ post })) }), updatePost, deletePage };
  const deps = { port, navigate: vi.fn(), t: (k: string) => k, locale: "en", events: fakeEvents(), pageAdminPath: (page: Pick<PageListRow, "id" | "slug">) => `/pages/${page.slug}` };
  const { result } = renderHook(() => usePages(deps), { wrapper });
  await waitFor(() => expect(result.current.pages).toEqual([PAGE, unrelated]));
  await act(() => result.current.removePage());
  expect(deletePage.mock.calls).toEqual([]);

  await act(() => result.current.togglePagePublish(PAGE));
  expect(updatePost.mock.calls).toEqual([[{
    target: { id: "pg1" }, patch: { title: "About", slug: "about", bodyJson: {}, status: "draft", expectedVersion: 1 },
  }]]);
  expect(result.current.pages).toEqual([changed, unrelated]);
  expect(result.current.rowSavingId).toBeNull();

  act(() => result.current.setPendingDelete(changed));
  await act(() => result.current.removePage());
  expect(deletePage.mock.calls).toEqual([[{ id: "pg1" }]]);
  expect(result.current).toMatchObject({ pages: [unrelated], pendingDelete: null, rowSavingId: null, error: null });
});

it("keeps rows intact and clears busy state on publish, trash, and create errors", async () => {
  const draft = { ...PAGE, status: "draft" as const };
  const port = fakePort([PAGE, { ...draft, id: "draft", title: "Draft" }]);
  const navigate = vi.fn();
  vi.mocked(port.listPages).mockRejectedValueOnce("offline");
  vi.mocked(port.createPage).mockRejectedValueOnce(new Error("duplicate title")).mockRejectedValueOnce("offline");
  vi.mocked(port.updatePost).mockRejectedValueOnce("offline").mockRejectedValueOnce("offline").mockRejectedValueOnce(new Error("version conflict"));
  vi.mocked(port.deletePage).mockRejectedValueOnce(new Error("trash refused")).mockRejectedValueOnce("offline");
  const events = fakeEvents();
  const deps = { port, navigate, events, t: (k: string) => k, locale: "en", pageAdminPath: ({ slug }: { slug: string }) => `/pages/${slug}` };
  const { result } = renderHook(() => usePages(deps), { wrapper });
  await waitFor(() => expect(result.current.error).toBe("failed to load pages"));
  act(() => events.fire());
  await waitFor(() => expect(result.current.pages?.map(p => p.id)).toEqual(["pg1", "draft"]));
  const draftRow = result.current.pages!.find(p => p.id === "draft")!;
  for (const [row, error] of [[PAGE, "failed to unpublish page"], [draftRow, "failed to publish page"], [PAGE, "version conflict"]] as const) {
    await act(() => result.current.togglePagePublish(row));
    expect(result.current).toMatchObject({ error, rowSavingId: null });
  }
  for (const error of ["trash refused", "failed to delete page"]) {
    act(() => result.current.setPendingDelete(PAGE));
    await act(() => result.current.removePage());
    expect(result.current).toMatchObject({ error, pendingDelete: null, rowSavingId: null });
  }
  for (const error of ["duplicate title", "failed to create page"]) {
    await act(() => result.current.createPage());
    expect(result.current).toMatchObject({ error, creating: false });
  }
  expect(result.current.pages?.map(p => [p.id, p.status])).toEqual([["pg1", "published"], ["draft", "draft"]]);
  expect(navigate.mock.calls).toEqual([]);
});
