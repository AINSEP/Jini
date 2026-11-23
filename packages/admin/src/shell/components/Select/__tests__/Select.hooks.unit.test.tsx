// @vitest-environment jsdom
import { act, renderHook as renderBareHook } from "@testing-library/react";
import { usePanelPosition as uiUsePanelPosition, useSelectDropdown as uiUseSelectDropdown } from "@jini-ai/ui/admin-widgets";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";

import {
  applyHighlightKey,
  buildOptionId,
  computePosition,
  edgeHighlightIndex,
  focusableInDomOrder,
  highlightedOptionOrNull,
  repositionOrClose,
  resolveTabTarget,
} from "../Select.hooks.js";
import { usePanelPosition, useSelectDropdown as useKitSelectDropdown, type WidgetSelectOption as SelectOption } from "../../../../react/kit.js";

/** Drives the kit's two-object hook from the flat fixture below (`disabled` is the optional object). */
function useSelectDropdown({ disabled, ...required }: { value: string; onChange: (value: string) => void; options: SelectOption[]; disabled?: boolean | undefined }) {
  return useKitSelectDropdown(required, { disabled });
}

/** Renders under the fake admin kit, with the real UI-library pieces these assertions are about swapped in. */
const wrapperKit = fakeAdminKit({ hooks: { usePanelPosition: uiUsePanelPosition, useSelectDropdown: uiUseSelectDropdown } });
function wrapper({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={wrapperKit}>{children}</AdminKitProvider>;
}
function renderHook<Result, Props>(callback: (props: Props) => Result, options: { initialProps?: Props } = {}) {
  return renderBareHook(callback, { ...options, wrapper });
}

/**
 * @file Host hook-adapter guards. The live helpers and their direct tests (including the original
 * extraction rationale) now belong to Jini/packages/ui/src/features/admin-widgets.
 * Historical split rationale: `Select.hooks.tsx` — the pure DOM helpers (`buildOptionId`, `computePosition`,
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

describe("useSelectDropdown", () => {
  function hookProps(overrides: Partial<{ value: string; options: SelectOption[]; disabled: boolean; onChange: (value: string) => void }> = {}) {
    return {
      value: overrides.value ?? "",
      onChange: overrides.onChange ?? vi.fn(),
      options: overrides.options ?? FEW_OPTIONS,
      disabled: overrides.disabled,
    };
  }

  // These three pin `openPanel`'s initial-highlight branches (`ui.spec.md`'s keyboard-nav contract
  // begins from wherever this lands) — reachable only by driving the full portaled dialog before,
  // now asserted directly against the hook's own state.
  it("openPanel highlights the current value's row when it matches an option", () => {
    const { result } = renderHook(() => useSelectDropdown(hookProps({ value: "b" })));
    act(() => result.current.openPanel());
    expect(result.current.open).toBe(true);
    expect(result.current.highlightedIndex).toBe(1); // FEW_OPTIONS[1] is "b"
  });

  it("openPanel highlights the first row when the value matches no option", () => {
    const { result } = renderHook(() => useSelectDropdown(hookProps({ value: "does-not-exist" })));
    act(() => result.current.openPanel());
    expect(result.current.highlightedIndex).toBe(0);
  });

  it("openPanel highlights nothing when there are no options at all", () => {
    const { result } = renderHook(() => useSelectDropdown(hookProps({ options: [] })));
    act(() => result.current.openPanel());
    expect(result.current.highlightedIndex).toBe(-1);
  });

  it("openPanel is a no-op while disabled", () => {
    const { result } = renderHook(() => useSelectDropdown(hookProps({ disabled: true })));
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
    const { result } = renderHook(() => useSelectDropdown(hookProps({ options: FEW_OPTIONS, onChange })));
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
      const { result } = renderHook(() => useSelectDropdown(hookProps()));
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

/**
 * The host-retained positional helpers (`Select.hooks.tsx` keeps them until Jini's admin-widgets
 * barrel exports its own copies). Each one is a pure decision over a trigger rect, the viewport, or
 * an option list, so they are asserted directly against plain DOM elements with stubbed rects.
 */
describe("host-retained Select helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function withViewport(size: { width: number; height: number }, run: () => void) {
    const original = { width: window.innerWidth, height: window.innerHeight };
    Object.defineProperty(window, "innerWidth", { value: size.width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: size.height, configurable: true });
    try {
      run();
    } finally {
      Object.defineProperty(window, "innerWidth", { value: original.width, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: original.height, configurable: true });
    }
  }

  /** Installs (or removes, with `null`) `document.elementFromPoint` for one assertion block. */
  function withElementFromPoint(impl: ((x: number, y: number) => Element | null) | null, run: () => void) {
    const descriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    if (impl) Object.defineProperty(document, "elementFromPoint", { value: impl, configurable: true });
    try {
      run();
    } finally {
      if (descriptor) Object.defineProperty(document, "elementFromPoint", descriptor);
      else delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    }
  }

  it("buildOptionId shares one id scheme between the option row and aria-activedescendant", () => {
    expect(buildOptionId({ listboxId: "lb-1", index: 3 })).toBe("lb-1-option-3");
  });

  describe("focusableInDomOrder", () => {
    it("returns every enabled focusable node in DOM order, skipping disabled and tabindex=-1 nodes", () => {
      document.body.innerHTML = `
        <a id="link" href="#x">x</a>
        <button id="off" disabled>off</button>
        <button id="on">on</button>
        <input id="field" />
        <div id="skip" tabindex="-1"></div>
        <div id="tab" tabindex="0"></div>`;
      expect(focusableInDomOrder({ exclude: null }).map((el) => el.id)).toEqual(["link", "on", "field", "tab"]);
    });

    it("leaves out everything inside the excluded subtree (the portaled panel)", () => {
      document.body.innerHTML = `<button id="before">b</button><div id="panel"><button id="inside">i</button></div><button id="after">a</button>`;
      const panel = document.getElementById("panel")!;
      expect(focusableInDomOrder({ exclude: panel }).map((el) => el.id)).toEqual(["before", "after"]);
    });
  });

  describe("computePosition", () => {
    it("opens downward below the trigger when there is room for the estimated panel", () => {
      withInnerHeight(800, () => {
        expect(computePosition({ trigger: fakeTrigger({ top: 100, bottom: 130, left: 20, width: 200 }) })).toEqual({
          top: 134,
          left: 20,
          width: 200,
          maxHeight: 662,
        });
      });
    });

    it("opens upward when the room below is short and there is more room above", () => {
      withInnerHeight(800, () => {
        expect(computePosition({ trigger: fakeTrigger({ top: 700, bottom: 730, left: 5, width: 150 }) })).toEqual({
          bottom: 104,
          left: 5,
          width: 150,
          maxHeight: 692,
        });
      });
    });

    it("stays downward when space below is short but space above is shorter still", () => {
      withInnerHeight(200, () => {
        const position = computePosition({ trigger: fakeTrigger({ top: 40, bottom: 70, left: 0, width: 100 }) });
        expect(position).toMatchObject({ top: 74 });
        // 130 px of real room below, minus the 8 px of gaps, is above the 120 px floor.
        expect(position.maxHeight).toBe(122);
      });
    });

    it("never shrinks maxHeight below the 120 px floor, in either direction", () => {
      withInnerHeight(150, () => {
        expect(computePosition({ trigger: fakeTrigger({ top: 10, bottom: 40, left: 0, width: 100 }) }).maxHeight).toBe(120);
        expect(computePosition({ trigger: fakeTrigger({ top: 100, bottom: 130, left: 0, width: 100 }) })).toMatchObject({
          bottom: 54,
          maxHeight: 120,
        });
      });
    });
  });

  describe("repositionOrClose", () => {
    const inView = { top: 100, bottom: 130, left: 20, right: 220, width: 200, height: 30 };

    it.each([
      ["scrolled above the viewport", { ...inView, top: -40, bottom: 0 }],
      ["scrolled below the viewport", { ...inView, top: 600, bottom: 630 }],
      ["scrolled off the left edge", { ...inView, left: -200, right: 0 }],
      ["scrolled off the right edge", { ...inView, left: 800, right: 1000 }],
    ])("closes instead of repositioning when the trigger is %s", (_label, rect) => {
      withViewport({ width: 800, height: 600 }, () => {
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        repositionOrClose({ trigger: fakeTrigger(rect), onOutOfView, setPosition });
        expect(onOutOfView).toHaveBeenCalledTimes(1);
        expect(setPosition).not.toHaveBeenCalled();
      });
    });

    it("falls back to the viewport check alone where elementFromPoint is not implemented", () => {
      withViewport({ width: 800, height: 600 }, () => {
        withElementFromPoint(null, () => {
          expect(typeof document.elementFromPoint).not.toBe("function");
          const onOutOfView = vi.fn();
          const setPosition = vi.fn();
          repositionOrClose({ trigger: fakeTrigger(inView), onOutOfView, setPosition });
          expect(onOutOfView).not.toHaveBeenCalled();
          expect(setPosition).toHaveBeenCalledWith({ top: 134, left: 20, width: 200, maxHeight: 462 });
        });
      });
    });

    it("probes the trigger's own center point", () => {
      withViewport({ width: 800, height: 600 }, () => {
        const trigger = fakeTrigger(inView);
        const probe = vi.fn((_x: number, _y: number) => trigger as Element);
        withElementFromPoint(probe, () => {
          repositionOrClose({ trigger, onOutOfView: vi.fn(), setPosition: vi.fn() });
        });
        expect(probe).toHaveBeenCalledWith(120, 115);
      });
    });

    it("repositions when the topmost element at the center is inside the trigger", () => {
      withViewport({ width: 800, height: 600 }, () => {
        const trigger = fakeTrigger(inView);
        const label = document.createElement("span");
        trigger.appendChild(label);
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        withElementFromPoint(() => label, () => repositionOrClose({ trigger, onOutOfView, setPosition }));
        expect(onOutOfView).not.toHaveBeenCalled();
        expect(setPosition).toHaveBeenCalledTimes(1);
      });
    });

    it("repositions when the topmost element at the center is an ancestor of the trigger", () => {
      withViewport({ width: 800, height: 600 }, () => {
        const trigger = fakeTrigger(inView);
        const wrapper = document.createElement("div");
        wrapper.appendChild(trigger);
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        withElementFromPoint(() => wrapper, () => repositionOrClose({ trigger, onOutOfView, setPosition }));
        expect(onOutOfView).not.toHaveBeenCalled();
        expect(setPosition).toHaveBeenCalledTimes(1);
      });
    });

    it("closes when an unrelated element covers the trigger's center (clipped by an ancestor)", () => {
      withViewport({ width: 800, height: 600 }, () => {
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        withElementFromPoint(() => document.createElement("div"), () =>
          repositionOrClose({ trigger: fakeTrigger(inView), onOutOfView, setPosition }),
        );
        expect(onOutOfView).toHaveBeenCalledTimes(1);
        expect(setPosition).not.toHaveBeenCalled();
      });
    });

    it("closes when nothing at all is rendered at the trigger's center", () => {
      withViewport({ width: 800, height: 600 }, () => {
        const onOutOfView = vi.fn();
        const setPosition = vi.fn();
        withElementFromPoint(() => null, () => repositionOrClose({ trigger: fakeTrigger(inView), onOutOfView, setPosition }));
        expect(onOutOfView).toHaveBeenCalledTimes(1);
        expect(setPosition).not.toHaveBeenCalled();
      });
    });
  });

  describe("resolveTabTarget", () => {
    function layout() {
      document.body.innerHTML = `<button id="prev">p</button><button id="trigger">t</button><button id="next">n</button><div id="panel"><button id="opt">o</button></div>`;
      return {
        trigger: document.getElementById("trigger")!,
        panel: document.getElementById("panel")!,
      };
    }

    it("returns the trigger's next DOM-order neighbour on Tab and its previous one on Shift+Tab", () => {
      const { trigger, panel } = layout();
      expect(resolveTabTarget({ panel, trigger, shiftKey: false })?.id).toBe("next");
      expect(resolveTabTarget({ panel, trigger, shiftKey: true })?.id).toBe("prev");
    });

    it("returns null when there is no neighbour in that direction", () => {
      document.body.innerHTML = `<button id="trigger">t</button>`;
      const trigger = document.getElementById("trigger")!;
      expect(resolveTabTarget({ panel: null, trigger, shiftKey: false })).toBeNull();
      expect(resolveTabTarget({ panel: null, trigger, shiftKey: true })).toBeNull();
    });

    it("returns null (do not move focus) when the trigger is missing or no longer focusable", () => {
      const { trigger, panel } = layout();
      expect(resolveTabTarget({ panel, trigger: null, shiftKey: false })).toBeNull();
      trigger.setAttribute("disabled", "");
      expect(resolveTabTarget({ panel, trigger, shiftKey: false })).toBeNull();
    });
  });

  it("edgeHighlightIndex picks the first/last row, or -1 for an empty list", () => {
    expect(edgeHighlightIndex({ filteredLength: 3, edge: "first" })).toBe(0);
    expect(edgeHighlightIndex({ filteredLength: 3, edge: "last" })).toBe(2);
    expect(edgeHighlightIndex({ filteredLength: 0, edge: "first" })).toBe(-1);
    expect(edgeHighlightIndex({ filteredLength: 0, edge: "last" })).toBe(-1);
  });

  it("highlightedOptionOrNull returns the highlighted row, or null for -1 or a stale index", () => {
    expect(highlightedOptionOrNull({ filtered: FEW_OPTIONS, highlightedIndex: 1 })).toEqual(FEW_OPTIONS[1]);
    expect(highlightedOptionOrNull({ filtered: FEW_OPTIONS, highlightedIndex: -1 })).toBeNull();
    expect(highlightedOptionOrNull({ filtered: FEW_OPTIONS, highlightedIndex: 7 })).toBeNull();
  });

  describe("applyHighlightKey", () => {
    function recordingActions() {
      const calls: string[] = [];
      return {
        calls,
        actions: {
          preventDefault: () => calls.push("preventDefault"),
          moveHighlight: (delta: 1 | -1) => calls.push(`move ${delta}`),
          setHighlightedIndex: (index: number) => calls.push(`set ${index}`),
          selectOption: (option: SelectOption) => calls.push(`select ${option.value}`),
        },
      };
    }

    it.each([
      ["ArrowDown", 0, ["preventDefault", "move 1"]],
      ["ArrowUp", 0, ["preventDefault", "move -1"]],
      ["Home", 2, ["preventDefault", "set 0"]],
      ["End", 0, ["preventDefault", "set 2"]],
      ["Enter", 2, ["preventDefault", "select c"]],
    ])("%s prevents the default before applying its highlight change", (key, highlighted, expected) => {
      const { calls, actions } = recordingActions();
      expect(applyHighlightKey({ key, filtered: FEW_OPTIONS, highlightedIndex: highlighted, actions })).toBe(true);
      expect(calls).toEqual(expected);
    });

    it("Enter still prevents the default but selects nothing when no row is highlighted", () => {
      const { calls, actions } = recordingActions();
      expect(applyHighlightKey({ key: "Enter", filtered: FEW_OPTIONS, highlightedIndex: -1, actions })).toBe(true);
      expect(calls).toEqual(["preventDefault"]);
    });

    it("reports an unhandled key as not recognized and does nothing", () => {
      const { calls, actions } = recordingActions();
      expect(applyHighlightKey({ key: "a", filtered: FEW_OPTIONS, highlightedIndex: 0, actions })).toBe(false);
      expect(calls).toEqual([]);
    });
  });
});
