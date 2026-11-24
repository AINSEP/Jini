// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSitesSnapshot } from "@jini-ai/core/contracts/site/admin-sites";
import { publishContentRefresh, resetContentRefreshBus } from "../../../shell/lib/content-refresh-bus.js";
import { AdminBootScopeContext } from "../../../shell/lib/admin-boot-scope.js";
import { useSitesSnapshot, type SitesListingScope } from "../use-sites-snapshot.hooks.js";

/**
 * @file The shared Sites read: the host's list key scoped by principal, a disabled or still-checking
 * boot reads nothing, and a content-refresh notice for the host's resource (or for everything)
 * refetches while one for another resource does not.
 */

const listing: SitesListingScope = { listKey: ["sites", "list"], resource: "sites" };
function snapshot(): AdminSitesSnapshot {
  return { sites: [], switchingEnabled: true, persistedSiteName: null,
    currentSite: { name: "owner", dir: "/sites/owner", listed: true, dirOverridden: false } };
}
function bootScope({ principalId, checking }: { principalId: string | null; checking: boolean }) {
  return ({ children }: { children: ReactNode }) => createElement(AdminBootScopeContext.Provider, { value: { principalId, checking } }, children);
}

afterEach(() => resetContentRefreshBus());

describe("useSitesSnapshot", () => {
  it("reads the list once and refetches on a refresh naming the host's resource or naming nothing", async () => {
    const listSites = vi.fn(async () => snapshot());
    const { result, unmount } = renderHook(() => useSitesSnapshot({ port: { listSites }, listing }));
    await waitFor(() => expect(result.current.data?.currentSite.name).toBe("owner"));
    expect(listSites).toHaveBeenCalledTimes(1);
    act(() => publishContentRefresh({ resources: ["posts"] }));
    await act(async () => { await Promise.resolve(); });
    expect(listSites).toHaveBeenCalledTimes(1);
    act(() => publishContentRefresh({ resources: ["sites"] }));
    await waitFor(() => expect(listSites).toHaveBeenCalledTimes(2));
    act(() => publishContentRefresh());
    await waitFor(() => expect(listSites).toHaveBeenCalledTimes(3));
    unmount();
  });

  it("reads nothing while disabled or while the boot scope is still checking", async () => {
    const listSites = vi.fn(async () => snapshot());
    const disabled = renderHook(() => useSitesSnapshot({ port: { listSites }, listing }, { enabled: false }));
    const checking = renderHook(() => useSitesSnapshot({ port: { listSites }, listing }), { wrapper: bootScope({ principalId: "p1", checking: true }) });
    await act(async () => { await Promise.resolve(); });
    expect(listSites).not.toHaveBeenCalled();
    expect(disabled.result.current.data).toBeUndefined();
    expect(checking.result.current.data).toBeUndefined();
    disabled.unmount(); checking.unmount();
  });

  it("keys the read by the explicit principal, so two principals never share one cached list", async () => {
    let calls = 0;
    const listSites = vi.fn(async () => ({ ...snapshot(), persistedSiteName: `read-${++calls}` }));
    const { result, rerender } = renderHook(({ principalId }: { principalId: string }) =>
      useSitesSnapshot({ port: { listSites }, listing }, { principalId }), { initialProps: { principalId: "a" } });
    await waitFor(() => expect(result.current.data?.persistedSiteName).toBe("read-1"));
    rerender({ principalId: "b" });
    await waitFor(() => expect(result.current.data?.persistedSiteName).toBe("read-2"));
    expect(listSites).toHaveBeenCalledTimes(2);
  });
});
