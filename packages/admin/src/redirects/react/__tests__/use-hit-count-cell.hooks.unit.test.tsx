import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { createFakeRedirectsPort } from "./legacy-harness.js";
import { useHitCountCell, useWiredHitCountCell } from "./legacy-harness.js";

/**
 * @file `useHitCountCell` (SPEC-037 REQ-03) — the lazy per-row hit-count read. The whole point of
 * this hook is that the port's `getRedirectHits` does NOT fire until `request()` is called; that
 * gate is the one thing worth pinning here, plus the "0 hits still renders" contract `data` vs
 * `hitCount` truthiness exists for.
 *
 * Goes through `useFetchQuery`, so every render needs a `FetchQueryProvider` — a fresh one per
 * test, matching `fetch-query.test.tsx`'s own convention (cold cache per test).
 *
 * `t` (2026-08-11, standing i18n rule — see `use-hit-count-cell.hooks.ts`'s own file header): every
 * call below passes `fakeT`, the identity function, matching `wired-hooks-convention.md`'s own
 * `t: (k) => k` example — except the dedicated "injected t is genuinely returned" group.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

/** Identity translator for tests that don't care about `t`'s own behavior — see this file's header. */
const fakeT = (key: string): string => key;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useHitCountCell", () => {
  it("does not fetch on mount — the query stays disabled until request() is called", () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useWiredHitCountCell({ redirectId: "r1", t: fakeT }), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once request() is called, and resolves with the hit stats", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { redirectId: "r1", workspaceId: "ws1", hitCount: 7, lastHitAt: "2026-08-01T00:00:00.000Z" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWiredHitCountCell({ redirectId: "r1", t: fakeT }), { wrapper });
    act(() => result.current.request());

    await waitFor(() => expect(result.current.data?.data.hitCount).toBe(7));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps two redirect requests and cached results separate under one provider", async () => {
    const stats = {
      r1: { redirectId: "r1", workspaceId: "ws1", hitCount: 7, lastHitAt: null },
      r2: { redirectId: "r2", workspaceId: "ws1", hitCount: 19, lastHitAt: "2026-08-02T00:00:00.000Z" },
    };
    const fetchMock = vi.fn(async (url: string) => {
      const match = String(url).match(/\/redirects\/(r[12])\/hits$/);
      if (!match) throw new Error(`unexpected request ${url}`);
      return jsonResponse({ data: stats[match[1] as keyof typeof stats] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => ({
      first: useWiredHitCountCell({ redirectId: "r1", t: fakeT }),
      second: useWiredHitCountCell({ redirectId: "r2", t: fakeT }),
    }), { wrapper });
    act(() => result.current.first.request());
    await waitFor(() => expect(result.current.first.data?.data).toEqual(stats.r1));
    expect(result.current.second.data).toBeUndefined();
    act(() => result.current.second.request());
    await waitFor(() => expect(result.current.second.data?.data).toEqual(stats.r2));
    expect(result.current.first.data?.data).toEqual(stats.r1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url).split("/redirects/")[1])).toEqual(["r1/hits", "r2/hits"]);
  });

  it("resolves data even for a rule with zero recorded hits — the caller must branch on data being present, not on hitCount's truthiness", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { redirectId: "r1", workspaceId: "ws1", hitCount: 0, lastHitAt: null } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWiredHitCountCell({ redirectId: "r1", t: fakeT }), { wrapper });
    act(() => result.current.request());

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.data.hitCount).toBe(0);
  });

  it("is fetching while the request is in flight, and settles once it resolves", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWiredHitCountCell({ redirectId: "r1", t: fakeT }), { wrapper });
    act(() => result.current.request());

    await waitFor(() => expect(result.current.isFetching).toBe(true));

    await act(async () => {
      resolveFetch(jsonResponse({ data: { redirectId: "r1", workspaceId: "ws1", hitCount: 3, lastHitAt: null } }));
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });

  it("surfaces a request failure as an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "hits route down" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWiredHitCountCell({ redirectId: "r1", t: fakeT }), { wrapper });
    act(() => result.current.request());

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("hits route down");
  });
});

describe("useHitCountCell — injected port (no fetch stub)", () => {
  it("stays lazy against the injected port too — request() is what triggers the read", async () => {
    let called = false;
    const port = createFakeRedirectsPort({ hits: { r1: { redirectId: "r1", workspaceId: "ws1", hitCount: 9, lastHitAt: null } } });
    const wrappedGetHits = port.getRedirectHits.bind(port);
    port.getRedirectHits = (id) => {
      called = true;
      return wrappedGetHits(id);
    };

    const { result } = renderHook(() => useHitCountCell({ redirectId: "r1" }, port, fakeT), { wrapper });
    expect(called).toBe(false);

    act(() => result.current.request());
    await waitFor(() => expect(result.current.data?.data.hitCount).toBe(9));
    expect(called).toBe(true);
  });

  /**
   * Negative verification: swap the seeded hit count and confirm the assertion tracks the port's
   * data, not a hardcoded expectation — proves this test is reading through the injection rather
   * than passing regardless of what the fake returns.
   */
  it("resolves whatever hitCount the injected port was seeded with", async () => {
    const port = createFakeRedirectsPort({ hits: { r1: { redirectId: "r1", workspaceId: "ws1", hitCount: 42, lastHitAt: null } } });
    const { result } = renderHook(() => useHitCountCell({ redirectId: "r1" }, port, fakeT), { wrapper });

    act(() => result.current.request());
    await waitFor(() => expect(result.current.data?.data.hitCount).toBe(42));
  });
});

describe("useHitCountCell — injected t is genuinely returned, not built internally", () => {
  /**
   * Standing i18n rule (2026-08-11, `HitCountCell` no longer imports `redirects-i18n` itself): `t`
   * must come from the hook's own third parameter, not something this hook quietly rebuilds
   * internally. A DISTINCTIVE fake (not the identity `fakeT` every other test in this file uses)
   * proves the returned `t` is literally the same function reference passed in. Mirrors
   * `use-post-editor.hooks.unit.test.tsx`'s identical negative-verification group.
   */
  it("result.current.t is exactly the injected function, not a hook-internal one", () => {
    const port = createFakeRedirectsPort();
    const distinctiveT = (key: string): string => `TRANSLATED[${key}]`;

    const { result } = renderHook(() => useHitCountCell({ redirectId: "r1" }, port, distinctiveT), { wrapper });

    expect(result.current.t("Load hits")).toBe("TRANSLATED[Load hits]");
    expect(result.current.t).toBe(distinctiveT);
  });
});
