import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from "@jini-ai/ui/fetch-query";
import { usePosts } from "../hooks/use-posts.hooks.js";
import type { AdminPost } from "../api/posts-api.types.js";

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
