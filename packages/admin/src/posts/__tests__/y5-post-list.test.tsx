// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from "@jini-ai/ui/fetch-query";
import { bindPostsHooks, usePosts } from "../hooks/use-posts.hooks.js";
import type { AdminPost } from "../api/posts-api.types.js";
import * as sorting from "../../shell/lib/admin-post-list-sort.js";

afterEach(cleanup);
const post: AdminPost = { id: "one", workspaceId: "workspace", kind: "post", title: "One", slug: "one", bodyJson: { type: "doc", content: [] }, status: "draft", version: 7, updatedAt: "2026-01-01T00:00:00Z" };

test("publish uses the row version, settles cache, refreshes, and navigates creation", async () => {
  let current = post;
  const listPosts = vi.fn(async () => ({ posts: [{ post: current }] }));
  const updatePost = vi.fn(async () => ({ post: current = { ...post, status: "published" as const, version: 8 } }));
  const navigate = vi.fn();
  let refresh!: () => void;
  const { result } = renderHook(() => usePosts({ locale: "en", deps: {
    port: { listPosts, updatePost, deletePost: async () => ({ post }) }, navigate, createRoutePath: "/posts?create=1", resource: "posts",
    translate: ({ key }) => key, buildPostRowMenuHandleMap: ({ posts }) => new Map((posts ?? []).map(row => [row.id, row.id])),
  }, hooks: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useContentRefreshSubscription: ({ onRefresh }) => { refresh = onRefresh; } } }), { wrapper: FetchQueryProvider });
  await waitFor(() => expect(result.current.posts).toEqual([post]));
  await act(() => result.current.togglePostPublish(post));
  expect(updatePost).toHaveBeenCalledWith({ target: { id: "one" }, patch: { title: "One", slug: "one", bodyJson: post.bodyJson, status: "published", expectedVersion: 7 } });
  await waitFor(() => expect(result.current.posts?.[0]?.version).toBe(8));
  expect(result.current.rowSavingId).toBeNull();
  const beforeRefresh = listPosts.mock.calls.length;
  act(() => refresh());
  await waitFor(() => expect(listPosts.mock.calls.length).toBeGreaterThan(beforeRefresh));
  await act(() => result.current.createPost());
  expect(navigate).toHaveBeenCalledWith("/posts?create=1");
});

test("initial read errors and later action errors retain distinct list states", async () => {
  let readFailed = true;
  let refresh!: () => void;
  const { result } = renderHook(() => usePosts({ locale: "en", deps: {
    port: {
      listPosts: async () => { if (readFailed) throw new Error("read failed"); return { posts: [{ post }] }; },
      updatePost: async () => { throw new Error("action failed"); },
      deletePost: async () => ({ post }),
    },
    navigate: () => {}, createRoutePath: "/posts?create=1", resource: "posts", translate: ({ key }) => key,
    buildPostRowMenuHandleMap: () => new Map(),
  }, hooks: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useContentRefreshSubscription: ({ onRefresh }) => { refresh = onRefresh; } } }), { wrapper: FetchQueryProvider });
  await waitFor(() => expect(result.current.error).toBe("read failed"));
  expect(result.current.posts).toBeNull();
  readFailed = false;
  act(() => refresh());
  await waitFor(() => expect(result.current.posts).toEqual([post]));
  await act(() => result.current.togglePostPublish(post));
  expect(result.current.error).toBe("action failed");
  expect(result.current.posts).toEqual([post]);
  expect(result.current.rowSavingId).toBeNull();
});

test("the list notice distinguishes initial failure from action failure", async () => {
  const { render, screen } = await import("@testing-library/react");
  const { postsListNotice } = await import("../Posts.js");
  const mounted = render(postsListNotice({ posts: null, error: "initial", t: key => key }));
  expect(screen.getByText("initial").className).toBe("notice error");
  mounted.rerender(postsListNotice({ posts: [post], error: "action", t: key => key }));
  expect(screen.queryByText("action")).toBeNull();
  mounted.rerender(postsListNotice({ posts: null, error: null, t: key => key }));
  expect(screen.getByText("Loading posts…")).toBeTruthy();
});

test("the list columns preserve all sorting choices and use host URL builders", async () => {
  const { PostsColumns } = await import("../PostsColumns.js");
  const { render, screen, fireEvent } = await import("@testing-library/react");
  const setSort = vi.fn();
  render(<PostsColumns posts={[post, { ...post, id: "two", title: "Alpha", slug: "two" }]}
    creating={false} createPost={vi.fn()} error={null} rowMenuHandleById={new Map([["one", "one"], ["two", "two"]])}
    togglePostPublish={vi.fn()} setPendingDelete={vi.fn()} locale="en" t={key => key}
    sort={{ column: "updated", direction: "desc" }} setSort={setSort}
    kit={{ ServerLabel: ({ value }) => <>{value}</>, PublishSectionButton: () => null }}
    deps={{ sorting, translate: ({ key }) => key, siteUrl: ({ path }) => `https://site.test${path}`,
      postAdminPath: ({ slug }) => `/host/posts/${slug}`, postEditorRoute: ({ slug }) => `/posts/${slug}`,
      navigate: vi.fn(), postRowMenuItems: () => [], viewerTimeZone: "UTC" }} />);
  expect(screen.getByRole("link", { name: "One" }).getAttribute("href")).toBe("/host/posts/one");
  expect(screen.getByRole("link", { name: "/one" }).getAttribute("href")).toBe("https://site.test/one");
  fireEvent.click(screen.getByRole("button", { name: "Not sorted by Title. Activate to sort ascending." }));
  expect(setSort).toHaveBeenCalledWith({ column: "title", direction: "asc" });
  expect(screen.getByRole("columnheader", { name: /Sorted by updated date, newest first/ })).toBeTruthy();
});

test("the bound list uses the injected default, comparators, and sort labels", async () => {
  const { bindPosts } = await import("../Posts.js");
  const { render, screen, fireEvent } = await import("../../__tests__/fetch-query-support.js");
  const injected = {
    DEFAULT_ADMIN_POST_SORT: { column: "title", direction: "asc" as const },
    compareAdminPostsByTitle: vi.fn(sorting.compareAdminPostsByTitle),
    compareAdminPostsBySlug: vi.fn(sorting.compareAdminPostsBySlug),
    compareAdminPostsByStatus: vi.fn(sorting.compareAdminPostsByStatus),
    compareAdminPostsByUpdated: vi.fn(sorting.compareAdminPostsByUpdated),
    columnSortLabel: vi.fn(sorting.columnSortLabel), updatedColumnSortLabel: vi.fn(sorting.updatedColumnSortLabel),
  };
  const BoundPosts = bindPosts({
    hooks: { useLocaleHook: () => "en", usePostsHook: () => ({
      posts: [{ ...post, slug: "zeta", status: "published" }, { ...post, id: "two", title: "Alpha", slug: "alpha", status: "draft", updatedAt: "2025-01-01T00:00:00Z" }],
      error: null, creating: false, rowSavingId: null, pendingDelete: null, setPendingDelete: vi.fn(),
      createPost: vi.fn(), togglePostPublish: vi.fn(), removePost: vi.fn(), rowMenuHandleById: new Map(),
    }) },
    kit: { ServerLabel: ({ value }) => <>{value}</>, PublishSectionButton: () => null },
    deps: { sorting: injected, translate: ({ key }) => key, siteUrl: ({ path }) => path,
      postAdminPath: ({ slug }) => `/posts/${slug}`, postEditorRoute: ({ slug }) => `/posts/${slug}`,
      navigate: vi.fn(), postRowMenuItems: () => [], viewerTimeZone: "UTC" },
  });
  render(<BoundPosts />);
  expect(screen.getAllByRole("row")[1]?.textContent).toContain("Alpha");
  expect(injected.compareAdminPostsByTitle).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Not sorted by Slug. Activate to sort ascending." }));
  expect(injected.compareAdminPostsBySlug).toHaveBeenCalled();
  expect(screen.getAllByRole("link", { name: /^(Alpha|One)$/ }).map(link => link.textContent)).toEqual(["Alpha", "One"]);
  fireEvent.click(screen.getByRole("button", { name: "Not sorted by Status. Activate to sort ascending." }));
  expect(injected.compareAdminPostsByStatus).toHaveBeenCalled();
  expect(screen.getAllByRole("link", { name: /^(Alpha|One)$/ }).map(link => link.textContent)).toEqual(["Alpha", "One"]);
  fireEvent.click(screen.getByRole("button", { name: "Not sorted by updated date. Activate to sort newest first." }));
  expect(injected.compareAdminPostsByUpdated).toHaveBeenCalled();
  expect(screen.getAllByRole("row")[1]?.textContent).toContain("One");
  expect(injected.columnSortLabel).toHaveBeenCalledWith({ t: expect.any(Function), columnName: "Title", direction: "asc" });
  expect(injected.columnSortLabel).toHaveBeenCalledWith({ t: expect.any(Function), columnName: "Slug", direction: "asc" });
  expect(injected.columnSortLabel).toHaveBeenCalledWith({ t: expect.any(Function), columnName: "Status", direction: "asc" });
  expect(injected.updatedColumnSortLabel).toHaveBeenCalledWith({ t: expect.any(Function), direction: "desc" });
});

test("the bound controller localizes trash failures and drops only the confirmed post on retry", async () => {
  const keep = { ...post, id: "keep", title: "Keep" };
  let rows = [post, keep];
  const deletePost = vi.fn(async ({ id }: { id: string }) => {
    if (id !== "one") throw new Error("Unexpected deletion target");
    rows = rows.filter(row => row.id !== id);
    return { post };
  }).mockRejectedValueOnce(new Error("trash refused")).mockRejectedValueOnce("offline");
  const useBoundPosts = bindPostsHooks({
    deps: {
      port: { listPosts: async () => ({ posts: rows.map(post => ({ post })) }), updatePost: async () => ({ post }), deletePost },
      navigate: vi.fn(), createRoutePath: "/posts?create=1", resource: "posts",
      translate: ({ locale, key }) => locale + ": " + key, buildPostRowMenuHandleMap: () => new Map(),
    },
    hooks: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useContentRefreshSubscription: vi.fn(), useLocaleHook: () => "es" },
  });
  const { result } = renderHook(() => useBoundPosts({}), { wrapper: FetchQueryProvider });
  await waitFor(() => expect(result.current.posts).toEqual([post, keep]));
  expect(result.current.locale).toBe("es");
  await act(() => result.current.removePost());
  expect(deletePost.mock.calls).toEqual([]);
  for (const error of ["trash refused", "es: failed to delete post"]) {
    act(() => result.current.setPendingDelete(post));
    await act(() => result.current.removePost());
    expect(result.current).toMatchObject({ error, posts: [post, keep], pendingDelete: null, rowSavingId: null });
  }
  act(() => result.current.setPendingDelete(post));
  await act(() => result.current.removePost());
  expect(result.current).toMatchObject({ error: null, posts: [keep], pendingDelete: null, rowSavingId: null });
  expect(deletePost.mock.calls).toEqual([[{ id: "one" }], [{ id: "one" }], [{ id: "one" }]]);
});

test("renders the host-localized list, handles a loaded error inline, and opens the selected row's editor", async () => {
  const user = userEvent.setup();
  const { bindPosts } = await import("../Posts.js");
  const { render, screen, within } = await import("../../__tests__/fetch-query-support.js");
  const navigate = vi.fn();
  const createPost = vi.fn();
  let posts: AdminPost[] | null = null;
  let error: string | null = null;
  let creating = false;
  const BoundPosts = bindPosts({
    hooks: { useLocaleHook: () => "en", usePostsHook: () => ({
      posts, error, creating, rowSavingId: null, pendingDelete: null, setPendingDelete: vi.fn(),
      createPost, togglePostPublish: vi.fn(), removePost: vi.fn(), rowMenuHandleById: new Map([["one", "post-one"]]),
    }) },
    kit: { ServerLabel: ({ value }) => <>{value}</>, PublishSectionButton: () => null },
    deps: {
      sorting, translate: ({ locale, key }) => locale + "/" + key,
      siteUrl: ({ path }) => path, postAdminPath: ({ slug }) => `/backoffice/posts/${slug}`,
      postEditorRoute: ({ slug }) => `/posts/${slug}?edit=1`, navigate, viewerTimeZone: "UTC",
      postRowMenuItems: ({ post, handlers }) => [{ key: "edit", label: "Edit selected post", onSelect: () => handlers.onEdit({ post }) }],
    },
  });
  const locale = { useWiredAdminLocale: () => "es" };
  const view = render(<BoundPosts hooks={locale} />);
  expect(screen.getByText("es/Loading posts…")).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
  posts = [post];
  creating = true;
  error = "Could not remove another post";
  view.rerender(<BoundPosts hooks={locale} />);
  expect(screen.getByText(error)).toBeVisible();
  expect(screen.getByRole("link", { name: "One" })).toHaveAttribute("href", "/backoffice/posts/one");
  expect(screen.getByRole("button", { name: "es/Creating…" })).toBeDisabled();
  const action = screen.getByRole("button", { name: 'es/Actions for "One"' });
  await user.click(action);
  await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit selected post" }));
  expect(navigate.mock.calls).toEqual([[{ routePath: "/posts/one?edit=1" }]]);
  creating = false;
  view.rerender(<BoundPosts hooks={locale} />);
  await user.click(screen.getByRole("button", { name: "es/New Post" }));
  expect(createPost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "click" }));
});
