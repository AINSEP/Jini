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
  it("with a synchronous seed, the first render already shows the stored choices and the read is never repeated", () => {
    const load = vi.fn(async () => undefined);
    const seed = vi.fn(() => ({ sort: "name", pinned: ["a"], hidden: ["b"] }));
    const { result, rerender } = renderHook(() => useSiteListPrefs({ port: { load, save: vi.fn() } }, { seed }));
    expect(result.current.ready).toBe(true);
    expect(result.current.prefs).toEqual({ sort: "name", pinned: ["a"], hidden: ["b"] });
    rerender();
    expect(seed).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("a seed with nothing stored gives the defaults themselves", () => {
    const { result } = renderHook(() => useSiteListPrefs({ port: { load: vi.fn(), save: vi.fn() } }, { seed: () => null }));
    expect(result.current.prefs).toBe(DEFAULT_SITE_LIST_PREFS);
  });

  it("denied storage on the first render gives the defaults, not a crash, and a change still applies for this session", async () => {
    const save = vi.fn<SiteListPrefsPort["save"]>();
    const seed = () => { throw new Error("storage denied"); };
    const { result } = renderHook(() => useSiteListPrefs({ port: { load: vi.fn(), save } }, { seed }));
    expect(result.current.prefs).toBe(DEFAULT_SITE_LIST_PREFS);
    expect(result.current.ready).toBe(true);
    expect(result.current.loadError).toContain("storage denied");
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "name" }));
    expect(result.current.prefs.sort).toBe("name");
    await act(async () => { await Promise.resolve(); });
    expect(save).not.toHaveBeenCalled();
  });

  it("with no save in flight a change reaches the store in the same turn, so a synchronous store is written at once", () => {
    const writes: string[] = [];
    const save: SiteListPrefsPort["save"] = async ({ next }) => { writes.push(next.sort); };
    const { result } = renderHook(() => useSiteListPrefs({ port: { load: vi.fn(), save } }, { seed: () => null }));
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "name" }));
    expect(writes).toEqual(["name"]);
  });

  it("a store that throws instead of rejecting is still reported as a failed save", async () => {
    const save: SiteListPrefsPort["save"] = () => { throw new Error("quota"); };
    const { result } = renderHook(() => useSiteListPrefs({ port: { load: vi.fn(), save } }, { seed: () => null }));
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "name" }));
    await waitFor(() => expect(result.current.saveError).toContain("quota"));
    expect(result.current.prefs.sort).toBe("name");
  });
  it("a store that saves synchronously gets back-to-back changes at once, in order, with no promise to wait on", () => {
    const writes: string[] = [];
    const save: SiteListPrefsPort["save"] = ({ next }) => { writes.push(next.sort); };
    const { result } = renderHook(() => useSiteListPrefs({ port: { load: vi.fn(), save } }, { seed: () => null }));
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "name" }));
    act(() => result.current.onPrefsChange({ ...DEFAULT_SITE_LIST_PREFS, sort: "oldest" }));
    expect(writes).toEqual(["name", "oldest"]);
    expect(result.current.saveError).toBeNull();
  });
});
