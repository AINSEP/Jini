import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
