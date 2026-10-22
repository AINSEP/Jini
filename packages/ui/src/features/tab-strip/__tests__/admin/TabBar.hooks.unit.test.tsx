import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabBar, type TabBarTab } from "../../react/components/TabBar.js";
import { resolveTabBarKeyTarget, useTabBarKeyboard } from "../../react/components/TabBar.hooks.js";

const tabs: readonly TabBarTab[] = [
  { id: "disabled-first", label: "Disabled first", disabled: true },
  { id: "middle", label: "Middle" },
  { id: "disabled-middle", label: "Disabled middle", disabled: true },
  { id: "last", label: "Last" },
];

describe("TabBar keyboard edge destinations", () => {
  // F4.3/F6.2: destinations are literal source-array indices with disabled entries at both ends.
  it.each([
    ["unknown", "ArrowLeft", 3], ["unknown", "ArrowRight", 1],
    ["disabled-first", "ArrowLeft", 3], ["disabled-first", "ArrowRight", 1],
    ["middle", "ArrowLeft", 3], ["last", "ArrowRight", 1],
    ["last", "ArrowLeft", 1],
    ["last", "Home", 1], ["middle", "End", 3],
  ])("%s with %s targets enabled index %s", (activeId, key, expected) => {
    expect(resolveTabBarKeyTarget({ tabs: tabs, activeId: activeId as string, key: key as string })).toBe(expected);
  });

  it.each(["ArrowRight", "ArrowLeft", "Home", "End"])("has no %s target for an empty or wholly disabled row", (key) => {
    expect(resolveTabBarKeyTarget({ tabs: [], activeId: "unknown", key: key })).toBeNull();
    expect(resolveTabBarKeyTarget({ tabs: [{ id: "only", label: "Only", disabled: true }], activeId: "only", key: key })).toBeNull();
  });
});

function MixedControls({ onChange }: { onChange: (id: string) => void }) {
  const { onKeyDown } = useTabBarKeyboard({ tabs: tabs, activeId: "middle", onChange: onChange });
  return (
    <div role="tablist" aria-label="Mixed controls" onKeyDown={onKeyDown}>
      <button type="button">Add provider</button>
      {tabs.map((tab) => <button key={tab.id} role="tab" disabled={tab.disabled}><span>{tab.label}</span></button>)}
    </div>
  );
}

describe("TabBar key origin guard", () => {
  // Author Checklist F2.1/F2.5/F3.1/F6.2: the real handler and DOM focus run;
  // only the callback boundary is recorded, with exact delivery. Each test owns its state.
  // Mutation rejected: backward movement uses activeIndex - 1 except at wraparound,
  // selecting disabled-middle instead of middle. No product-source mutation is permitted.
  it("moves backward across a disabled middle tab, delivering and focusing the enabled destination", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} activeId="last" onChange={onChange} ariaLabel="Available tabs" />);
    const middle = screen.getByRole("tab", { name: "Middle" });
    expect(screen.getByRole("tab", { name: "Disabled middle" })).toBeDisabled();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Last" }));
    await user.keyboard("{ArrowLeft}");
    expect(onChange.mock.calls).toEqual([["middle"]]);
    expect(document.activeElement).toBe(middle);
  });

  // F2.1/F3.1/F5.2: execute the real handler through DOM events; assert actual focus and exact delivery.
  // Removing the closest('[role=tab]') guard would steal focus from Add provider.
  it("leaves a non-tab control's navigation keys alone, but navigates after clicking a tab label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MixedControls onChange={onChange} />);
    const add = screen.getByRole("button", { name: "Add provider" });
    await user.tab();
    expect(document.activeElement).toBe(add);
    await user.keyboard("{ArrowRight}{ArrowLeft}{Home}{End}");
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(add);

    await user.click(screen.getByText("Middle"));
    await user.keyboard("{ArrowRight}");
    expect(onChange.mock.calls).toEqual([["last"]]);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Last" }));
  });

  // BUG regression, F3.1/F6.2: a stale activeId pointing at a newly disabled tab must not
  // remove every enabled tab from sequential keyboard navigation. No programmatic focus shortcut.
  it("keeps an enabled tab reachable by Tab after the selected tab becomes disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Row({ disabled }: { disabled: boolean }) {
      return <>
        <button>Before tabs</button>
        <TabBar tabs={[{ id: "a", label: "A", disabled }, { id: "b", label: "B" }]} activeId="a" onChange={onChange} ariaLabel="Available tabs" />
        <button>After tabs</button>
      </>;
    }
    const { rerender } = render(<Row disabled={false} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Before tabs" }));
    rerender(<Row disabled />);
    expect(screen.getByRole("tab", { name: "A" })).toBeDisabled();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "B" }));
  });
});

describe("TabBar active tab in view", () => {
  // jsdom has no layout: stub the strip's overflow, each tab's box (by label) and a writable
  // scrollLeft so the hook's arithmetic is observable.
  const scrollLeftDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft")!;
  const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
  const scrollLeft = new WeakMap<Element, number>();
  function stubLayout({ overflow, boxes }: { overflow: boolean; boxes: Record<string, [number, number]> }) {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(overflow ? 600 : 300);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const [left, right] = this.getAttribute("role") === "tablist" ? [0, 300] : boxes[this.textContent ?? ""] ?? [0, 0];
      return { left, right, top: 0, bottom: 40, width: right - left, height: 40, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    Object.defineProperty(Element.prototype, "scrollLeft", {
      configurable: true,
      get(this: Element) { return scrollLeft.get(this) ?? 0; },
      set(this: Element, value: number) { scrollLeft.set(this, value); },
    });
  }
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(Element.prototype, "scrollLeft", scrollLeftDescriptor);
    if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
    else Reflect.deleteProperty(document, "fonts");
  });
  const row: readonly TabBarTab[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];

  it("scrolls again when fonts become ready after mount and change the active tab's width", async () => {
    let resolveFonts!: () => void;
    const ready = new Promise<void>((resolve) => { resolveFonts = resolve; });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    const boxes: Record<string, [number, number]> = { C: [280, 380] };
    stubLayout({ overflow: true, boxes });
    render(<TabBar tabs={row} activeId="c" onChange={() => {}} ariaLabel="Sections" />);
    const strip = screen.getByRole("tablist");
    expect(strip.scrollLeft).toBe(80);

    // The font adds 40px of width after the initial 80px scroll.
    boxes.C = [200, 340];
    await act(async () => { resolveFonts(); });
    expect(strip.scrollLeft).toBe(120);
  });

  it("ignores font readiness after unmount", async () => {
    let resolveFonts!: () => void;
    const ready = new Promise<void>((resolve) => { resolveFonts = resolve; });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    stubLayout({ overflow: true, boxes: { C: [280, 380] } });
    const { unmount } = render(<TabBar tabs={row} activeId="c" onChange={() => {}} ariaLabel="Sections" />);
    const strip = screen.getByRole("tablist");
    expect(strip.scrollLeft).toBe(80);
    unmount();

    await act(async () => { resolveFonts(); });
    expect(strip.scrollLeft).toBe(80);
  });

  it("scrolls the strip so a deep-linked tab past the right edge, then one past the left edge, is fully shown", () => {
    stubLayout({ overflow: true, boxes: { A: [-50, 20], B: [20, 280], C: [280, 380] } });
    const { rerender } = render(<TabBar tabs={row} activeId="c" onChange={() => {}} ariaLabel="Sections" />);
    const strip = screen.getByRole("tablist");
    expect(strip.scrollLeft).toBe(80);
    rerender(<TabBar tabs={row} activeId="a" onChange={() => {}} ariaLabel="Sections" />);
    expect(strip.scrollLeft).toBe(30);
  });

  it("leaves an already-visible tab where it is", () => {
    stubLayout({ overflow: true, boxes: { B: [20, 280] } });
    render(<TabBar tabs={row} activeId="b" onChange={() => {}} ariaLabel="Visible" />);
    expect(screen.getByRole("tablist").scrollLeft).toBe(0);
  });

  it("leaves a wrapping strip (no horizontal overflow) alone", () => {
    stubLayout({ overflow: false, boxes: { C: [280, 380] } });
    render(<TabBar tabs={row} activeId="c" onChange={() => {}} ariaLabel="Wrapping" />);
    expect(screen.getByRole("tablist").scrollLeft).toBe(0);
  });
});
