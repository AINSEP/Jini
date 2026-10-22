import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { FetchQueryProvider as BuiltInProvider, useCachedLoader, useFetchQuery } from "..";
import { FetchQueryProvider as TanStackProvider } from "../tanstack.js";

/**
 * @file A loader created with a key but no default fetch (`CachedLoaderDefaults`), on both adapters:
 * every read that names its own `{ key, fetch }` works and is cached, while an argument-less `load()`
 * rejects with the named missing-fetch error and leaves the shared cache untouched — an observer of
 * the loader's own key sees no error published by the misuse.
 */
describe.each([["built-in", BuiltInProvider], ["tanstack", TanStackProvider]] as const)("%s adapter: loader without a default fetch", (_name, FetchQueryProvider) => {
  it("serves reads that bring their own key and fetch", async () => {
    const fetch = vi.fn(async () => "file text");
    const { result } = renderHook(() => useCachedLoader<string>({ key: ["files", "t1"] }, { staleTime: Infinity }), { wrapper: FetchQueryProvider });
    let read!: Promise<string>;
    act(() => { read = result.current.load({ key: ["files", "t1", "a.css"], fetch }); });
    await expect(read).resolves.toBe("file text");
    // A second read of the same key inside the freshness window is a cache hit, not a refetch.
    await act(async () => { await expect(result.current.load({ key: ["files", "t1", "a.css"], fetch })).resolves.toBe("file text"); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an argument-less load with the named error and publishes nothing to the cache", async () => {
    const observerFetch = vi.fn(async () => "observed");
    const { result } = renderHook(() => ({
      loader: useCachedLoader<string>({ key: ["files", "t2"] }, { staleTime: 0 }),
      read: useFetchQuery({ key: ["files", "t2"], fetch: observerFetch }, { staleTime: Infinity }),
    }), { wrapper: FetchQueryProvider });
    await waitFor(() => expect(result.current.read.data).toBe("observed"));
    await act(async () => {
      await expect(result.current.loader.load()).rejects.toThrow('Cached loader for key ["files","t2"] has no default fetch');
    });
    expect(result.current.read).toMatchObject({ data: "observed", status: "success", error: null });
    expect(result.current.loader.peek()).toBe("observed");
    expect(observerFetch).toHaveBeenCalledTimes(1);
  });
});
