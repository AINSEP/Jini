import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TabBar, type TabBarTab } from "../TabBar.js";

interface LabelCase {
  name: string;
  decoration: Partial<TabBarTab>;
  expected: string | null;
}

const LABEL_CASES: readonly LabelCase[] = [
  { name: "ignores dotLabel when dot is omitted", decoration: { dotLabel: "Connected" }, expected: null },
  { name: "ignores dotLabel when dot is false", decoration: { dot: false, dotLabel: "Connected" }, expected: null },
  { name: "uses DOM naming when dotLabel is omitted", decoration: { dot: true }, expected: null },
  { name: "uses DOM naming when dotLabel is empty", decoration: { dot: true, dotLabel: "" }, expected: null },
  { name: "omits undefined tag and count", decoration: { dot: true, dotLabel: "Connected" }, expected: "Provider, Connected" },
  { name: "includes a tag without a count", decoration: { dot: true, dotLabel: "Connected", tag: "Soon" }, expected: "Provider, Connected Soon" },
  { name: "includes zero without a tag", decoration: { dot: true, dotLabel: "Connected", count: 0 }, expected: "Provider, Connected 0" },
  { name: "includes tag before count", decoration: { dot: true, dotLabel: "Connected", tag: "Soon", count: 3 }, expected: "Provider, Connected Soon 3" },
  { name: "retains the empty tag's separator before zero", decoration: { dot: true, dotLabel: "Connected", tag: "", count: 0 }, expected: "Provider, Connected  0" },
  { name: "retains the empty tag's trailing separator", decoration: { dot: true, dotLabel: "Connected", tag: "" }, expected: "Provider, Connected " },
];

describe("TabBar characterization", () => {
  it.each(LABEL_CASES)("$name", ({ decoration, expected }) => {
    const tab: TabBarTab = { id: "provider", label: "Provider", ...decoration };
    render(<TabBar tabs={[tab]} activeId="provider" onChange={vi.fn<(id: string) => void>()} ariaLabel="Providers" />);

    expect(screen.getByRole("tab").getAttribute("aria-label")).toBe(expected);
  });

  it("keeps hidden status after the label and visible decorations in their original order", () => {
    const tab: TabBarTab = {
      id: "provider", label: "Provider", dot: true, dotLabel: "Connected",
      icon: <svg data-testid="provider-icon" />, tag: "Soon", count: 0,
    };
    render(<TabBar tabs={[tab]} activeId="provider" onChange={vi.fn<(id: string) => void>()} ariaLabel="Providers" />);

    const button = screen.getByRole("tab", { name: "Provider, Connected Soon 0" });
    expect(Array.from(button.childNodes, (node) => node.textContent)).toEqual(["", "", "Provider", ", Connected", "Soon", "0"]);
    expect(button.querySelector(".jini-tab-bar-dot")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("provider-icon").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector(".jini-ui-tab-bar-count")).toHaveTextContent("0");
  });

  it("keeps plain tabs undecorated and selection controlled after a click", () => {
    const onChange = vi.fn<(id: string) => void>();
    render(<TabBar tabs={[{ id: "provider", label: "Provider" }]} activeId="other" onChange={onChange} ariaLabel="Providers" />);

    const button = screen.getByRole("tab", { name: "Provider" });
    expect(button.children).toHaveLength(0);
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("data-agent-element");
    expect(button).toHaveAttribute("aria-selected", "false");
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("provider");
    expect(button).toHaveAttribute("aria-selected", "false");
  });

  it("keeps disabled decorated tabs selected but prevents activation", () => {
    const onChange = vi.fn<(id: string) => void>();
    const tab: TabBarTab = { id: "provider", label: "Provider", disabled: true, dot: true, dotLabel: "Connected" };
    render(<TabBar tabs={[tab]} activeId="provider" onChange={onChange} ariaLabel="Providers" />);

    const button = screen.getByRole("tab", { name: "Provider, Connected" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-selected", "true");
    expect(button).toHaveAttribute("tabindex", "-1");
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
  });
});

it("a selected UI TabBar item retains its count and underline", () => {
  const css = readFileSync(new URL("../../../../../styles/admin.css", import.meta.url), "utf8");
  render(<TabBar tabs={[{ id: "a", label: "Alpha", count: 3, icon: <svg /> }]} activeId="a" onChange={vi.fn()} ariaLabel="Tabs" />);
  const tab = screen.getByRole("tab");
  expect(tab).toHaveAttribute("aria-selected", "true");
  expect(tab).toHaveClass("jini-ui-tab-bar-item");
  expect(tab.querySelector(".jini-ui-tab-bar-count")).toHaveTextContent("3");
  expect(css).toContain('.jini-ui-tab-bar-item[aria-selected="true"]');
  expect(css).toContain("border-bottom-color: var(--jini-accent)");
  for (const node of [tab.parentElement!, tab, ...tab.querySelectorAll("[class]")]) {
    for (const token of node.classList) if (token.startsWith("jini-ui-tab-bar")) expect(css).toContain(`.${token}`);
  }
});
