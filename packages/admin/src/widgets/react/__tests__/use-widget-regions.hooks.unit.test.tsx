import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type AdminWidgetRegionBinding } from "./fixtures/api.js";
import { publishContentRefresh, resetContentRefreshBus } from "./fixtures/events.js";
import { createFakeWidgetRegionsPort } from "./fixtures/memory.js";
import { useWidgetRegions } from "./fixtures/use-widget-regions.js";
import { WIDGETS_REGIONS_RESOURCE } from "./fixtures/rules.js";

/**
 * @file `useWidgetRegions` driven against the injected `WidgetRegionsPort`, no `fetch` stub and no
 * `vi.spyOn(api, ...)`. `WidgetRegions.unit.test.tsx` covers the component's own rendering entirely
 * through a full-controller fake on `useWidgetRegionsHook` (never the real hook), so this is the
 * first test to exercise `useWidgetRegions` itself.
 */

const REGION: AdminWidgetRegionBinding = { workspaceId: "ws1", regionKey: "footer", areaEntryId: "area-1", updatedAt: "2026-08-01T00:00:00.000Z", placementCount: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWidgetRegions — injected port (no fetch stub, no api spy)", () => {
  it("loads the list from the injected port and never touches the real api client", async () => {
    const listSpy = vi.spyOn(api, "listWidgetRegions");
    const port = createFakeWidgetRegionsPort({ regions: [REGION] });
    const { result } = renderHook(() => useWidgetRegions({ port, locale: "en", navigate: vi.fn(), t: (key: string) => key }));

    await waitFor(() => expect(result.current.regions).toEqual([REGION]));
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("routes bind through the injected port and calls the injected navigate, never the real router", async () => {
    const bindSpy = vi.spyOn(api, "bindWidgetRegion");
    const port = createFakeWidgetRegionsPort();
    const fakeNavigate = vi.fn();
    const { result } = renderHook(() => useWidgetRegions({ port, locale: "en", navigate: fakeNavigate, t: (key: string) => key }));
    await waitFor(() => expect(result.current.regions).toEqual([]));

    act(() => result.current.setNewRegionKey("sidebar"));
    await act(async () => {
      await result.current.bind();
    });

    expect(port.regions).toHaveLength(1);
    expect(port.regions[0]?.regionKey).toBe("sidebar");
    expect(fakeNavigate).toHaveBeenCalledWith("/widgets/regions/sidebar");
    expect(bindSpy).not.toHaveBeenCalled();
  });

  /**
   * Negative verification (per this refactor's own required check): temporarily replacing
   * `port.listWidgetRegions(...)`/`port.bindWidgetRegion(...)`/`navigate(...)` in
   * `use-widget-regions.hooks.ts` with direct calls to the real `api`/`lib/router` imports and
   * re-running this suite fails both tests above (no real network in this test env, and the real
   * router's `navigate` — not `fakeNavigate` — is what would receive the call) — see this feature's
   * commit/handoff report for the recorded run.
   */
  it("does not resolve `regions` while the injected port's list call is still pending", () => {
    const port = createFakeWidgetRegionsPort();
    port.listWidgetRegions = () => new Promise(() => {});
    const { result } = renderHook(() => useWidgetRegions({ port, locale: "en", navigate: vi.fn(), t: (key: string) => key }));
    expect(result.current.regions).toBeNull();
  });
});

describe("useWidgetRegions — content refresh bus", () => {
  afterEach(() => resetContentRefreshBus());

  it("re-reads the regions when a content refresh fires, so an assistant-bound region appears without a reload", async () => {
    const port = createFakeWidgetRegionsPort({ regions: [REGION] });
    const { result } = renderHook(() => useWidgetRegions({ port, locale: "en", navigate: vi.fn(), t: (key: string) => key }));
    await waitFor(() => expect(result.current.regions).toEqual([REGION]));

    // The assistant's `widgets_bind_region` call landing server-side — the screen has no other way
    // to know it happened.
    port.regions.push({ ...REGION, regionKey: "sidebar", areaEntryId: "area-2" });
    expect(result.current.regions).toEqual([REGION]);

    act(() => publishContentRefresh());

    await waitFor(() => expect(result.current.regions).toHaveLength(2));
  });

  it("refreshes on a notification that names widgets-regions, and ignores one that names only other resources", async () => {
    const port = createFakeWidgetRegionsPort({ regions: [REGION] });
    const { result } = renderHook(() => useWidgetRegions({ port, locale: "en", navigate: vi.fn(), t: (key: string) => key }));
    await waitFor(() => expect(result.current.regions).toEqual([REGION]));

    port.regions.push({ ...REGION, regionKey: "sidebar", areaEntryId: "area-2" });

    act(() => publishContentRefresh(["taxonomy"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.regions).toEqual([REGION]);

    act(() => publishContentRefresh([WIDGETS_REGIONS_RESOURCE]));
    await waitFor(() => expect(result.current.regions).toHaveLength(2));
  });

  it("stops re-reading once unmounted", async () => {
    const port = createFakeWidgetRegionsPort({ regions: [REGION] });
    const listSpy = vi.spyOn(port, "listWidgetRegions");
    const { result, unmount } = renderHook(() => useWidgetRegions({ port, locale: "en", navigate: vi.fn(), t: (key: string) => key }));
    await waitFor(() => expect(result.current.regions).toEqual([REGION]));

    const callsWhileMounted = listSpy.mock.calls.length;
    unmount();
    act(() => publishContentRefresh());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listSpy).toHaveBeenCalledTimes(callsWhileMounted);
  });

  it("does not let a slower, earlier-triggered refresh overwrite a newer one that already settled (out-of-order response race)", async () => {
    const port = createFakeWidgetRegionsPort({ regions: [REGION] });
    const { result } = renderHook(() => useWidgetRegions({ port, locale: "en", navigate: vi.fn(), t: (key: string) => key }));
    await waitFor(() => expect(result.current.regions).toEqual([REGION]));

    // Two assistant writes land back to back, each publishing its own content-refresh
    // notification — two overlapping `listWidgetRegions()` calls with no ordering guarantee on responses.
    let resolveFirst!: (v: { regions: AdminWidgetRegionBinding[] }) => void;
    let resolveSecond!: (v: { regions: AdminWidgetRegionBinding[] }) => void;
    vi.spyOn(port, "listWidgetRegions")
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));

    act(() => {
      publishContentRefresh();
      publishContentRefresh();
    });

    // The SECOND (more recent) request settles first, with the newer list.
    const sidebar = { ...REGION, regionKey: "sidebar", areaEntryId: "area-2" };
    await act(async () => {
      resolveSecond({ regions: [REGION, sidebar] });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.regions).toEqual([REGION, sidebar]));

    // The FIRST (now-stale) request finally settles. It must not resurrect the older list.
    await act(async () => {
      resolveFirst({ regions: [REGION] });
      await Promise.resolve();
    });
    expect(result.current.regions).toEqual([REGION, sidebar]);
  });
});
