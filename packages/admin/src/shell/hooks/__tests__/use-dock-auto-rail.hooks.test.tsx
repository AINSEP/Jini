// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../../react/index.js";

import {
  DOCK_AUTO_RAIL_QUERY,
  shouldAutoRail,
  useDockAutoRail,
  type AutoRailMediaQuery,
} from "../use-dock-auto-rail.hooks.js";

/**
 * @file Opening the dock in a window too narrow for the expanded nav + dock supplies a controlled
 * rail override; closing it (or leaving the band) releases it to Jini's stored preference. A fake
 * MediaQueryList drives transitions; the integration case uses the real Sidebar to verify manual
 * expansion and restoration without any synthetic storage events or preference writes.
 */

const KEY = "host-admin-sidebar-rail-collapsed";

/** A MediaQueryList whose `matches` the test flips, firing `change` like the browser does. */
function fakeBand(initial: boolean) {
  const listeners = new Set<() => void>();
  const band: AutoRailMediaQuery & { set(next: boolean): void; listenerCount(): number } = {
    matches: initial,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    set(next) {
      (band as { matches: boolean }).matches = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
  return band;
}

function setup(options: { narrow: boolean; dockOpen: boolean }) {
  const band = fakeBand(options.narrow);
  const queries: string[] = [];
  const matchMedia = ({ query }: { query: string }) => {
    queries.push(query);
    return band;
  };
  const hook = renderHook((props: { dockOpen: boolean }) =>
    useDockAutoRail({ dockOpen: props.dockOpen }, { matchMedia }),
  { initialProps: { dockOpen: options.dockOpen } });
  return { band, queries, hook };
}

describe("shouldAutoRail", () => {
  it("folds only when the dock is open AND the window is in the band", () => {
    expect(shouldAutoRail({ dockOpen: true, narrow: true })).toBe(true);
    expect(shouldAutoRail({ dockOpen: true, narrow: false })).toBe(false);
    expect(shouldAutoRail({ dockOpen: false, narrow: true })).toBe(false);
    expect(shouldAutoRail({ dockOpen: false, narrow: false })).toBe(false);
  });
});

describe("useDockAutoRail", () => {
  it("queries the 901px–1172px band (the expanded nav + dock + padding + 480px page)", () => {
    const { queries, hook } = setup({ narrow: false, dockOpen: false });
    expect(queries).toEqual([DOCK_AUTO_RAIL_QUERY]);
    expect(DOCK_AUTO_RAIL_QUERY).toBe("(min-width: 901px) and (max-width: 1171.98px)");
    expect(hook.result.current.railOverride).toBeNull();
  });

  it("supplies an override when the dock opens and releases it on close", () => {
    const { hook } = setup({ narrow: true, dockOpen: false });
    expect(hook.result.current.railOverride).toBeNull();
    hook.rerender({ dockOpen: true });
    expect(hook.result.current.railOverride).toBe(true);
    hook.rerender({ dockOpen: false });
    expect(hook.result.current.railOverride).toBeNull();
  });

  it("leaves a wide window alone when the dock opens and closes", () => {
    const { hook } = setup({ narrow: false, dockOpen: false });
    hook.rerender({ dockOpen: true });
    expect(hook.result.current.railOverride).toBeNull();
    hook.rerender({ dockOpen: false });
    expect(hook.result.current.railOverride).toBeNull();
  });

  it("follows the window crossing the band while the dock stays open", () => {
    const { hook, band } = setup({ narrow: false, dockOpen: true });
    expect(hook.result.current.railOverride).toBeNull();
    act(() => band.set(true));
    expect(hook.result.current.railOverride).toBe(true);
    act(() => band.set(false));
    expect(hook.result.current.railOverride).toBeNull();
  });

  it("keeps manual expansion through re-renders and repeated media events, then resets on re-entry", () => {
    const { hook, band } = setup({ narrow: true, dockOpen: true });
    act(() => hook.result.current.onRailCollapsedChange(false));
    expect(hook.result.current.railOverride).toBe(false);
    hook.rerender({ dockOpen: true });
    act(() => band.set(true));
    expect(hook.result.current.railOverride).toBe(false);
    act(() => band.set(false));
    expect(hook.result.current.railOverride).toBeNull();
    act(() => band.set(true));
    expect(hook.result.current.railOverride).toBe(true);
  });

  it("accepts manual re-collapse and resets manual expansion on the next dock opening", () => {
    const { hook } = setup({ narrow: true, dockOpen: true });
    act(() => hook.result.current.onRailCollapsedChange(false));
    expect(hook.result.current.railOverride).toBe(false);
    act(() => hook.result.current.onRailCollapsedChange(true));
    expect(hook.result.current.railOverride).toBe(true);
    act(() => hook.result.current.onRailCollapsedChange(false));
    hook.rerender({ dockOpen: false });
    expect(hook.result.current.railOverride).toBeNull();
    hook.rerender({ dockOpen: true });
    expect(hook.result.current.railOverride).toBe(true);
  });

  it("does nothing when the band changes or a stale toggle request arrives while the dock is closed", () => {
    const { hook, band } = setup({ narrow: false, dockOpen: false });
    act(() => band.set(true));
    act(() => band.set(false));
    act(() => hook.result.current.onRailCollapsedChange(true));
    expect(hook.result.current.railOverride).toBeNull();
  });

  it("removes its change listener on unmount", () => {
    const { band, hook } = setup({ narrow: true, dockOpen: true });
    expect(hook.result.current.railOverride).toBe(true);
    expect(band.listenerCount()).toBe(1);
    hook.unmount();
    expect(band.listenerCount()).toBe(0);
  });

  it("never folds without matchMedia (an embed that lacks it)", () => {
    const { result } = renderHook(() => useDockAutoRail({ dockOpen: true }, { matchMedia: () => null }));
    expect(result.current.railOverride).toBeNull();
  });

  it("keeps the stored rail preference when the browser has no matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    try {
      const { result, rerender, unmount } = renderHook(({ dockOpen }) => useDockAutoRail({ dockOpen }), {
        initialProps: { dockOpen: true },
      });
      expect(result.current.railOverride).toBeNull();
      rerender({ dockOpen: false });
      expect(result.current.railOverride).toBeNull();
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores the real Sidebar's stored choice without storage events, including after a manual toggle", () => {
    const band = fakeBand(true);
    const matchMedia = () => band;
    const saved = localStorage.getItem(KEY);
    const seen: Event[] = [];
    const onStorage = (event: Event) => { seen.push(event); };
    window.addEventListener("storage", onStorage);
    // A stored collapsed preference makes manual expansion observable: release must restore it,
    // rather than accidentally persisting the temporary expanded override as the old workaround did.
    localStorage.setItem(KEY, "1");
    function Harness({ dockOpen }: { dockOpen: boolean }) {
      const rail = useDockAutoRail({ dockOpen }, { matchMedia });
      return <Sidebar activeId="posts" railStorageKey={KEY} {...rail}><Sidebar.RailToggle /></Sidebar>;
    }
    try {
      const { rerender } = render(<Harness dockOpen />);
      expect(screen.getByRole("navigation")).toHaveClass("is-rail");
      fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
      expect(screen.getByRole("navigation")).not.toHaveClass("is-rail");
      expect(localStorage.getItem(KEY)).toBe("1");
      rerender(<Harness dockOpen />);
      expect(screen.getByRole("navigation")).not.toHaveClass("is-rail");
      rerender(<Harness dockOpen={false} />);
      expect(screen.getByRole("navigation")).toHaveClass("is-rail");
      expect(localStorage.getItem(KEY)).toBe("1");
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener("storage", onStorage);
      if (saved === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, saved);
    }
  });
});

it("uses the native media query result and releases its listener when disposed", () => {
  const band = fakeBand(true);
  const matchMedia = vi.fn(() => band);
  vi.stubGlobal("matchMedia", matchMedia);
  try {
    const { result, unmount } = renderHook(() => useDockAutoRail({ dockOpen: true }));
    expect(matchMedia).toHaveBeenCalledExactlyOnceWith("(min-width: 901px) and (max-width: 1171.98px)");
    expect(result.current.railOverride).toBe(true);
    act(() => band.set(false));
    expect(result.current.railOverride).toBeNull();
    unmount();
    expect(band.listenerCount()).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});
