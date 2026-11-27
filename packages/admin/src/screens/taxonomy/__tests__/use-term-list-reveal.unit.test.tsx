// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AdminTerm } from "../api/taxonomy-api.types.js";
import { useTermListReveal } from "../hooks/use-term-list-reveal.hooks.js";
import { TERM_PICKER_COLLAPSED_COUNT } from "../rules.js";

const term = (id: string): AdminTerm => ({ id, taxonomyId: "tx", parentId: null, name: `Name ${id}`, status: "active", updatedAt: "2026-11-01", version: 1 });
// Two more terms than the collapsed row shows, so "See more" has something to reveal.
const TERMS = Array.from({ length: TERM_PICKER_COLLAPSED_COUNT + 2 }, (_, index) => term(`t${index + 1}`));
const LAST = `t${TERM_PICKER_COLLAPSED_COUNT + 2}`;
const ids = (terms: readonly AdminTerm[]) => terms.map((t) => t.id);

describe("useTermListReveal", () => {
  it("leads with the terms ticked at load, and keeps that order while more are ticked", () => {
    const hook = renderHook((props: { selected: ReadonlySet<string>; loading: boolean }) => useTermListReveal({ terms: TERMS, ...props }),
      { initialProps: { selected: new Set([LAST]), loading: true } });
    hook.rerender({ selected: new Set([LAST]), loading: false });
    expect(ids(hook.result.current.shown)[0]).toBe(LAST);
    expect(hook.result.current.expanded).toBe(false);

    hook.rerender({ selected: new Set([LAST, "t2"]), loading: false });
    expect(ids(hook.result.current.shown).slice(0, 2)).toEqual([LAST, "t1"]);
  });

  it("re-takes the ticked snapshot when toggled, so newly ticked terms lead, and toggles back", () => {
    const hook = renderHook((props: { selected: ReadonlySet<string> }) => useTermListReveal({ terms: TERMS, loading: false, ...props }),
      { initialProps: { selected: new Set<string>() } });
    expect(hook.result.current.shown).toHaveLength(TERM_PICKER_COLLAPSED_COUNT);
    expect(hook.result.current.canToggle).toBe(true);

    hook.rerender({ selected: new Set([LAST]) });
    act(() => hook.result.current.toggleExpanded());
    expect(hook.result.current.expanded).toBe(true);
    expect(ids(hook.result.current.shown)).toEqual([LAST, ...ids(TERMS.slice(0, -1))]);

    act(() => hook.result.current.toggleExpanded());
    expect(hook.result.current.expanded).toBe(false);
    expect(ids(hook.result.current.shown)[0]).toBe(LAST);
  });

  it("narrows the unticked rest by the search query", () => {
    const hook = renderHook(() => useTermListReveal({ terms: TERMS, selected: new Set(["t1"]), loading: false }));
    act(() => hook.result.current.setQuery("name t3"));
    expect(hook.result.current.query).toBe("name t3");
    expect(ids(hook.result.current.shown)).toEqual(["t1", "t3"]);
  });
});
