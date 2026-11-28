import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FetchQueryProvider } from "../adapter.react.js";
import { useCursorPages, type CursorPage } from "../use-cursor-pages.hooks.js";

const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useCursorPages", () => {
  it("loads the first page for the applied filters, then appends the next page by cursor", async () => {
    const calls: Array<{ filters: string; cursor: string | undefined }> = [];
    const fetchPage = async ({ filters }: { filters: string }, { cursor }: { cursor?: string | undefined } = {}): Promise<CursorPage<number>> => {
      calls.push({ filters, cursor });
      return cursor === undefined ? { items: [1, 2], nextCursor: "c2" } : { items: [3], nextCursor: null };
    };
    const { result } = renderHook(() => useCursorPages({ key: ({ filters }) => ["cursor-pages", filters], fetchPage, initialFilters: "all" }), { wrapper });
    expect(result.current.rows).toBeNull();
    await waitFor(() => expect(result.current.rows).toEqual([1, 2]));
    expect(result.current.nextCursor).toBe("c2");
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.rows).toEqual([1, 2, 3]);
    expect(result.current.nextCursor).toBeNull();
    expect(calls).toEqual([{ filters: "all", cursor: undefined }, { filters: "all", cursor: "c2" }]);
  });

  it("drops a load-more that resolves after new filters were applied", async () => {
    const late = deferred<CursorPage<string>>();
    const fetchPage = async ({ filters }: { filters: string }, { cursor }: { cursor?: string | undefined } = {}): Promise<CursorPage<string>> => {
      if (cursor !== undefined) return late.promise;
      return { items: [`${filters}-1`], nextCursor: "next" };
    };
    const { result } = renderHook(() => useCursorPages({ key: ({ filters }) => ["cursor-pages-race", filters], fetchPage, initialFilters: "a" }), { wrapper });
    await waitFor(() => expect(result.current.rows).toEqual(["a-1"]));
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadMore(); });
    expect(result.current.loadingMore).toBe(true);
    act(() => result.current.applyFilters("b"));
    await waitFor(() => expect(result.current.rows).toEqual(["b-1"]));
    await act(async () => { late.resolve({ items: ["a-2"], nextCursor: null }); await pending; });
    expect(result.current.rows).toEqual(["b-1"]);
    expect(result.current.loadingMore).toBe(false);
  });

  it("reports a load-more failure raw and clears it when new filters are applied", async () => {
    const boom = new Error("boom");
    const fetchPage = async ({ filters }: { filters: string }, { cursor }: { cursor?: string | undefined } = {}): Promise<CursorPage<string>> => {
      if (cursor !== undefined) throw boom;
      return { items: [filters], nextCursor: "next" };
    };
    const { result } = renderHook(() => useCursorPages({ key: ({ filters }) => ["cursor-pages-fail", filters], fetchPage, initialFilters: "a" }), { wrapper });
    await waitFor(() => expect(result.current.rows).toEqual(["a"]));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.failure).toEqual({ error: boom });
    act(() => result.current.applyFilters("b"));
    await waitFor(() => expect(result.current.rows).toEqual(["b"]));
    expect(result.current.failure).toBeNull();
  });
  it("ignores a second loadMore while the first is still in flight, so the next page is fetched and appended once", async () => {
    const late = deferred<CursorPage<string>>();
    const cursors: string[] = [];
    const fetchPage = async (_required: { filters: string }, { cursor }: { cursor?: string | undefined } = {}): Promise<CursorPage<string>> => {
      if (cursor === undefined) return { items: ["p1"], nextCursor: "c2" };
      cursors.push(cursor);
      return late.promise;
    };
    const { result } = renderHook(() => useCursorPages({ key: ({ filters }) => ["cursor-pages-double", filters], fetchPage, initialFilters: "a" }), { wrapper });
    await waitFor(() => expect(result.current.rows).toEqual(["p1"]));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.loadMore(); });
    act(() => { second = result.current.loadMore(); });
    await act(async () => { late.resolve({ items: ["p2"], nextCursor: null }); await Promise.all([first, second]); });
    expect(cursors).toEqual(["c2"]);
    expect(result.current.rows).toEqual(["p1", "p2"]);
    expect(result.current.loadingMore).toBe(false);
  });

  it("drops a load-more failure that rejects after new filters were applied", async () => {
    const late = deferred<CursorPage<string>>();
    const fetchPage = async ({ filters }: { filters: string }, { cursor }: { cursor?: string | undefined } = {}): Promise<CursorPage<string>> => {
      if (cursor !== undefined) return late.promise;
      return { items: [`${filters}-1`], nextCursor: "next" };
    };
    const { result } = renderHook(() => useCursorPages({ key: ({ filters }) => ["cursor-pages-race-fail", filters], fetchPage, initialFilters: "a" }), { wrapper });
    await waitFor(() => expect(result.current.rows).toEqual(["a-1"]));
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadMore(); });
    act(() => result.current.applyFilters("b"));
    await waitFor(() => expect(result.current.rows).toEqual(["b-1"]));
    await act(async () => { late.reject(new Error("old filters failed")); await pending; });
    expect(result.current.failure).toBeNull();
    expect(result.current.rows).toEqual(["b-1"]);
    expect(result.current.loadingMore).toBe(false);
  });

  it("reports a first-page failure raw, with no rows", async () => {
    const boom = new Error("first page down");
    const fetchPage = async (): Promise<CursorPage<string>> => { throw boom; };
    const { result } = renderHook(() => useCursorPages({ key: ({ filters }) => ["cursor-pages-first-fail", filters], fetchPage, initialFilters: "a" }), { wrapper });
    await waitFor(() => expect(result.current.failure).toEqual({ error: boom }));
    expect(result.current.rows).toBeNull();
    expect(result.current.nextCursor).toBeNull();
  });
});
