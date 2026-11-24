// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AGENT_ELEMENT_ATTRIBUTE } from "@jini-ai/core/agent-handles";
import type { AdminKitHooks, AdminKitValues } from "../../../react/kit.js";
import { VisitorAssistantTabs, type VisitorAssistantTabsProps } from "../VisitorAssistantTabs.js";
import { useVisitorAssistantTabs } from "../use-visitor-assistant-tabs.hooks.js";

/**
 * @file The visitor tabs' contract with its host: the injected tab hook owns which panel shows, the
 * injected UI-library keyboard hook gets the tablist's keys, and the injected roving-tabindex rule
 * decides each tab's `tabIndex`. The real keyboard behaviour is pinned by the host's wiring test.
 */
const t = (key: string) => key;
const onKeyDown = vi.fn();
const useTabBarKeyboardHook: AdminKitHooks["useTabBarKeyboard"] = () => ({ onKeyDown });
const resolveTabIndex: AdminKitValues["resolveTabBarTabIndex"] = ({ activeId, tab }) => tab.id === activeId ? 0 : -1;
function mount(overrides: Partial<VisitorAssistantTabsProps> = {}) {
  return render(<VisitorAssistantTabs t={t} providerPanel={<p>provider screen</p>} toolsPanel={<p>tools screen</p>}
    useVisitorAssistantTabsHook={useVisitorAssistantTabs} useTabBarKeyboardHook={useTabBarKeyboardHook} resolveTabIndex={resolveTabIndex} {...overrides} />);
}

describe("VisitorAssistantTabs", () => {
  it("opens on AI provider (the unchanged screen) and switches to Visitor tools", async () => {
    mount();
    expect(screen.getByRole("tablist", { name: "Visitor's AI Assistant" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "AI provider" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("provider screen")).toBeTruthy();
    expect(screen.queryByText("tools screen")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Visitor tools" }));
    expect(screen.getByRole("tab", { name: "Visitor tools" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Visitor tools" }).textContent).toBe("tools screen");
    expect(screen.queryByText("provider screen")).toBeNull();
  });

  it("shows the tab returned by the injected useVisitorAssistantTabsHook and routes selection through it", async () => {
    const select = vi.fn();
    mount({ useVisitorAssistantTabsHook: () => ({ active: "tools", select }) });
    expect(screen.getByText("tools screen")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "AI provider" }));
    expect(select).toHaveBeenCalledWith("provider");
  });

  it("draws the segmented pill with the injected roving tabindex and hands keys to the injected keyboard hook", async () => {
    mount();
    expect(screen.getByRole("tablist").classList.contains("jini-chat-settings-segmented")).toBe(true);
    const provider = screen.getByRole("tab", { name: "AI provider" });
    expect(provider.classList.contains("jini-chat-settings-segment")).toBe(true);
    expect(provider.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Visitor tools" }).tabIndex).toBe(-1);
    expect(provider.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("ai-assistant-visitor-tab-provider");
    provider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onKeyDown).toHaveBeenCalled();
  });
});
