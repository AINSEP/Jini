import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyHighlightKey,
  buildOptionId,
  computePosition,
  edgeHighlightIndex,
  focusableInDomOrder,
  highlightedOptionOrNull,
  repositionOrClose,
  resolveTabTarget,
  usePanelPosition,
  useSelectDropdown,
  type SelectOption,
} from "../components/Select/Select.hooks";

/**
 * @file `Select.hooks.tsx` — the pure DOM helpers (`buildOptionId`, `computePosition`,
 * `focusableInDomOrder`) and the `useSelectDropdown` hook's own state-shape behavior, split out of
 * `Select.unit.test.tsx` when `Select.tsx` split into `Select.tsx`/`Select.hooks.tsx`, mirroring
 * this repo's `use-fab-position.hooks.test.ts`. `Select.unit.test.tsx` keeps the tests that render
 * the actual `<Select>` component; this file exercises the hook and its helpers directly via
 * `renderHook`, without a DOM tree or a portal at all.
 */

const FEW_OPTIONS: SelectOption[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

describe("buildOptionId", () => {
  it("joins the listbox id and index with the component's fixed suffix", () => {
    expect(buildOptionId({ listboxId: "listbox-1", index: 3 })).toBe("listbox-1-option-3");
  });
});

/** A stand-in trigger element with a stubbed `getBoundingClientRect()` — `computePosition` reads
 * nothing else off it. */
function fakeTrigger(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement("button");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect,
  } as DOMRect);
  return el;
}

function withInnerHeight(height: number, run: () => void) {
  const original = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(window, "innerHeight", { value: original, configurable: true });
  }
}

describe("computePosition", () => {
  it("opens downward, anchored just below the trigger, when there is room below", () => {
    withInnerHeight(800, () => {
      const trigger = fakeTrigger({ top: 100, bottom: 130, left: 20, width: 200 });
      const position = computePosition({ trigger: trigger });
      expect(position.top).toBe(134); // rect.bottom + the 4px gap
      expect(position.bottom).toBeUndefined();
      expect(position.left).toBe(20);
      expect(position.width).toBe(200);
    });
  });

  it("opens upward, anchored just above the trigger, when there isn't room below but there is above", () => {
    withInnerHeight(400, () => {
      // spaceBelow = 400 - 380 = 20 (< the 280px estimate); spaceAbove = 350 (> spaceBelow) -> upward.
      const trigger = fakeTrigger({ top: 350, bottom: 380, left: 0, width: 100 });
      const position = computePosition({ trigger: trigger });
      expect(position.bottom).toBe(400 - 350 + 4); // viewportHeight - rect.top + the 4px gap
      expect(position.top).toBeUndefined();
      expect(position.maxHeight).toBe(Math.max(120, 350 - 8));
    });
  });

  it("floors maxHeight at 120 even when the actual available space is smaller", () => {
    withInnerHeight(100, () => {
      // spaceBelow = 100 - 20 = 80 (< 280 estimate), but spaceAbove (10) is not > spaceBelow (80),
      // so this still opens downward — the branch under test is the maxHeight floor, not direction.
      const trigger = fakeTrigger({ top: 10, bottom: 20, left: 0, width: 50 });
      const position = computePosition({ trigger: trigger });
      expect(position.top).toBeDefined();
      expect(position.maxHeight).toBe(120);
    });
  });
});

describe("repositionOrClose", () => {
  // Direct coverage of the scroll/resize decision extracted out of `usePanelPosition`'s effect
  // under the tightened ≤9/≤9 pass. `Select.unit.test.tsx`'s "repositions on scroll..." test already
  // pins the elementFromPoint-unavailable branch end-to-end; these exercise every branch directly.
  it("closes without repositioning when the trigger's rect is entirely out of the viewport", () => {
    withInnerHeight(800, () => {
      const trigger = fakeTrigger({ top: -50, bottom: -10, left: 0, width: 50 }); // bottom <= 0
      const onOutOfView = vi.fn();
      const setPosition = vi.fn();
      repositionOrClose({ trigger: trigger, onOutOfView: onOutOfView, setPosition: setPosition });
      expect(onOutOfView).toHaveBeenCalledTimes(1);
      expect(setPosition).not.toHaveBeenCalled();
    });
  });

  it("closes without repositioning when elementFromPoint reports the trigger is obscured", () => {
    withInnerHeight(800, () => {
      const trigger = fakeTrigger({ top: 100, bottom: 130, left: 20, right: 220, width: 200 });
      const original = document.elementFromPoint;
      // A stand-in element that is neither the trigger nor a descendant/ancestor of it — the
      // "something else is on top" case.
      document.elementFromPoint = vi.fn().mockReturnValue(document.createElement("div"));
      try {
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        repositionOrClose({ trigger: trigger, onOutOfView: onOutOfView, setPosition: setPosition });
        expect(onOutOfView).toHaveBeenCalledTimes(1);
        expect(setPosition).not.toHaveBeenCalled();
      } finally {
        document.elementFromPoint = original;
      }
    });
  });

  it("recomputes position when the trigger is visible and unobscured", () => {
    withInnerHeight(800, () => {
      const trigger = fakeTrigger({ top: 100, bottom: 130, left: 20, right: 220, width: 200 });
      const original = document.elementFromPoint;
      document.elementFromPoint = vi.fn().mockReturnValue(trigger); // the trigger is on top of itself
      try {
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        repositionOrClose({ trigger: trigger, onOutOfView: onOutOfView, setPosition: setPosition });
        expect(onOutOfView).not.toHaveBeenCalled();
        expect(setPosition).toHaveBeenCalledWith(computePosition({ trigger: trigger }));
      } finally {
        document.elementFromPoint = original;
      }
    });
  });

  it("degrades to the viewport-edge check alone when elementFromPoint is unavailable", () => {
    withInnerHeight(800, () => {
      const trigger = fakeTrigger({ top: 100, bottom: 130, left: 20, right: 220, width: 200 });
      const original = document.elementFromPoint;
      // @ts-expect-error — simulating an environment where the API does not exist at all.
      document.elementFromPoint = undefined;
      try {
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        repositionOrClose({ trigger: trigger, onOutOfView: onOutOfView, setPosition: setPosition });
        expect(onOutOfView).not.toHaveBeenCalled();
        expect(setPosition).toHaveBeenCalledWith(computePosition({ trigger: trigger }));
      } finally {
        document.elementFromPoint = original;
      }
    });
  });
});

describe("focusableInDomOrder", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns focusable elements in DOM order, skipping disabled ones and anything inside `exclude`", () => {
    document.body.innerHTML = `
      <button id="btn1">one</button>
      <button id="disabled-button" disabled>disabled</button>
      <input id="disabled-input" disabled />
      <select id="disabled-select" disabled><option>disabled</option></select>
      <textarea id="disabled-textarea" disabled></textarea>
      <div id="host"><input id="inp1" /><button id="btn2" disabled>two</button></div>
      <a id="link1" href="#">three</a>
    `;
    const host = document.getElementById("host") as HTMLElement;
    const ids = focusableInDomOrder({ exclude: host }).map((el) => el.id);
    // `inp1`/`btn2` are inside `host` (excluded); `btn2` would be skipped anyway (disabled).
    expect(ids).toEqual(["btn1", "link1"]);
  });

  it("returns every focusable element when exclude is null", () => {
    document.body.innerHTML = `<button id="only">x</button>`;
    expect(focusableInDomOrder({ exclude: null }).map((el) => el.id)).toEqual(["only"]);
  });
});

describe("resolveTabTarget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // `Select.unit.test.tsx`'s "Tab moves focus..." / "Shift+Tab moves focus..." / "Tab closes the
  // panel without moving focus..." tests already pin this behavior end-to-end through a real
  // keydown; these three exercise the extracted function's own math directly, per this pass's rule
  // that every top-level extraction gets a direct unit test.
  it("returns the trigger's next DOM-order neighbour when moving forward", () => {
    document.body.innerHTML = `<button id="before">before</button><button id="trigger">trigger</button><button id="after">after</button>`;
    const trigger = document.getElementById("trigger")!;
    const target = resolveTabTarget({ panel: null, trigger: trigger, shiftKey: false });
    expect(target?.id).toBe("after");
  });

  it("returns the trigger's previous DOM-order neighbour when shiftKey is set", () => {
    document.body.innerHTML = `<button id="before">before</button><button id="trigger">trigger</button><button id="after">after</button>`;
    const trigger = document.getElementById("trigger")!;
    const target = resolveTabTarget({ panel: null, trigger: trigger, shiftKey: true });
    expect(target?.id).toBe("before");
  });

  it("returns null when the trigger cannot be found among the focusable nodes", () => {
    document.body.innerHTML = `<button id="only">only</button>`;
    const trigger = document.createElement("button"); // never attached to the DOM
    expect(resolveTabTarget({ panel: null, trigger: trigger, shiftKey: false })).toBeNull();
  });

  it("returns null when there is no trigger element at all", () => {
    document.body.innerHTML = `<button id="only">only</button>`;
    expect(resolveTabTarget({ panel: null, trigger: null, shiftKey: false })).toBeNull();
  });
});

describe("usePanelPosition — scroll/resize reposition guard", () => {
  // `reposition()`'s own `if (!el) return;` — the trigger ref can read null if the trigger element
  // is no longer mounted by the time a scroll/resize fires while the panel is still open. No
  // product path drives this through the full `<Select>` component today (the trigger button is
  // always rendered alongside the panel), so it's exercised directly against this extracted hook,
  // whose own doc names this split's purpose as making exactly this kind of internal branch
  // testable without mounting the whole dropdown.
  it("is a safe no-op when the trigger ref is null when a scroll fires", () => {
    const triggerRef = { current: null };
    const { result } = renderHook(() =>
      usePanelPosition({
        open: true,
        triggerRef,
        panelRef: { current: null },
        searchInputRef: { current: null },
        showSearch: false,
        onOutOfView: vi.fn(),
      }),
    );
    const before = result.current.position;

    expect(() => act(() => window.dispatchEvent(new Event("scroll")))).not.toThrow();
    expect(result.current.position).toBe(before);
  });
});

describe("edgeHighlightIndex", () => {
  // Direct coverage of the ternary extracted out of `handlePanelKeyDown`'s `"Home"`/`"End"` cases
  // under the 2026-08-12 ≤9/≤9 pass. `Select.unit.test.tsx`'s "Home/End jump the highlight..." and
  // "...are all safe no-ops" tests already pin this end-to-end; these exercise the function directly.
  it("returns 0 for the first edge when the list is non-empty", () => {
    expect(edgeHighlightIndex({ filteredLength: 3, edge: "first" })).toBe(0);
  });

  it("returns the last index for the last edge when the list is non-empty", () => {
    expect(edgeHighlightIndex({ filteredLength: 3, edge: "last" })).toBe(2);
  });

  it("returns -1 for either edge when the list is empty", () => {
    expect(edgeHighlightIndex({ filteredLength: 0, edge: "first" })).toBe(-1);
    expect(edgeHighlightIndex({ filteredLength: 0, edge: "last" })).toBe(-1);
  });
});

describe("highlightedOptionOrNull", () => {
  // Direct coverage of the guard extracted out of `handlePanelKeyDown`'s `"Enter"` case.
  it("returns the option at a valid highlighted index", () => {
    expect(highlightedOptionOrNull({ filtered: FEW_OPTIONS, highlightedIndex: 1 })).toEqual(FEW_OPTIONS[1]);
  });

  it("returns null when nothing is highlighted (-1)", () => {
    expect(highlightedOptionOrNull({ filtered: FEW_OPTIONS, highlightedIndex: -1 })).toBeNull();
  });

  it("returns null when the highlighted index is stale — past the end of a shrunk list", () => {
    expect(highlightedOptionOrNull({ filtered: FEW_OPTIONS, highlightedIndex: 99 })).toBeNull();
  });
});

describe("applyHighlightKey", () => {
  // Direct coverage of the five-key dispatcher extracted out of `handlePanelKeyDown` to bring its
  // cyclomatic complexity from 13 down to 9 — plain arguments and `vi.fn()` spies, no `renderHook`,
  // no DOM. `Select.unit.test.tsx` already pins all of this end-to-end through real keydown events;
  // these assert each branch's own decision directly, including the ones the full-component tests
  // can't isolate (e.g. that `preventDefault` fires even when Enter has nothing to select).
  function spyActions() {
    return {
      preventDefault: vi.fn(),
      moveHighlight: vi.fn(),
      setHighlightedIndex: vi.fn(),
      selectOption: vi.fn(),
    };
  }

  it("ArrowDown prevents default and moves the highlight forward", () => {
    const actions = spyActions();
    const handled = applyHighlightKey({ key: "ArrowDown", filtered: FEW_OPTIONS, highlightedIndex: 0, actions: actions });
    expect(handled).toBe(true);
    expect(actions.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.moveHighlight).toHaveBeenCalledWith(1);
  });

  it("ArrowUp prevents default and moves the highlight backward", () => {
    const actions = spyActions();
    applyHighlightKey({ key: "ArrowUp", filtered: FEW_OPTIONS, highlightedIndex: 0, actions: actions });
    expect(actions.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.moveHighlight).toHaveBeenCalledWith(-1);
  });

  it("Home prevents default and jumps the highlight to the first row", () => {
    const actions = spyActions();
    applyHighlightKey({ key: "Home", filtered: FEW_OPTIONS, highlightedIndex: 2, actions: actions });
    expect(actions.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.setHighlightedIndex).toHaveBeenCalledWith(0);
  });

  it("End prevents default and jumps the highlight to the last row", () => {
    const actions = spyActions();
    applyHighlightKey({ key: "End", filtered: FEW_OPTIONS, highlightedIndex: 0, actions: actions });
    expect(actions.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.setHighlightedIndex).toHaveBeenCalledWith(2);
  });

  it("Home/End on an empty list still prevent default but highlight nothing (-1)", () => {
    const actions = spyActions();
    applyHighlightKey({ key: "Home", filtered: [], highlightedIndex: -1, actions: actions });
    expect(actions.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.setHighlightedIndex).toHaveBeenCalledWith(-1);
  });

  it("Enter prevents default and selects the highlighted option", () => {
    const actions = spyActions();
    applyHighlightKey({ key: "Enter", filtered: FEW_OPTIONS, highlightedIndex: 1, actions: actions });
    expect(actions.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.selectOption).toHaveBeenCalledWith(FEW_OPTIONS[1]);
  });

  it("Enter prevents default but selects nothing when no row is highlighted", () => {
    const actions = spyActions();
    const handled = applyHighlightKey({ key: "Enter", filtered: FEW_OPTIONS, highlightedIndex: -1, actions: actions });
    expect(handled).toBe(true);
    expect(actions.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.selectOption).not.toHaveBeenCalled();
  });

  it("an unrecognized key is a no-op and reports itself unhandled", () => {
    const actions = spyActions();
    const handled = applyHighlightKey({ key: "a", filtered: FEW_OPTIONS, highlightedIndex: 0, actions: actions });
    expect(handled).toBe(false);
    expect(actions.preventDefault).not.toHaveBeenCalled();
    expect(actions.moveHighlight).not.toHaveBeenCalled();
    expect(actions.setHighlightedIndex).not.toHaveBeenCalled();
    expect(actions.selectOption).not.toHaveBeenCalled();
  });
});

describe("useSelectDropdown", () => {
  function hookProps(overrides: Partial<{ value: string; options: SelectOption[]; disabled: boolean }> = {}) {
    const props = {
      value: overrides.value ?? "",
      onChange: vi.fn(),
      options: overrides.options ?? FEW_OPTIONS,
      disabled: overrides.disabled,
    };
    const { disabled, ...required } = props;
    return [required, { disabled }] as const;
  }

  // These three pin `openPanel`'s initial-highlight branches (`ui.spec.md`'s keyboard-nav contract
  // begins from wherever this lands) — reachable only by driving the full portaled dialog before,
  // now asserted directly against the hook's own state.
  it("openPanel highlights the current value's row when it matches an option", () => {
    const { result } = renderHook(() => useSelectDropdown(...hookProps({ value: "b" })));
    act(() => result.current.openPanel());
    expect(result.current.open).toBe(true);
    expect(result.current.highlightedIndex).toBe(1); // FEW_OPTIONS[1] is "b"
  });

  it("openPanel highlights the first row when the value matches no option", () => {
    const { result } = renderHook(() => useSelectDropdown(...hookProps({ value: "does-not-exist" })));
    act(() => result.current.openPanel());
    expect(result.current.highlightedIndex).toBe(0);
  });

  it("openPanel highlights nothing when there are no options at all", () => {
    const { result } = renderHook(() => useSelectDropdown(...hookProps({ options: [] })));
    act(() => result.current.openPanel());
    expect(result.current.highlightedIndex).toBe(-1);
  });

  it("openPanel is a no-op while disabled", () => {
    const { result } = renderHook(() => useSelectDropdown(...hookProps({ disabled: true })));
    act(() => result.current.openPanel());
    expect(result.current.open).toBe(false);
  });

  // `handleTriggerKeyDown`'s own guard (`if (disabled || open) return`) is unreachable through real
  // keyboard interaction for the `open` half: once the panel opens, focus always moves off the
  // trigger (into the search input or the panel itself — see the layout effect's own comment), so
  // no real keydown ever reaches the trigger's handler while `open` is true. Calling the hook's
  // returned function directly is the honest way to pin that half of the guard rather than
  // fabricating a DOM sequence the component can't actually produce.
  it("handleTriggerKeyDown no-ops once the panel is already open, mirroring the disabled no-op", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useSelectDropdown(...hookProps({ options: FEW_OPTIONS })));
    act(() => result.current.openPanel());
    expect(result.current.open).toBe(true);
    const highlightBefore = result.current.highlightedIndex;

    act(() => {
      result.current.handleTriggerKeyDown({
        key: "Enter",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLButtonElement>);
    });

    expect(result.current.open).toBe(true); // unchanged
    expect(result.current.highlightedIndex).toBe(highlightBefore); // openPanel was not re-invoked
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closePanel resets position to null, forcing the measure-then-focus sequence to redo on the next open", () => {
    withInnerHeight(800, () => {
      const { result } = renderHook(() => useSelectDropdown(...hookProps()));
      const trigger = fakeTrigger({ top: 100, bottom: 130, left: 20, width: 200 }) as HTMLButtonElement;
      result.current.triggerRef.current = trigger;
      act(() => result.current.openPanel());
      expect(result.current.position).toMatchObject({ top: 134, left: 20, width: 200 });

      act(() => result.current.closePanel({ refocusTrigger: false }));
      expect(result.current.open).toBe(false);
      expect(result.current.position).toBeNull();

      vi.mocked(trigger.getBoundingClientRect).mockReturnValue({ top: 200, bottom: 230, left: 80, width: 240 } as DOMRect);
      act(() => result.current.openPanel());
      expect(result.current.open).toBe(true);
      expect(result.current.position).toMatchObject({ top: 234, left: 80, width: 240 });
    });
  });
});
