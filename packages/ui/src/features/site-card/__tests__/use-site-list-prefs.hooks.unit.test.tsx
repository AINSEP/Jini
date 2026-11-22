import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_LIST_PREFS } from "../site-list-view.js";
import { useSiteListPrefs, type SiteListPrefsPort } from "../use-site-list-prefs.hooks.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

async function ready(port: SiteListPrefsPort) {
  const view = renderHook(() => useSiteListPrefs({ port }));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

describe("useSiteListPrefs", () => {
  it("is not ready until the stored choices arrive, then reads them", async () => {
    const port: SiteListPrefsPort = { load: async () => ({ sort: "oldest", pinned: ["a"], hidden: [] }), save: vi.fn() };
    const { result } = renderHook(() => useSiteListPrefs({ port }));
    expect(result.current.ready).toBe(false);
    expect(result.current.prefs).toEqual(DEFAULT_SITE_LIST_PREFS);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.prefs).toEqual({ sort: "oldest", pinned: ["a"], hidden: [] });
  });

  it("applies a change at once and saves each one in order, the second waiting for the first", async () => {
    const first = deferred();
    const saved: string[] = [];
    const save = vi.fn(async ({ next }: { next: { sort: string } }) => { if (saved.length === 0) { saved.push("first-started"); await first.promise; } saved.push(next.sort); });
    const { result } = await ready({ load: async () => undefined, save });
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "oldest" }));
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "name" }));
    expect(result.current.prefs.sort).toBe("name");
    await waitFor(() => expect(saved).toEqual(["first-started"]));
    await act(async () => { first.resolve(); await first.promise; });
    await waitFor(() => expect(saved).toEqual(["first-started", "oldest", "name"]));
  });

  it("keeps the server's reason when a save fails, keeps the choice, and clears the reason on the next good save", async () => {
    const save = vi.fn<SiteListPrefsPort["save"]>().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const { result } = await ready({ load: async () => undefined, save });
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "name" }));
    await waitFor(() => expect(result.current.saveError).toContain("disk full"));
    expect(result.current.prefs.sort).toBe("name");
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "oldest" }));
    await waitFor(() => expect(result.current.saveError).toBeNull());
  });

  it("never saves after a failed read, so the defaults on screen cannot overwrite the real choices", async () => {
    const save = vi.fn<SiteListPrefsPort["save"]>();
    const { result } = await ready({ load: async () => { throw new Error("offline"); }, save });
    expect(result.current.loadError).toContain("offline");
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "name" }));
    expect(result.current.prefs.sort).toBe("name");
    await act(async () => { await Promise.resolve(); });
    expect(save).not.toHaveBeenCalled();
  });
});
