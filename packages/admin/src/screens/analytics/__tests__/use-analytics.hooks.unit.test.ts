// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFetchQuery } from "../../../react/kit.js";
import { useAnalytics } from "../hooks/use-analytics.hooks.js";
import { createFakeAnalyticsPort } from "../hooks/analytics-dependencies.hooks.js";

/**
 * @file `useAnalytics` — the Analytics screen's one fetch-on-mount effect, extracted verbatim from
 * `Analytics.tsx`. Pins the exact error strings (moved verbatim during extraction) and the
 * null-until-loaded contract `Analytics.tsx` branches its loading state on.
 *
 * Only the injected-port half lives here: the pure `useAnalytics({ port, t })` against
 * `createFakeAnalyticsPort`, no `fetch` stub at all — see `analytics-port.hooks.ts` for why the
 * injection exists. The `useWiredAnalytics()` suites (real request client, real admin-locale hook)
 * stay with the host, which owns both of those bindings.
 *
 * `t` (2026-08-11, standing i18n rule — see `use-analytics.hooks.ts`'s own file header): every
 * `useAnalytics({ port, ... })` call below passes `fakeT`, the identity function, matching
 * `wired-hooks-convention.md`'s own `t: (k) => k` example — except the dedicated "injected t is
 * genuinely returned" group, which uses a distinctive fake to prove the value is not built
 * internally.
 */

/** Identity translator for tests that don't care about `t`'s own behavior — see this file's header. */
const fakeT = ({ key }: { key: string }, _optional = {}): string => key;

const HIT = {
  occurredAt: "2026-08-01T00:00:00.000Z",
  kind: "pageview" as const,
  path: "/",
  referrerHost: null,
  deviceClass: "desktop" as const,
  browserFamily: "Chrome",
  eventName: null,
};

describe("useAnalytics — injected port", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves hits from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeAnalyticsPort({ hits: [HIT] });
    const { result } = renderHook(() => useAnalytics({ port, t: fakeT }));

    await waitFor(() => expect(result.current.hits).toEqual([HIT]));
    expect(result.current.error).toBeNull();
    // Proves the injection actually took — a hook that still reached `api` internally would have
    // hit this stub and made the assertion above fail differently (unresolved hits), but this is
    // the direct proof: the network was never touched at all.
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("starts with hits=null, error=null before the port settles", () => {
    const port = { ...createFakeAnalyticsPort(), listRecentAnalyticsHits: () => new Promise<never>(() => {}) };
    const { result } = renderHook(() => useAnalytics({ port, t: fakeT }));
    expect(result.current.hits).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces a rejected port call's message on the error channel", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeAnalyticsPort();
    port.listRecentAnalyticsHits = () => Promise.reject(new Error("hits table locked"));
    const { result } = renderHook(() => useAnalytics({ port, t: fakeT }));

    await waitFor(() => expect(result.current.error).toBe("hits table locked"));
    expect(result.current.hits).toBeNull();
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("falls back to the exact string 'failed to load recent hits' when the rejection is not an Error", async () => {
    const port = { ...createFakeAnalyticsPort(), listRecentAnalyticsHits: () => Promise.reject("network exploded") };
    const { result } = renderHook(() => useAnalytics({ port, t: fakeT }));
    await waitFor(() => expect(result.current.error).toBe("failed to load recent hits"));
  });
});

describe("useAnalytics — injected t is genuinely returned, not built internally", () => {
  /**
   * Standing i18n rule (2026-08-11, `Analytics.tsx` no longer imports `useAdminLocale`/
   * `analytics-i18n` itself): `t` must come from the hook's injected arguments, not something
   * this hook quietly rebuilds from a dictionary it reaches for on its own. A DISTINCTIVE fake (not
   * the identity `fakeT` every other test in this file uses) proves the returned `t` is literally
   * the same function reference passed in — an identity `t` would pass this same assertion even if
   * the hook silently ignored its `t` argument and returned its own `(k) => k`. Mirrors
   * `use-post-editor.hooks.unit.test.tsx`'s identical negative-verification group.
   */
  it("result.current.t is exactly the injected function, not a hook-internal one", async () => {
    const port = createFakeAnalyticsPort({ hits: [HIT] });
    const distinctiveT = ({ key }: { key: string }, _optional = {}): string => `TRANSLATED[${key}]`;

    const { result } = renderHook(() => useAnalytics({ port, t: distinctiveT }));

    await waitFor(() => expect(result.current.hits).toEqual([HIT]));
    expect(result.current.t({ key: "Analytics" })).toBe("TRANSLATED[Analytics]");
    expect(result.current.t).toBe(distinctiveT);
  });
});

describe("analytics query ownership", () => {
  it("shares one in-flight read between two consumers", async () => {
    let complete!: (value: { hits: typeof HIT[] }) => void;
    const read = vi.fn(() => new Promise<{ hits: typeof HIT[] }>(resolve => { complete = resolve; }));
    const port = { ...createFakeAnalyticsPort(), listRecentAnalyticsHits: read };
    const { result } = renderHook(() => ({ first: useAnalytics({ port, t: fakeT }), second: useAnalytics({ port, t: fakeT }) }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await act(async () => { complete({ hits: [HIT] }); });
    await waitFor(() => {
      expect(result.current.first.hits).toEqual([HIT]);
      expect(result.current.second.hits).toEqual([HIT]);
    });
  });
});

it.each([new Error("adapter canary"), { rejected: "adapter canary" }])("keeps adapter rejection ownership: %s", async cause => {
  const port = createFakeAnalyticsPort();
  vi.spyOn(port, "listRecentAnalyticsHits").mockRejectedValue(cause);
  const { result } = renderHook(() => {
    useAnalytics({ port, t: fakeT });
    return useFetchQuery({ key: ["analytics", "recent-hits"], fetch: async () => { throw new Error("observer must join the active read"); } }, { staleTime: 0 });
  });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  if (cause instanceof Error) expect(result.current.error).toBe(cause);
  else expect(result.current.error).toMatchObject({ message: "failed to load recent hits", cause });
});
