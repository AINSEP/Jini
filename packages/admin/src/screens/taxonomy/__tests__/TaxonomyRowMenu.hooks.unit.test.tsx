// @vitest-environment jsdom
import { act, fireEvent, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaxonomyRowMenu } from "../TaxonomyRowMenu.hooks.js";

/**
 * Hook-level edges the component suite (`TaxonomyRowMenu.unit.test.tsx`) cannot reach through the
 * rendered menu: viewport flipping/clamping, a trigger that never mounted, inside-vs-outside
 * pointer targets, and keys the menu must ignore. Real DOM nodes are attached to the hook's own
 * refs; only geometry (which jsdom does not lay out) is pinned.
 */

type Hook = ReturnType<typeof useTaxonomyRowMenu>;

const nodes: HTMLElement[] = [];
afterEach(() => {
  for (const node of nodes.splice(0)) node.remove();
  vi.restoreAllMocks();
});

function key(name: string) {
  const preventDefault = vi.fn();
  return { event: { key: name, preventDefault } as unknown as KeyboardEvent<HTMLButtonElement & HTMLDivElement>, preventDefault };
}

function attach(hook: Hook, { rect, menu = { width: 120, height: 90 } }: { rect: Partial<DOMRect>; menu?: { width: number; height: number } | null }) {
  const trigger = document.createElement("button");
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...rect });
  document.body.append(trigger);
  nodes.push(trigger);
  (hook.triggerRef as { current: HTMLButtonElement | null }).current = trigger;
  if (menu) {
    const popup = document.createElement("div");
    Object.defineProperty(popup, "offsetHeight", { value: menu.height });
    Object.defineProperty(popup, "offsetWidth", { value: menu.width });
    const item = document.createElement("button");
    popup.append(item);
    document.body.append(popup);
    nodes.push(popup);
    (hook.menuRef as { current: HTMLDivElement | null }).current = popup;
    return { trigger, popup, item };
  }
  return { trigger, popup: null, item: null };
}

describe("useTaxonomyRowMenu", () => {
  it("opens below the trigger, right-aligned to it, when the viewport has room", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 2 }));
    attach(result.current, { rect: { top: 100, bottom: 120, right: 400 } });
    act(() => result.current.onTriggerClick());
    // 768 - 120 = 648 >= 90 + 8, so below: bottom + 4; left = right - width.
    expect(result.current.position).toEqual({ top: 124, left: 280, placement: "below" });
  });

  it("flips above when there is no room below but room above", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 2 }));
    attach(result.current, { rect: { top: 700, bottom: 720, right: 400 } });
    act(() => result.current.onTriggerClick());
    expect(result.current.position).toEqual({ top: 696, left: 280, placement: "above" });
  });

  it("stays below when there is room neither below nor above", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 2 }));
    attach(result.current, { rect: { top: 50, bottom: 70, right: 400 }, menu: { width: 120, height: 760 } });
    act(() => result.current.onTriggerClick());
    expect(result.current.position).toEqual({ top: 74, left: 280, placement: "below" });
  });

  it("clamps the popup inside the viewport's 8px gutters on both sides", () => {
    const left = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    attach(left.result.current, { rect: { top: 10, bottom: 30, right: 40 } });
    act(() => left.result.current.onTriggerClick());
    expect(left.result.current.position?.left).toBe(8);

    const right = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    attach(right.result.current, { rect: { top: 10, bottom: 30, right: 2000 } });
    act(() => right.result.current.onTriggerClick());
    // innerWidth 1024 - width 120 - 8.
    expect(right.result.current.position?.left).toBe(896);
  });

  it("measures an unmounted popup as zero-sized", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    attach(result.current, { rect: { top: 10, bottom: 30, right: 300 }, menu: null });
    act(() => result.current.onTriggerClick());
    expect(result.current.position).toEqual({ top: 34, left: 300, placement: "below" });
  });

  it("opens without a position while its trigger is not mounted, and Escape still closes", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 2 }));
    act(() => result.current.onTriggerClick());
    expect(result.current.open).toBe(true);
    expect(result.current.position).toBeNull();
    fireEvent.scroll(window);
    expect(result.current.position).toBeNull();
    const escape = key("Escape");
    act(() => result.current.onMenuKeyDown(escape.event));
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(result.current.open).toBe(false);
  });

  it("stops following resize after closing", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    const { trigger } = attach(result.current, { rect: { top: 100, bottom: 120, right: 400 } });
    act(() => result.current.onTriggerClick());
    expect(result.current.position?.top).toBe(124);
    vi.mocked(trigger.getBoundingClientRect).mockReturnValue({ top: 200, bottom: 220, left: 0, right: 400, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(result.current.position?.top).toBe(224);
    act(() => result.current.onTriggerClick());
    expect(result.current.position).toBeNull();
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(result.current.position).toBeNull();
  });

  it("treats presses inside the popup or on the trigger as inside, and anything else as outside", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    const { trigger, item } = attach(result.current, { rect: { top: 100, bottom: 120, right: 400 } });
    act(() => result.current.onTriggerClick());
    fireEvent.mouseDown(item!);
    expect(result.current.open).toBe(true);
    fireEvent.mouseDown(trigger);
    expect(result.current.open).toBe(true);
    trigger.blur();
    fireEvent.mouseDown(document.body);
    expect(result.current.open).toBe(false);
    // Outside close leaves focus where the press put it, not on the trigger.
    expect(document.activeElement).not.toBe(trigger);
  });

  it("closes as outside when neither the popup nor the trigger is mounted", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    act(() => result.current.onTriggerClick());
    fireEvent.mouseDown(document.body);
    expect(result.current.open).toBe(false);
  });

  it("toggles closed from the trigger without moving focus back to it", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    const { trigger } = attach(result.current, { rect: { top: 100, bottom: 120, right: 400 } });
    act(() => result.current.onTriggerClick());
    trigger.blur();
    act(() => result.current.onTriggerClick());
    expect(result.current.open).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("returns focus to the trigger when an action is selected, before running it", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 1 }));
    const { trigger } = attach(result.current, { rect: { top: 100, bottom: 120, right: 400 } });
    act(() => result.current.onTriggerClick());
    const seen: { open: boolean; focused: boolean }[] = [];
    act(() => result.current.selectItem({ onSelect: () => seen.push({ open: result.current.open, focused: document.activeElement === trigger }) }));
    expect(seen).toEqual([{ open: true, focused: true }]);
    expect(result.current.open).toBe(false);
  });

  it("opens at the last item with ArrowUp and ignores other trigger keys", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 3 }));
    const items = [0, 1, 2].map(() => document.createElement("button"));
    for (const item of items) { document.body.append(item); nodes.push(item); }
    result.current.itemRefs.current = items;
    const enter = key("Enter");
    act(() => result.current.onTriggerKeyDown(enter.event));
    expect(result.current.open).toBe(false);
    expect(enter.preventDefault).not.toHaveBeenCalled();
    const up = key("ArrowUp");
    act(() => result.current.onTriggerKeyDown(up.event));
    expect(up.preventDefault).toHaveBeenCalledOnce();
    expect(result.current.open).toBe(true);
    expect(document.activeElement).toBe(items[2]);
    act(() => result.current.onTriggerClick());
    const down = key("ArrowDown");
    act(() => result.current.onTriggerKeyDown(down.event));
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(items[0]);
  });

  it("ignores unrelated menu keys and lets Tab leave without preventing default", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 2 }));
    act(() => result.current.onTriggerClick());
    const letter = key("a");
    act(() => result.current.onMenuKeyDown(letter.event));
    expect(letter.preventDefault).not.toHaveBeenCalled();
    expect(result.current.open).toBe(true);
    const tab = key("Tab");
    act(() => result.current.onMenuKeyDown(tab.event));
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it("wraps ArrowDown/ArrowUp and jumps with Home/End, focusing the active item", () => {
    const { result } = renderHook(() => useTaxonomyRowMenu({ itemCount: 3 }));
    const items = [0, 1, 2].map(() => document.createElement("button"));
    for (const item of items) { document.body.append(item); nodes.push(item); }
    result.current.itemRefs.current = items;
    act(() => result.current.onTriggerClick());
    expect(document.activeElement).toBe(items[0]);
    const steps: [string, number][] = [["ArrowUp", 2], ["ArrowDown", 0], ["ArrowDown", 1], ["End", 2], ["Home", 0]];
    for (const [name, expected] of steps) {
      const press = key(name);
      act(() => result.current.onMenuKeyDown(press.event));
      expect(press.preventDefault).toHaveBeenCalledOnce();
      expect(document.activeElement, name).toBe(items[expected]);
    }
  });

  it("drops item refs beyond the current item count", () => {
    let count = 3;
    const { result, rerender } = renderHook(() => useTaxonomyRowMenu({ itemCount: count }));
    result.current.itemRefs.current = [document.createElement("button"), document.createElement("button"), document.createElement("button")];
    count = 1;
    rerender();
    expect(result.current.itemRefs.current).toHaveLength(1);
  });
});
