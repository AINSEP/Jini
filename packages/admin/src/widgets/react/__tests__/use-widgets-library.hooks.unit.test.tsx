import { fileURLToPath } from "node:url";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, type AdminWidget } from "./fixtures/api.js";
import { publishContentRefresh, resetContentRefreshBus } from "./fixtures/events.js";
import { createFakeWidgetsPort } from "./fixtures/memory.js";
import { useWidgetsLibrary } from "./fixtures/use-widgets-library.js";
import { WIDGETS_LIBRARY_RESOURCE } from "./fixtures/rules.js";

/**
 * @file `useWidgetsLibrary` driven against the injected `WidgetsPort`, no `fetch` stub.
 * `WidgetsLibrary.unit.test.tsx` already covers the real-client path via `useWiredWidgetsLibrary`
 * (the component's default DI prop); this is the "injected port" half.
 *
 * Trash rewrite (2026-09-21): the old purge/force-purge escalation is gone. Delete now confirms
 * once ("Move to trash?") and calls `port.trashWidget` exactly once — the generic `api.trash`
 * route.
 */

const WIDGET: AdminWidget = {
  id: "w1",
  workspaceId: "ws1",
  slug: "hero",
  title: "Hero",
  status: "active",
  widgetType: "text",
  config: {},
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWidgetsLibrary — injected port (no fetch stub)", () => {
  it("loads the list and skipped record IDs from the injected port without touching the real api client", async () => {
    const listSpy = vi.spyOn(api, "listWidgets");
    const port = createFakeWidgetsPort({ widgets: [WIDGET], skippedCount: 1, skippedIds: ["malformed-1"] });
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));

    await waitFor(() => expect(result.current.widgets).toHaveLength(1));
    expect(result.current.widgets?.[0]?.id).toBe("w1");
    expect(result.current.skippedCount).toBe(1);
    expect(result.current.skippedIds).toEqual(["malformed-1"]);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("does not resolve `widgets` while the injected port's list call is still pending", () => {
    const port = createFakeWidgetsPort();
    port.listWidgets = () => new Promise(() => {});
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    expect(result.current.widgets).toBeNull();
  });
});

/**
 * S1 (plan-content2.md, 2026-09-20; terra review triage): `load()` has no latest-wins guard, unlike
 * its siblings `use-widget-regions.hooks.ts` and `use-widget-region-editor.hooks.ts`, which both
 * guard exactly this. Trashing widget A, then widget B, fires two independent re-reads — if A's
 * settles LAST, B renders as `active` again even though the server already trashed it.
 */
describe("useWidgetsLibrary — overlapping list reads keep the newest", () => {
  const WIDGET_A: AdminWidget = { ...WIDGET, id: "wA", slug: "a", title: "A", status: "active" };
  const WIDGET_B: AdminWidget = { ...WIDGET, id: "wB", slug: "b", title: "B", status: "active" };

  it("an older list read settling after a newer one does not overwrite it", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET_A, WIDGET_B] });
    type ListResult = { widgets: AdminWidget[]; skippedCount?: number };
    const releases: Array<(r: ListResult) => void> = [];
    let callCount = 0;
    port.listWidgets = vi.fn(() => {
      callCount += 1;
      // The mount read settles immediately; every read after it is held until the test releases it.
      if (callCount === 1) return Promise.resolve({ widgets: [WIDGET_A, WIDGET_B], skippedCount: 0 });
      return new Promise<ListResult>((resolve) => {
        releases[callCount] = resolve;
      });
    });

    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(2));

    // Trash A, then trash B — each fires its own `load()` re-read once its `trashWidget` write settles.
    act(() => {
      result.current.requestTrash(WIDGET_A);
    });
    act(() => {
      void result.current.confirmTrash();
    });
    await waitFor(() => expect(releases[2]).toBeDefined());

    act(() => {
      result.current.requestTrash(WIDGET_B);
    });
    act(() => {
      void result.current.confirmTrash();
    });
    await waitFor(() => expect(releases[3]).toBeDefined());

    // The NEWER read (B's, triggered last — both A and B are trashed server-side by now, so the
    // server's default active-only list returns neither) settles FIRST...
    await act(async () => {
      releases[3]!({ widgets: [], skippedCount: 0 });
    });
    // ...then the STALE, older read (fired right after A was trashed but before B was) settles
    // after it, still carrying B as active.
    await act(async () => {
      releases[2]!({ widgets: [WIDGET_B], skippedCount: 0 });
    });

    // Fails without the settlement guard: the stale read wins because it settled last, so B
    // reappears even though the server already trashed it.
    await waitFor(() => expect(result.current.widgets?.find((w) => w.id === WIDGET_B.id)).toBeUndefined());
  });

  // a3-review-6 (2026-09-21): the test above only pins the `.then` guard. Removing the `.catch` guard
  // left this whole file green, so a stale read that FAILS late gets its own test.
  it("an older list read failing after a newer one succeeded shows no load error", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET_A, WIDGET_B] });
    type ListResult = { widgets: AdminWidget[]; skippedCount?: number };
    const releases: Array<{ resolve: (r: ListResult) => void; reject: (e: unknown) => void }> = [];
    let callCount = 0;
    port.listWidgets = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve({ widgets: [WIDGET_A, WIDGET_B], skippedCount: 0 });
      return new Promise<ListResult>((resolve, reject) => {
        releases[callCount] = { resolve, reject };
      });
    });

    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(2));

    act(() => {
      result.current.requestTrash(WIDGET_A);
    });
    act(() => {
      void result.current.confirmTrash();
    });
    await waitFor(() => expect(releases[2]).toBeDefined());
    act(() => {
      result.current.requestTrash(WIDGET_B);
    });
    act(() => {
      void result.current.confirmTrash();
    });
    await waitFor(() => expect(releases[3]).toBeDefined());

    // The newer read (both trashed by now) succeeds first, then the older, stale one fails.
    await act(async () => {
      releases[3]!.resolve({ widgets: [], skippedCount: 0 });
    });
    await act(async () => {
      releases[2]!.reject(new Error("stale read failed"));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.widgets).toEqual([]);
  });
});

describe("useWidgetsLibrary — content refresh bus", () => {
  afterEach(() => resetContentRefreshBus());

  it("re-reads the library when a content refresh fires, so an assistant-created widget appears without a reload", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toEqual([WIDGET]));

    // The assistant's `widgets_create_instance` call landing server-side — the screen has no other
    // way to know it happened.
    port.widgets.push({ ...WIDGET, id: "w2", slug: "hero-2" });
    expect(result.current.widgets).toEqual([WIDGET]);

    act(() => publishContentRefresh());

    await waitFor(() => expect(result.current.widgets).toHaveLength(2));
  });

  it("refreshes on a notification that names widgets-library, and ignores one that names only other resources", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toEqual([WIDGET]));

    port.widgets.push({ ...WIDGET, id: "w2", slug: "hero-2" });

    act(() => publishContentRefresh(["taxonomy"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.widgets).toEqual([WIDGET]);

    act(() => publishContentRefresh([WIDGETS_LIBRARY_RESOURCE]));
    await waitFor(() => expect(result.current.widgets).toHaveLength(2));
  });

  it("stops re-reading once unmounted", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    const listSpy = vi.spyOn(port, "listWidgets");
    const { result, unmount } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toEqual([WIDGET]));

    const callsWhileMounted = listSpy.mock.calls.length;
    unmount();
    act(() => publishContentRefresh());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listSpy).toHaveBeenCalledTimes(callsWhileMounted);
  });
});

/**
 * Trash rewrite (2026-09-21): "Trash" always confirms first — `requestTrash` opens the dialog and
 * sends nothing until `confirmTrash`. Replaces the old two-stage purge/force-purge escalation.
 */
describe("useWidgetsLibrary — delete confirms first, then trashes exactly once", () => {
  it("requestTrash opens the confirm and sends nothing until confirmed", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    const trashSpy = vi.spyOn(port, "trashWidget");
    const allowed = new Set(["listWidgets", "trashWidget"]);
    const strictPort = new Proxy(port, { get(target, name, receiver) {
      if (typeof name === "string" && !allowed.has(name)) throw new Error(`unexpected widget operation: ${name}`);
      return Reflect.get(target, name, receiver);
    } });
    const { result } = renderHook(() => useWidgetsLibrary({ port: strictPort, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(1));

    act(() => result.current.requestTrash(WIDGET));
    expect(trashSpy).not.toHaveBeenCalled();
    expect(result.current.pendingTrash?.id).toBe(WIDGET.id);

    await act(async () => {
      await result.current.confirmTrash();
    });
    expect(trashSpy).toHaveBeenCalledTimes(1);
    expect(trashSpy).toHaveBeenCalledWith(WIDGET.id);
    expect(result.current.pendingTrash).toBeNull();
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.widgets).toEqual([]));
  });

  it("cancelTrash closes the confirm with no request", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    const trashSpy = vi.spyOn(port, "trashWidget");
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(1));

    act(() => result.current.requestTrash(WIDGET));
    expect(result.current.pendingTrash?.id).toBe(WIDGET.id);

    act(() => result.current.cancelTrash());
    expect(result.current.pendingTrash).toBeNull();
    expect(trashSpy).not.toHaveBeenCalled();
  });

  it("trashing is true only while the confirmed trash is in flight", async () => {
    let resolveTrash: ((r: { ok: true; version: number | null }) => void) | undefined;
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    port.trashWidget = vi.fn(() => new Promise<{ ok: true; version: number | null }>((resolve) => (resolveTrash = resolve)));
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(1));

    act(() => result.current.requestTrash(WIDGET));
    expect(result.current.trashing).toBe(false);

    let confirmPromise!: Promise<void>;
    act(() => {
      confirmPromise = result.current.confirmTrash();
    });
    expect(result.current.trashing).toBe(true);

    await act(async () => {
      resolveTrash?.({ ok: true, version: 2 });
      await confirmPromise;
    });
    expect(result.current.trashing).toBe(false);
  });
});

describe("useWidgetsLibrary — trash error mapping", () => {
  it("a 409 TRASH_VERSION_CHANGED shows a reload message instead of the generic delete-failed one", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    port.trashWidget = vi.fn(() => {
      throw new ApiError("the item changed since it was last read", 409, "TRASH_VERSION_CHANGED");
    });
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(1));

    act(() => result.current.requestTrash(WIDGET));
    await act(async () => {
      await result.current.confirmTrash();
    });

    expect(result.current.error).toBe("This item changed since you loaded it. Reload and try again.");
  });

  it("a 404 NOT_FOUND (already gone) shows no error and quietly re-reads the list", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    const listSpy = vi.spyOn(port, "listWidgets");
    port.trashWidget = vi.fn(() => {
      throw new ApiError("item was not found", 404, "NOT_FOUND");
    });
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(1));
    const callsBeforeTrash = listSpy.mock.calls.length;

    act(() => result.current.requestTrash(WIDGET));
    await act(async () => {
      await result.current.confirmTrash();
    });

    expect(result.current.error).toBeNull();
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(callsBeforeTrash));
  });

  it("any other error falls back to the generic 'delete failed' message", async () => {
    const port = createFakeWidgetsPort({ widgets: [WIDGET] });
    port.trashWidget = vi.fn(() => {
      throw new Error("network exploded");
    });
    const { result } = renderHook(() => useWidgetsLibrary({ port, locale: "en", t: (key: string) => key }));
    await waitFor(() => expect(result.current.widgets).toHaveLength(1));

    act(() => result.current.requestTrash(WIDGET));
    await act(async () => {
      await result.current.confirmTrash();
    });

    expect(result.current.error).toBe("network exploded");
  });
});

// Grep-style regression: the widget escalation is gone for good — a WidgetsPort with no
// permanent-removal operation still satisfies every call site in this hook file and its component.
// Reading the source text pins that no permanent-removal call or force option survived the rewrite
// — the codebase's established "scan the source text" idiom, e.g.
// `deployment/__tests__/rules.unit.test.ts`'s `.not.toMatch` assertions.
describe("useWidgetsLibrary/WidgetsLibrary — no permanent-removal call remains", () => {
  it.each([
    "src/features/widgets/hooks/use-widgets-library.hooks.ts",
    "src/features/widgets/WidgetsLibrary.tsx",
  ])("%s calls no purge/force-purge method and passes no force option", async (relPath) => {
    const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
    const source = await fs.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), relPath.endsWith("WidgetsLibrary.tsx") ? "../pages/WidgetsLibrary.tsx" : "../hooks/use-widgets-library.hooks.ts"), "utf-8");
    expect(source).not.toMatch(/\.purge\w*\s*\(/i);
    expect(source).not.toMatch(/force\s*:/i);
    expect(source).not.toMatch(/pendingForcePurge|confirmForcePurge|trashOrPurge/);
  });
});
