import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FetchQueryProvider } from "../adapter.react.js";
import { useCursorPages, type CursorPage } from "../use-cursor-pages.hooks.js";

const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
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
});
