import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCachedLoader, useFetchQuery, useInvalidate } from "..";
import { FetchQueryProvider } from "../tanstack.js";

/**
 * @file TanStack-adapter-specific races behind the public hooks: a loader request superseded by a
 * forced refresh or an invalidation must follow the newer request, and a transport that resolves
 * `undefined` must surface as a read failure rather than as "no data yet".
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("tanstack adapter races", () => {
  it("reports a transport that resolves undefined as a read failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useFetchQuery({ key: ["undefined-data"], fetch: async () => undefined as unknown as string }), { wrapper: FetchQueryProvider });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
    vi.restoreAllMocks();
  });

  it("lets a loader joined to the initial read follow a forced refresh to the newer value", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const key = ["forced-refresh"] as const;
    const { result } = renderHook(() => ({ read: useFetchQuery({ key, fetch }), loader: useCachedLoader({ key, fetch }) }), { wrapper: FetchQueryProvider });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const pending = result.current.loader.load();
    act(() => { result.current.read.refetch(); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve("refreshed"); first.resolve("obsolete"); });
    await expect(pending).resolves.toBe("refreshed");
    await waitFor(() => expect(result.current.read.data).toBe("refreshed"));
  });

  it("lets a loader-only read superseded by an invalidation join the post-write request", async () => {
    const first = deferred<string>();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("after-write");
    const key = ["invalidated-loader"] as const;
    const { result } = renderHook(() => ({ loader: useCachedLoader({ key, fetch }), invalidate: useInvalidate() }), { wrapper: FetchQueryProvider });
    const pending = result.current.loader.load();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => { result.current.invalidate({ key }); });
    await act(async () => { first.resolve("before-write"); });
    await expect(pending).resolves.toBe("after-write");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.loader.peek()).toBe("after-write");
  });
});

describe("tanstack adapter cold replacement", () => {
  it("publishes a replacement on a never-read key to a later reader without fetching, and refetches with the reader's own fetch", async () => {
    const { render, screen } = await import("@testing-library/react");
    const loaderFetch = vi.fn(async () => "from-loader-fetch");
    const readerFetch = vi.fn(async () => "from-reader-fetch");
    const key = ["cold-replace"] as const;
    let loader!: ReturnType<typeof useCachedLoader<string>>;
    let invalidate!: ReturnType<typeof useInvalidate>;
    function Loader() { loader = useCachedLoader({ key, fetch: loaderFetch }); invalidate = useInvalidate(); return null; }
    function Reader() { const query = useFetchQuery({ key, fetch: readerFetch }); return <span data-testid="data">{query.data}</span>; }
    const view = render(<FetchQueryProvider><Loader /></FetchQueryProvider>);
    act(() => loader.replace({ value: "replaced" }));
    expect(loader.peek()).toBe("replaced");
    view.rerender(<FetchQueryProvider><Loader /><Reader /></FetchQueryProvider>);
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("replaced"));
    expect(readerFetch).not.toHaveBeenCalled();
    act(() => invalidate({ key }));
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("from-reader-fetch"));
    expect(loaderFetch).not.toHaveBeenCalled();
  });
});
