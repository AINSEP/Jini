// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * @file Coverage for `useAdminAssistantSwitch` (0/2 funcs) — a thin `useSyncExternalStore` read
 * off the shared assistant-dock bus, with `setOpen` wired straight to `requestAssistantDock` (the
 * ASK side, not the state itself — see `assistant-dock-bus.ts`'s own header for why the two are
 * separate: only the host app shell, the dock's real owner, ever calls `publishAssistantDockState`).
 */

const { useSyncExternalStoreSpy } = vi.hoisted(() => ({ useSyncExternalStoreSpy: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // ESM named exports can't be `vi.spyOn`'d directly (not configurable) — wrapping the real
    // implementation here is the same capture technique, just done at mock-registration time.
    useSyncExternalStore: (...args: Parameters<typeof actual.useSyncExternalStore>) => {
      useSyncExternalStoreSpy(...args);
      return actual.useSyncExternalStore(...args);
    },
  };
});

const { publishAssistantDockState, resetAssistantDockBus, subscribeToAssistantDockRequests } = await import("../../../shell/lib/assistant-dock-bus.js");
const { useAdminAssistantSwitch } = await import("../use-admin-assistant-switch.hooks.js");

afterEach(() => {
  resetAssistantDockBus();
  useSyncExternalStoreSpy.mockClear();
});

describe("useAdminAssistantSwitch", () => {
  it("starts closed (the bus's initial state)", () => {
    const { result } = renderHook(() => useAdminAssistantSwitch());
    expect(result.current.open).toBe(false);
  });

  it("open reflects the bus's own state, updating when publishAssistantDockState fires elsewhere (e.g. the FAB)", () => {
    const { result } = renderHook(() => useAdminAssistantSwitch());
    expect(result.current.open).toBe(false);

    act(() => publishAssistantDockState({ open: true }));

    expect(result.current.open).toBe(true);
  });

  it("setOpen asks the bus to open/close via requestAssistantDock — it does NOT flip open itself", () => {
    const requests: boolean[] = [];
    const unsubscribe = subscribeToAssistantDockRequests({ listener: (open) => requests.push(open) });
    const { result } = renderHook(() => useAdminAssistantSwitch());

    act(() => result.current.setOpen({ open: true }));

    expect(requests).toEqual([true]);
    // No owner (the host app shell) is listening in this test, so nothing ever calls
    // publishAssistantDockState back — open stays false, proving setOpen is a request, not a write.
    expect(result.current.open).toBe(false);
    unsubscribe();
  });

  it("the getServerSnapshot argument (React's SSR fallback) returns false — real in an app with no SSR path, so unreachable through normal client rendering, but still the right server-side answer if that ever changes", () => {
    // A plain client render never calls `useSyncExternalStore`'s third argument (React only invokes
    // it during server rendering/hydration), and this app is a client-only SPA — so the ONLY way to
    // exercise this one-line callback at all is to capture it directly off the real call — proving
    // the exact behavior without standing up ReactDOMServer.
    renderHook(() => useAdminAssistantSwitch());
    const getServerSnapshot = useSyncExternalStoreSpy.mock.calls[0]?.[2];
    expect(getServerSnapshot).toBeInstanceOf(Function);
    expect(getServerSnapshot!()).toBe(false);
  });
});
