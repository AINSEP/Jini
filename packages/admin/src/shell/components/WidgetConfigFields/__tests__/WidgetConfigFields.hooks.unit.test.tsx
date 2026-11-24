// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";

import { isAbortError } from "@jini-ai/core/text";
import { humanizeFieldName, useFetchedOptions, useRecentEntriesConfig, useSocialLinksConfig } from "../WidgetConfigFields.hooks.js";

/**
 * @file `useFetchedOptions` — the hook `MenuConfigFields`/`ContactFormConfigFields` share
 * (`WidgetConfigFields.tsx`), extracted from what used to be two copy-pasted `useState`/`useEffect`
 * pairs when `WidgetConfigFields.tsx` split into `WidgetConfigFields.tsx`/
 * `WidgetConfigFields.hooks.tsx`. Exercised directly via `renderHook`, mirroring this repo's
 * `use-fab-position.hooks.test.ts` — `WidgetConfigFields.unit.test.tsx` already covers the same
 * fetch-then-render behavior through the rendered `MenuConfigFields`/`ContactFormConfigFields`
 * components, so this file's job is to pin the hook's own contract in isolation: starts `null`,
 * resolves to the fetched list, and falls back to the given message on a non-`Error` rejection.
 */

describe("useFetchedOptions", () => {
  it("starts with items/error both null, then resolves items to the fetch result", async () => {
    const fetchList = vi.fn().mockResolvedValue(["a", "b", "c"]);
    const { result } = renderHook(() => useFetchedOptions({ fetchList, key: ["test-options"], isAbortError }, { errorFallback: "fallback" }));

    expect(result.current.items).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c"]));
    expect(result.current.error).toBeNull();
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it("surfaces the rejection's own message when it is an Error instance", async () => {
    const fetchList = vi.fn().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useFetchedOptions({ fetchList, key: ["test-options"], isAbortError }, { errorFallback: "fallback" }));

    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.items).toBeNull();
  });

  it("falls back to the given message when the rejection is not an Error instance", async () => {
    const fetchList = vi.fn().mockRejectedValue("string rejection");
    const { result } = renderHook(() => useFetchedOptions({ fetchList, key: ["test-options"], isAbortError }, { errorFallback: "failed to load menus" }));

    await waitFor(() => expect(result.current.error).toBe("failed to load menus"));
  });

  it("swallows an AbortError from a page-unload cancellation instead of surfacing it as a load error", async () => {
    // `lib/api.ts` rejects an in-flight request with an AbortError when the document is unloading
    // (`lib/page-lifecycle.ts`). Left unguarded, this hook would set `error` to that cancellation's
    // own message — invisible during the unload itself, but restorable, stale, if the page comes
    // back from the back/forward cache with this dialog still mounted.
    //
    // The same rejected promise instance is returned to both the hook and this test, so awaiting
    // it here (after the hook's own `.catch` was already attached during mount) proves the hook's
    // handler has also run — there is no state transition to `waitFor` when the outcome is "stays
    // null", so settling on the shared promise is what makes this deterministic rather than racy.
    const rejection = new DOMException("request cancelled: the page is unloading", "AbortError");
    const pending = Promise.reject(rejection);
    const fetchList = vi.fn().mockReturnValue(pending);
    const { result } = renderHook(() => useFetchedOptions({ fetchList, key: ["test-options"], isAbortError }, { errorFallback: "fallback" }));

    await act(async () => {
      await pending.catch(() => {});
    });

    expect(result.current.items).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches exactly once per mount, not once per render", async () => {
    const fetchList = vi.fn().mockResolvedValue([]);
    const { result, rerender } = renderHook(() => useFetchedOptions({ fetchList, key: ["test-options"], isAbortError }, { errorFallback: "fallback" }));
    await waitFor(() => expect(result.current.items).toEqual([]));

    act(() => rerender());
    act(() => rerender());

    expect(fetchList).toHaveBeenCalledTimes(1);
  });
});

describe("useSocialLinksConfig — addLink's own cap guard", () => {
  // `WidgetConfigFields.unit.test.tsx`'s "Add link is disabled at the 20-link cap..." test proves
  // the RENDERED button is disabled at the cap, but a disabled button's onClick never fires — so
  // that test never actually invokes `addLink()` itself, and the guard's own true branch stays
  // untested. Called directly here, bypassing the UI-level disable, to prove the hook enforces the
  // cap on its own merits too — defense in depth, not just a disabled affordance.
  it("is a no-op once links is already at the 20-link cap", () => {
    const onChange = vi.fn();
    const links = Array.from({ length: 20 }, (_, i) => ({ platform: `p${i}`, url: `https://${i}` }));
    const { result } = renderHook(() => useSocialLinksConfig({ config: { links }, onChange }));

    act(() => result.current.addLink());

    expect(onChange).not.toHaveBeenCalled();
  });

  it("still appends normally one below the cap", () => {
    const onChange = vi.fn();
    const links = Array.from({ length: 19 }, (_, i) => ({ platform: `p${i}`, url: `https://${i}` }));
    const { result } = renderHook(() => useSocialLinksConfig({ config: { links }, onChange }));

    act(() => result.current.addLink());

    expect(onChange).toHaveBeenCalledWith({ links: [...links, { platform: "", url: "" }] });
  });
});

describe("humanizeFieldName", () => {
  it("turns snake_case, kebab-case and camelCase field names into a sentence-case label", () => {
    expect(humanizeFieldName({ name: "docs_page" })).toBe("Docs page");
    expect(humanizeFieldName({ name: "publishedAt" })).toBe("Published at");
    expect(humanizeFieldName({ name: "hero-image" })).toBe("Hero image");
    expect(humanizeFieldName({ name: "title" })).toBe("Title");
  });

  it("returns an empty label for a name made only of separators", () => {
    expect(humanizeFieldName({ name: "__-" })).toBe("");
  });
});

/** Renders `useRecentEntriesConfig` over a config that, like the real form, is replaced by each
 *  `onChange` — so every assertion reads the config the operator's last edit actually produced. */
function renderRecentEntries(initial: Record<string, unknown>) {
  let config = initial;
  const onChange = vi.fn((next: Record<string, unknown>) => { config = next; });
  const view = renderHook(() => useRecentEntriesConfig({ config, onChange }));
  return { view, onChange, latest: () => config, sync: () => view.rerender() };
}

describe("useRecentEntriesConfig — reading config.where back as the filter row", () => {
  it("shows a stored boolean clause as its string form", () => {
    const { view } = renderRecentEntries({ where: { featured: true } });
    expect(view.result.current.filterField).toBe("featured");
    expect(view.result.current.filterValue).toBe("true");
  });

  it("ignores a where object with more than one key", () => {
    const { view } = renderRecentEntries({ where: { a: "x", b: "y" } });
    expect(view.result.current.filterField).toBe("");
    expect(view.result.current.filterValue).toBe("");
  });

  it("ignores a where clause whose value is not a scalar", () => {
    const { view } = renderRecentEntries({ where: { tags: ["a"] } });
    expect(view.result.current.filterField).toBe("");
    expect(view.result.current.filterValue).toBe("");
  });
});

describe("useRecentEntriesConfig — writing the filter value per field kind", () => {
  it("keeps a text field's value as the raw string", () => {
    const { view, latest } = renderRecentEntries({ where: { title: "old" } });
    act(() => view.result.current.setFilterValue({ raw: "Hello", kind: "text" }));
    expect(latest().where).toEqual({ title: "Hello" });
  });

  it("stores a real-number field's value as a number", () => {
    const { view, latest } = renderRecentEntries({ where: { rating: 1 } });
    act(() => view.result.current.setFilterValue({ raw: "2.5", kind: "real" }));
    expect(latest().where).toEqual({ rating: 2.5 });
  });

  it("keeps a non-numeric value typed into an integer field as the raw string rather than NaN", () => {
    const { view, latest } = renderRecentEntries({ where: { count: 1 } });
    act(() => view.result.current.setFilterValue({ raw: "abc", kind: "integer" }));
    expect(latest().where).toEqual({ count: "abc" });
  });
});

describe("useRecentEntriesConfig — field and layout controls", () => {
  it("clearing the filter field drops the stored clause and leaves no field chosen", () => {
    const { view, latest, sync } = renderRecentEntries({ where: { title: "x" }, collection: "docs" });
    act(() => view.result.current.setFilterField({ name: "" }));
    expect(latest()).toEqual({ collection: "docs" });
    sync();
    expect(view.result.current.filterField).toBe("");
    expect(view.result.current.filterValue).toBe("");
  });

  it("clearing the layout removes both layout and columns from config", () => {
    const { view, latest } = renderRecentEntries({ layout: "cards", columns: 3 });
    act(() => view.result.current.setLayout({ value: "" }));
    expect(latest()).toEqual({});
  });

  it("keeps columns when switching to the cards layout, drops them for any other layout", () => {
    const cards = renderRecentEntries({ layout: "list", columns: 2 });
    act(() => cards.view.result.current.setLayout({ value: "cards" }));
    expect(cards.latest()).toEqual({ layout: "cards", columns: 2 });

    const list = renderRecentEntries({ layout: "cards", columns: 2 });
    act(() => list.view.result.current.setLayout({ value: "list" }));
    expect(list.latest()).toEqual({ layout: "list" });
  });
});
