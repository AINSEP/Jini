import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TabBar, type TabBarTab } from "../../react/components/TabBar";

/**
 * @file First dedicated test file for `TabBar.tsx` (0% before this pass — no existing suite
 * mounts it directly; `Themes.tsx`/`Pages.tsx`/`Deployment.tsx`/etc. exercise it only through
 * their own default tab configs, which never combine every optional prop at once). Covers every
 * optional `TabBarTab` field (`icon`, `count`, `disabled`, `handle`/`handleLabel`,
 * `dot`/`dotLabel`) and `TabBarProps.containerHandle`, plus the interaction and a11y contracts the
 * React Component Testing Policy requires.
 */

const AGENT_ELEMENT = "data-agent-element";
const AGENT_ROLE = "data-agent-role";
const AGENT_LABEL = "data-agent-label";

const BASE_TABS: readonly TabBarTab[] = [
  { id: "a", label: "Tab A" },
  { id: "b", label: "Tab B" },
];

describe("TabBar — render", () => {
  it("renders a tablist with one tab per entry, aria-selected on the active one", () => {
    render(<TabBar tabs={BASE_TABS} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    const tablist = screen.getByRole("tablist", { name: "My tabs" });
    expect(tablist).toBeInTheDocument();
    const tabA = screen.getByRole("tab", { name: "Tab A" });
    const tabB = screen.getByRole("tab", { name: "Tab B" });
    expect(tabA).toHaveAttribute("aria-selected", "true");
    expect(tabB).toHaveAttribute("aria-selected", "false");
  });

  it("renders an icon before the label only when the tab has one", () => {
    const tabs: TabBarTab[] = [
      { id: "a", label: "Tab A", icon: <svg data-testid="tab-a-icon" /> },
      { id: "b", label: "Tab B" },
    ];
    render(<TabBar tabs={tabs} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    expect(screen.getByTestId("tab-a-icon")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tab B" }).querySelector(".tab-bar-icon")).not.toBeInTheDocument();
  });

  it("renders a count badge only when count is defined", () => {
    const tabs: TabBarTab[] = [
      { id: "a", label: "Tab A", count: 3 },
      { id: "b", label: "Tab B" },
    ];
    render(<TabBar tabs={tabs} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    // The count renders as visible text inside the button, so it's part of the tab's own
    // accessible name ("Tab A3") — matched by substring here rather than asserting the exact
    // concatenated string, which is an implementation detail of the DOM order, not the contract.
    expect(screen.getByRole("tab", { name: /Tab A/ }).querySelector(".tab-bar-count")).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: "Tab B" }).querySelector(".tab-bar-count")).not.toBeInTheDocument();
  });

  it("renders an empty tablist without crashing when there are no tabs (empty-state edge case)", () => {
    render(<TabBar tabs={[]} activeId="" onChange={vi.fn()} ariaLabel="My tabs" />);

    expect(screen.getByRole("tablist", { name: "My tabs" })).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});

describe("TabBar — disabled tabs", () => {
  it("marks a disabled tab aria-disabled and native-disabled, and never calls onChange for it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const tabs: TabBarTab[] = [{ id: "a", label: "Tab A", disabled: true }, { id: "b", label: "Tab B" }];
    render(<TabBar tabs={tabs} activeId="b" onChange={onChange} ariaLabel="My tabs" />);

    const disabledTab = screen.getByRole("tab", { name: "Tab A" });
    expect(disabledTab).toBeDisabled();
    expect(disabledTab).toHaveAttribute("aria-disabled", "true");

    await user.click(disabledTab);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with the tab id when a non-disabled tab is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={BASE_TABS} activeId="a" onChange={onChange} ariaLabel="My tabs" />);

    await user.click(screen.getByRole("tab", { name: "Tab B" }));

    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("TabBar — dot signifier", () => {
  it("renders the visual dot and an accessible-name suffix when dot and dotLabel are both set", () => {
    const tabs: TabBarTab[] = [{ id: "a", label: "GitHub Pages", dot: true, dotLabel: "Connected" }];
    render(<TabBar tabs={tabs} activeId="a" onChange={vi.fn()} ariaLabel="Providers" />);

    const tab = screen.getByRole("tab", { name: "GitHub Pages, Connected" });
    expect(tab.querySelector(".tab-bar-dot")).toBeInTheDocument();
  });

  it("renders the visual dot but no accessible suffix when dot is set without a dotLabel", () => {
    const tabs: TabBarTab[] = [{ id: "a", label: "GitHub Pages", dot: true }];
    render(<TabBar tabs={tabs} activeId="a" onChange={vi.fn()} ariaLabel="Providers" />);

    const tab = screen.getByRole("tab", { name: "GitHub Pages" });
    expect(tab.querySelector(".tab-bar-dot")).toBeInTheDocument();
    expect(tab.querySelector(".visually-hidden")).not.toBeInTheDocument();
  });

  it("renders neither the dot nor the suffix when dot is not set", () => {
    render(<TabBar tabs={BASE_TABS} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    expect(screen.getByRole("tab", { name: "Tab A" }).querySelector(".tab-bar-dot")).not.toBeInTheDocument();
  });
});

describe("TabBar — agent handles", () => {
  it("publishes a tab's own agent handle, defaulting handleLabel to its label", () => {
    const tabs: TabBarTab[] = [{ id: "a", label: "Tab A", handle: "tab-a" }];
    render(<TabBar tabs={tabs} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    const tab = screen.getByRole("tab", { name: "Tab A" });
    expect(tab).toHaveAttribute(AGENT_ELEMENT, "tab-a");
    expect(tab).toHaveAttribute(AGENT_ROLE, "button");
    expect(tab).toHaveAttribute(AGENT_LABEL, "Tab A");
  });

  it("prefers an explicit handleLabel over the tab's label", () => {
    const tabs: TabBarTab[] = [{ id: "a", label: "Tab A", handle: "tab-a", handleLabel: "Switch to Tab A" }];
    render(<TabBar tabs={tabs} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    expect(screen.getByRole("tab", { name: "Tab A" })).toHaveAttribute(AGENT_LABEL, "Switch to Tab A");
  });

  it("leaves an untagged tab with no agent-handle attributes", () => {
    render(<TabBar tabs={BASE_TABS} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    expect(screen.getByRole("tab", { name: "Tab A" })).not.toHaveAttribute(AGENT_ELEMENT);
  });

  it("publishes the tablist container's own agent handle only when containerHandle is set", () => {
    const { rerender } = render(
      <TabBar tabs={BASE_TABS} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" containerHandle="my-tabs" />,
    );

    const tablist = screen.getByRole("tablist", { name: "My tabs" });
    expect(tablist).toHaveAttribute(AGENT_ELEMENT, "my-tabs");
    expect(tablist).toHaveAttribute(AGENT_ROLE, "region");
    expect(tablist).toHaveAttribute(AGENT_LABEL, "My tabs");

    rerender(<TabBar tabs={BASE_TABS} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);
    expect(screen.getByRole("tablist", { name: "My tabs" })).not.toHaveAttribute(AGENT_ELEMENT);
  });
});

describe("TabBar — keyboard (WAI-ARIA tabs)", () => {
  const THREE_TABS: readonly TabBarTab[] = [
    { id: "a", label: "Tab A" },
    { id: "b", label: "Tab B" },
    { id: "c", label: "Tab C" },
  ];

  it("moves focus and calls onChange to the next tab on ArrowRight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={THREE_TABS} activeId="a" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab A" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("b");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab B" }));
  });

  it("moves focus to the previous tab on ArrowLeft", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={THREE_TABS} activeId="b" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab B" }).focus();
    await user.keyboard("{ArrowLeft}");

    expect(onChange).toHaveBeenCalledWith("a");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab A" }));
  });

  it("wraps from the last tab to the first on ArrowRight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={THREE_TABS} activeId="c" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab C" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("a");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab A" }));
  });

  it("wraps from the first tab to the last on ArrowLeft", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={THREE_TABS} activeId="a" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab A" }).focus();
    await user.keyboard("{ArrowLeft}");

    expect(onChange).toHaveBeenCalledWith("c");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab C" }));
  });

  it("moves focus to the first tab on Home and the last tab on End", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={THREE_TABS} activeId="b" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab B" }).focus();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab A" }));

    screen.getByRole("tab", { name: "Tab A" }).focus();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab C" }));
  });

  it("skips a disabled tab when moving with ArrowRight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const tabs: TabBarTab[] = [
      { id: "a", label: "Tab A" },
      { id: "b", label: "Tab B", disabled: true },
      { id: "c", label: "Tab C" },
    ];
    render(<TabBar tabs={tabs} activeId="a" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab A" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("c");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab C" }));
  });

  it("moves to the first enabled tab on ArrowRight when activeId matches no tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={THREE_TABS} activeId="does-not-exist" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab A" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("ignores keys other than ArrowLeft/ArrowRight/Home/End", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabBar tabs={THREE_TABS} activeId="a" onChange={onChange} ariaLabel="My tabs" />);

    screen.getByRole("tab", { name: "Tab A" }).focus();
    await user.keyboard("{ArrowDown}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives the active tab a roving tabindex of 0 and every other tab -1", () => {
    render(<TabBar tabs={THREE_TABS} activeId="a" onChange={vi.fn()} ariaLabel="My tabs" />);

    expect(screen.getByRole("tab", { name: "Tab A" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Tab B" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: "Tab C" })).toHaveAttribute("tabindex", "-1");
  });

  it("gives the first enabled tab tabindex 0 when activeId matches no tab", () => {
    render(<TabBar tabs={THREE_TABS} activeId="does-not-exist" onChange={vi.fn()} ariaLabel="My tabs" />);

    expect(screen.getByRole("tab", { name: "Tab A" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Tab B" })).toHaveAttribute("tabindex", "-1");
  });
});
