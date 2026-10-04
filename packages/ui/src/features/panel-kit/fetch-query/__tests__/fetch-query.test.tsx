import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useInvalidate } from "..";

/**
 * @file Behavioural contract for `lib/fetch-query`.
 *
 * These assert the PROMISES THE INTERFACE MAKES, never TanStack's own
 * behaviour, and they import only from `..` — the public surface. That is
 * deliberate and load-bearing: this file is the acceptance suite a replacement
 * adapter has to pass, so if it referenced `@tanstack/*` types or internals it
 * would silently become untransferable and the rip-out claim in `index.ts`
 * would lose its evidence.
 *
 * Each `render` gets its own `FetchQueryProvider`, so each test starts from a
 * cold cache (the provider builds its client in a `useMemo` for exactly this
 * reason).
 */

function wrap(ui: ReactNode) {
  return render(<FetchQueryProvider>{ui}</FetchQueryProvider>);
}

/** Deferred promise, so a test can assert on the in-flight state before
 *  letting a request finish. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Reader({ fetch, enabled }: { fetch: () => Promise<string>; enabled?: boolean }) {
  const q = useFetchQuery({ key: ["thing"], fetch }, { ...(enabled === undefined ? {} : { enabled }) });
  return (
    <div>
      <span data-testid="status">{q.status}</span>
      <span data-testid="fetching">{String(q.isFetching)}</span>
      <span data-testid="data">{q.data ?? "-"}</span>
      <span data-testid="error">{q.error?.message ?? "-"}</span>
      <button type="button" onClick={q.refetch}>
        refetch
      </button>
    </div>
  );
}

function DisabledReader({ fetch }: { fetch: () => Promise<string> }) {
  const lazy = useFetchQuery({ key: ["thing"], fetch }, { enabled: false });
  return <><span data-testid="lazy-status">{lazy.status}</span><span data-testid="lazy-error">{lazy.error?.message ?? "-"}</span></>;
}

describe("useFetchQuery", () => {
  it("reports loading, then success with the resolved data", async () => {
    wrap(<Reader fetch={async () => "hello"} />);
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("success"));
    expect(screen.getByTestId("data")).toHaveTextContent("hello");
  });

  it("surfaces a rejection as an Error on the error channel, never as empty data", async () => {
    wrap(<Reader fetch={async () => Promise.reject(new Error("route exploded"))} />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("route exploded");
    expect(screen.getByTestId("data")).toHaveTextContent("-");
  });

  it("normalises a non-Error rejection into an Error, so callers can rely on .message", async () => {
    wrap(<Reader fetch={async () => Promise.reject("just a string")} />);
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("just a string"));
  });

  it.each([false, true])("exposes the last error while refetching, replaces it on failure and clears it on success (cached data: %s)", async cached => {
    const firstError = new Error("first failure");
    const secondError = new Error("second failure");
    const failed = deferred<string>();
    const recovered = deferred<string>();
    const fetch = vi.fn<() => Promise<string>>();
    if (cached) fetch.mockResolvedValueOnce("cached");
    fetch.mockRejectedValueOnce(firstError).mockImplementationOnce(() => failed.promise).mockImplementationOnce(() => recovered.promise);
    const { result } = renderHook(() => useFetchQuery({ key: ["retry-error"], fetch }), { wrapper: FetchQueryProvider });
    if (cached) {
      await waitFor(() => expect(result.current.data).toBe("cached"));
      act(() => result.current.refetch());
    }
    await waitFor(() => expect(result.current.status).toBe("error"));
    const data = cached ? "cached" : undefined;
    expect(result.current.data).toBe(data);
    expect(result.current.error).toBe(firstError);
    expect(result.current.isFetching).toBe(false);

    act(() => result.current.refetch());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(cached ? 3 : 2));
    expect(result.current.data).toBe(data);
    expect(result.current.error).toBe(firstError);
    expect(result.current.status).toBe(cached ? "error" : "loading");
    expect(result.current.isFetching).toBe(true);

    await act(async () => failed.reject(secondError));
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toBe(data);
    expect(result.current.error).toBe(secondError);
    expect(result.current.status).toBe("error");

    act(() => result.current.refetch());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(cached ? 4 : 3));
    expect(result.current.data).toBe(data);
    expect(result.current.error).toBe(secondError);
    expect(result.current.status).toBe(cached ? "error" : "loading");
    expect(result.current.isFetching).toBe(true);
    await act(async () => recovered.resolve("recovered"));
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toBe("recovered");
    expect(result.current.error).toBeNull();
    expect(result.current.isFetching).toBe(false);
  });

  it("does not run while disabled, and runs once enabled — the lazy-cell contract", async () => {
    const fetch = vi.fn(async () => "hits");
    const { rerender } = wrap(<Reader fetch={fetch} enabled={false} />);

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    expect(screen.getByTestId("fetching")).toHaveTextContent("false");

    rerender(
      <FetchQueryProvider>
        <Reader fetch={fetch} enabled />
      </FetchQueryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("hits"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression — external review, 2026-08-01. Disabling a query does NOT make
   * the cache forget an earlier failure, and passing that through meant a
   * remounted gesture-gated cell rendered a stale error before the operator had
   * gestured: a failure they never asked for and cannot dismiss.
   */
  it("a disabled query reports no error even when the same key already failed", async () => {
    const fetch = vi.fn(async () => Promise.reject(new Error("hits route down")));

    const { rerender } = wrap(<Reader fetch={fetch} enabled />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    rerender(
      <FetchQueryProvider>
        <Reader fetch={fetch} enabled />
        <DisabledReader fetch={fetch} />
      </FetchQueryProvider>,
    );

    // The disabled sibling shares the failed key but must stay quiet.
    expect(screen.getByTestId("lazy-status")).toHaveTextContent("loading");
    expect(screen.getByTestId("lazy-error")).toHaveTextContent("-");
  });

  /**
   * Regression — external review, 2026-08-01/02, round 2. The test above only
   * covers a key that NEVER succeeded. A key that succeeded once and then
   * failed on a LATER background refresh keeps its stale `data` — TanStack
   * does not clear `data` on a refetch error — and disabling it at that point
   * must not silently launder that into an unqualified success: the data is
   * still real and worth showing (`status` stays `'success'`), but `error`
   * must carry the failure rather than being hidden behind the
   * never-succeeded case's `null`, or a caller has no way to tell the last
   * refresh attempt broke.
   */
  it("a disabled query with data from an earlier success still surfaces a later refresh's failure", async () => {
    let call = 0;
    const fetch = vi.fn(() => {
      call++;
      return call === 1 ? Promise.resolve("v1") : Promise.reject(new Error("refresh broke"));
    });

    const { rerender } = wrap(<Reader fetch={fetch} />);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));

    await userEvent.click(screen.getByRole("button", { name: "refetch" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    // The failed refresh keeps the stale data rather than clearing it.
    expect(screen.getByTestId("data")).toHaveTextContent("v1");

    rerender(
      <FetchQueryProvider>
        <Reader fetch={fetch} enabled={false} />
      </FetchQueryProvider>,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("success");
    expect(screen.getByTestId("data")).toHaveTextContent("v1");
    expect(screen.getByTestId("error")).toHaveTextContent("refresh broke");
  });

  it("shares one request between two components mounted on the same key", async () => {
    const fetch = vi.fn(async () => "shared");
    wrap(
      <>
        <Reader fetch={fetch} />
        <Reader fetch={fetch} />
      </>,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("data").map((el) => el.textContent)).toEqual(["shared", "shared"]);
      expect(screen.getAllByTestId("status").map((el) => el.textContent)).toEqual(["success", "success"]);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses explicit staleTime across remounts, refetching only after that interval", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetch = vi.fn().mockResolvedValueOnce("fresh").mockResolvedValue("refreshed");
    function StaleReader() {
      const q = useFetchQuery<string>({ key: ["stale-thing"], fetch }, { staleTime: 60_000 });
      return <span data-testid="data">{q.data ?? "-"}</span>;
    }
    try {
      const { rerender } = wrap(<StaleReader />);
      await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("fresh"));
      rerender(<FetchQueryProvider>{null}</FetchQueryProvider>);
      clock.mockReturnValue(1_059_999);
      rerender(<FetchQueryProvider><StaleReader /></FetchQueryProvider>);
      expect(screen.getByTestId("data")).toHaveTextContent("fresh");
      expect(fetch).toHaveBeenCalledTimes(1);
      rerender(<FetchQueryProvider>{null}</FetchQueryProvider>);
      clock.mockReturnValue(1_060_001);
      rerender(<FetchQueryProvider><StaleReader /></FetchQueryProvider>);
      await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("refreshed"));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
});

/**
 * The distinction the old `useState` triple could not express, and the reason
 * the pilot screen stopped blanking after every edit: a refresh of data we
 * already hold is `success` + `isFetching`, NOT `loading`.
 */
describe("background refresh", () => {
  it("keeps status 'success' while re-fetching, so a screen never flashes its skeleton back", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let call = 0;
    const fetch = () => (call++ === 0 ? first.promise : second.promise);

    wrap(<Reader fetch={fetch} />);
    first.resolve("v1");
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));

    await userEvent.click(screen.getByRole("button", { name: "refetch" }));
    await waitFor(() => expect(screen.getByTestId("fetching")).toHaveTextContent("true"));

    expect(screen.getByTestId("status")).toHaveTextContent("success");
    expect(screen.getByTestId("data")).toHaveTextContent("v1");

    second.resolve("v2");
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v2"));
  });
});

function Writer({
  run,
  invalidates,
  fetch,
}: {
  run: () => Promise<string>;
  invalidates?: readonly (readonly string[])[];
  fetch: () => Promise<string>;
}) {
  const q = useFetchQuery({ key: ["thing"], fetch });
  const m = useFetchMutation({ run }, { ...(invalidates ? { invalidates } : {}) });
  return (
    <div>
      <span data-testid="data">{q.data ?? "-"}</span>
      <span data-testid="mstatus">{m.status}</span>
      <span data-testid="merror">{m.error?.message ?? "-"}</span>
      {/* Deliberately NO `.catch()` — this is the documented fire-and-forget
          form, and a local catch here would make the unhandledrejection test
          below pass no matter what the adapter does. */}
      <button type="button" onClick={() => void m.mutate({ input: undefined as never })}>
        write
      </button>
      <button type="button" onClick={m.reset}>
        reset
      </button>
    </div>
  );
}

describe("useFetchMutation", () => {
  it("invalidates the named key on success, refetching a list nobody told to reload", async () => {
    let version = 0;
    const fetch = vi.fn(async () => `v${++version}`);
    wrap(<Writer run={async () => "ok"} invalidates={[["thing"]]} fetch={fetch} />);

    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));
    await userEvent.click(screen.getByRole("button", { name: "write" }));

    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v2"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does NOT invalidate when the write fails — a rejected write changed nothing", async () => {
    const fetch = vi.fn(async () => "v1");
    wrap(<Writer run={async () => Promise.reject(new Error("nope"))} invalidates={[["thing"]]} fetch={fetch} />);

    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));
    await userEvent.click(screen.getByRole("button", { name: "write" }));

    await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("error"));
    expect(screen.getByTestId("merror")).toHaveTextContent("nope");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reset() clears a failure back to idle without remounting the form", async () => {
    wrap(<Writer run={async () => Promise.reject(new Error("nope"))} fetch={async () => "v1"} />);
    await userEvent.click(screen.getByRole("button", { name: "write" }));
    await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("error"));

    await userEvent.click(screen.getByRole("button", { name: "reset" }));
    await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("idle"));
    expect(screen.getByTestId("merror")).toHaveTextContent("-");
  });

  /**
   * The fire-and-forget form (`void m.mutate(...)`, which `Writer` above uses
   * deliberately without a local `.catch`) must still land the failure in
   * `status`/`error` as documented.
   */
  it("the fire-and-forget form still reports the failure through status and error", async () => {
    wrap(<Writer run={async () => Promise.reject(new Error("boom"))} fetch={async () => "v1"} />);
    await userEvent.click(screen.getByRole("button", { name: "write" }));
    await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("error"));
    expect(screen.getByTestId("merror")).toHaveTextContent("boom");
  });

  /**
   * Regression — external review, 2026-08-01/02. `mutate()`'s documented
   * fire-and-forget usage (`void m.mutate(...)`, no local `.catch`, exactly
   * what `Writer` above does) must not raise `unhandledrejection`.
   *
   * An earlier version of this test was written and deleted on the claim that
   * "neither jsdom's `window` event nor Node's `process` hook fires under this
   * runner." That claim was half right: jsdom's `window` `unhandledrejection`
   * event genuinely does not fire under vitest+jsdom. But Node's own
   * `process.on('unhandledRejection', ...)` hook DOES fire here, and it
   * cleanly discriminates the bug from the fix — reverting `adapter.tsx`'s
   * `call` to the pre-fix `useCallback((input) => mutateAsync(input), ...)`
   * (bare, no handler attached) makes this test fail.
   *
   * `process.on`/`process.off` are paired in a `finally` so a failing
   * assertion still removes the listener rather than leaking it into a later
   * test in the same worker.
   */
  it("the fire-and-forget form does not raise a process-level unhandledRejection", async () => {
    const reasons: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => reasons.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      wrap(<Writer run={async () => Promise.reject(new Error("boom"))} fetch={async () => "v1"} />);
      await userEvent.click(screen.getByRole("button", { name: "write" }));
      await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("error"));

      // `unhandledRejection` fires on a LATER turn of the event loop than the
      // rejection itself — only once Node has confirmed no handler was ever
      // attached — so the assertion above resolving is not sufficient; give
      // the loop room to report it before checking `reasons`.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(reasons).toEqual([]);
  });

  /**
   * Coverage-gap-fill (2026-09-05). Every prior `onSuccess` in this describe block passed
   * `invalidates`, so `for (const key of invalidates ?? [])`'s `?? []` fallback (a caller that wants
   * a write with no cache invalidation at all — a real, documented usage per `FetchMutationOptions`
   * making `invalidates` optional) had never run.
   */
  it("a successful write with no invalidates option configured triggers no invalidation and does not throw", async () => {
    const fetch = vi.fn(async () => "v1");
    wrap(<Writer run={async () => "ok"} fetch={fetch} />);

    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));
    await userEvent.click(screen.getByRole("button", { name: "write" }));

    await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("success"));
    // No second fetch — nothing was invalidated, so the query never refetched.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  /**
   * Coverage-gap-fill (2026-09-05). No test in this file ever asserted `m.status === "pending"`
   * directly, so the status derivation's `mutation.status === "pending" ? "pending" : ...` ternary
   * (adapter.tanstack.tsx) had only ever taken its `false` branch. A deferred `run` holds the write
   * open long enough to observe the in-flight render.
   */
  it("reports status 'pending' while the write is in flight, before it settles either way", async () => {
    const pending = deferred<string>();
    wrap(<Writer run={() => pending.promise} fetch={async () => "v1"} />);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));

    await userEvent.click(screen.getByRole("button", { name: "write" }));
    await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("pending"));

    pending.resolve("done");
    await waitFor(() => expect(screen.getByTestId("mstatus")).toHaveTextContent("success"));
  });

  it("mutate() rejects, so a caller that needs the outcome can await it inline", async () => {
    const seen: string[] = [];
    function Inline() {
      const m = useFetchMutation({ run: async () => Promise.reject(new Error("boom")) });
      return (
        <button
          type="button"
          onClick={async () => {
            try {
              await m.mutate({ input: undefined as never });
              seen.push("resolved");
            } catch (e) {
              seen.push(`caught:${(e as Error).message}`);
            }
          }}
        >
          go
        </button>
      );
    }
    wrap(<Inline />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(seen).toEqual(["caught:boom"]));
  });
});

/**
 * Prefix matching is a contract term, not an implementation detail — see
 * `QueryKey`'s doc. Found by tracing a real delete on the pilot screen, where
 * invalidating `['redirects']` also refetched `['redirects', id, 'hits']`. A
 * replacement adapter doing exact-key equality would compile and quietly stop
 * refreshing derived data, so it is pinned here rather than left to be
 * rediscovered.
 */
describe("invalidation matching", () => {
  it("invalidating a parent key also refreshes keys nested under it", async () => {
    let listV = 0;
    let childV = 0;
    const listFetch = vi.fn(async () => `list${++listV}`);
    const childFetch = vi.fn(async () => `child${++childV}`);

    function Both() {
      const list = useFetchQuery({ key: ["redirects"], fetch: listFetch });
      const child = useFetchQuery({ key: ["redirects", "abc", "hits"], fetch: childFetch });
      const invalidate = useInvalidate();
      return (
        <div>
          <span data-testid="list">{list.data ?? "-"}</span>
          <span data-testid="child">{child.data ?? "-"}</span>
          <button type="button" onClick={() => invalidate({ key: ["redirects"] })}>
            push
          </button>
        </div>
      );
    }
    wrap(<Both />);
    await waitFor(() => expect(screen.getByTestId("child")).toHaveTextContent("child1"));

    await userEvent.click(screen.getByRole("button", { name: "push" }));
    await waitFor(() => expect(screen.getByTestId("list")).toHaveTextContent("list2"));
    await waitFor(() => expect(screen.getByTestId("child")).toHaveTextContent("child2"));
  });

  it("does NOT invalidate a sibling key that merely shares no prefix", async () => {
    let otherV = 0;
    const otherFetch = vi.fn(async () => `other${++otherV}`);

    let sentinelV = 0;
    const sentinelFetch = vi.fn(async () => `sentinel${++sentinelV}`);
    function Siblings() {
      const other = useFetchQuery({ key: ["forms"], fetch: otherFetch });
      const sentinel = useFetchQuery({ key: ["redirects"], fetch: sentinelFetch });
      const invalidate = useInvalidate();
      return (
        <div>
          <span data-testid="other">{other.data ?? "-"}</span>
          <span data-testid="sentinel">{sentinel.data ?? "-"}</span>
          <button type="button" onClick={() => invalidate({ key: ["redirects"] })}>
            push
          </button>
        </div>
      );
    }
    wrap(<Siblings />);
    await waitFor(() => expect(screen.getByTestId("other")).toHaveTextContent("other1"));

    await userEvent.click(screen.getByRole("button", { name: "push" }));
    await waitFor(() => expect(screen.getByTestId("sentinel")).toHaveTextContent("sentinel2"));
    expect(otherFetch).toHaveBeenCalledTimes(1);
  });
});

describe("useInvalidate", () => {
  it("refetches a key on demand — the seam the SSE change feed pushes into", async () => {
    let version = 0;
    const fetch = vi.fn(async () => `v${++version}`);
    function External() {
      const q = useFetchQuery({ key: ["thing"], fetch });
      const invalidate = useInvalidate();
      return (
        <div>
          <span data-testid="data">{q.data ?? "-"}</span>
          <button type="button" onClick={() => invalidate({ key: ["thing"] })}>
            push
          </button>
        </div>
      );
    }
    wrap(<External />);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));

    await userEvent.click(screen.getByRole("button", { name: "push" }));
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v2"));
  });
});

describe("useCachedLoader", () => {
  const KEY = ["loader-thing"] as const;

  function renderLoader(fetch: () => Promise<string>, staleTime?: number) {
    return renderHook(() => useCachedLoader({ key: KEY, fetch }, { ...(staleTime === undefined ? {} : { staleTime }) }), {
      wrapper: FetchQueryProvider,
    });
  }

  it("shares one in-flight request between concurrent loads and serves the next from cache", async () => {
    const gate = deferred<string>();
    const fetch = vi.fn(() => gate.promise);
    const { result } = renderLoader(fetch, Infinity);

    const first = result.current.load();
    const second = result.current.load();
    gate.resolve("v1");

    await expect(Promise.all([first, second])).resolves.toEqual(["v1", "v1"]);
    await expect(result.current.load()).resolves.toBe("v1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("peek() is undefined before a load and the value after", async () => {
    const { result } = renderLoader(async () => "v1", Infinity);

    expect(result.current.peek()).toBeUndefined();
    await result.current.load();
    expect(result.current.peek()).toBe("v1");
  });

  it("a rejected load is not cached — the next load calls fetch again", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("v1");
    const { result } = renderLoader(fetch, Infinity);

    await expect(result.current.load()).rejects.toThrow("down");
    await expect(result.current.load()).resolves.toBe("v1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("replace() overwrites what the next load resolves, without a fetch", async () => {
    const fetch = vi.fn(async () => "v1");
    const { result } = renderLoader(fetch, Infinity);

    await result.current.load();
    result.current.replace({ value: "v2" });

    await expect(result.current.load()).resolves.toBe("v2");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a replace() made while a load is in flight is not overwritten when that load's older answer lands", async () => {
    const gate = deferred<string>();
    const { result } = renderLoader(() => gate.promise, Infinity);

    const inFlight = result.current.load();
    result.current.replace({ value: "v2" });
    gate.resolve("v1");

    await expect(inFlight).resolves.toBe("v2");
    expect(result.current.peek()).toBe("v2");
  });

  it("keeps an unobserved value past the cache's default 5-minute idle eviction when staleTime says it is fresh", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => "v1");
      const { result } = renderLoader(fetch, Infinity);
      await result.current.load();

      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(result.current.peek()).toBe("v1");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
