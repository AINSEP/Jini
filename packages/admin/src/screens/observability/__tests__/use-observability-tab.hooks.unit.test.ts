// @vitest-environment jsdom
import { act, renderHook as renderHookOriginal, type RenderHookOptions } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findActiveTab, resolveInitialActiveTabId, useTabbedDialog } from "@jini-ai/ui";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { useObservabilityTab } from "../hooks/use-observability-tab.hooks.js";

// The host binds the UI library's tab rules and tabbed-dialog hook into these kit slots.
const kit = fakeAdminKit({ hooks: { useTabbedDialog }, values: { findActiveTab, resolveInitialActiveTabId } });
const wrapper = ({ children }: { children: ReactNode }) => createElement(AdminKitProvider, { kit, children });
function renderHook<Result, Props>(callback: (props: Props) => Result, options: RenderHookOptions<Props> = {}) {
  return renderHookOriginal(callback, { wrapper, ...options });
}

let originalUrl: string;
beforeEach(() => {
  originalUrl = window.location.href;
  window.history.replaceState(null, "", "/admin/observability");
});
afterEach(() => window.history.replaceState(null, "", originalUrl));
const tabs = [
  { id: "overview", label: "Overview", subtitle: "Overview copy", panel: null },
  { id: "queries", label: "Queries", subtitle: "Queries copy", panel: null },
];

describe("Observability page tab adapter", () => {
  it("selects a deep link and follows later route changes without navigating on load", () => {
    const historyLength = window.history.length;
    const { result, rerender } = renderHook(({ tabId }) => useObservabilityTab({ tabs, tabId }), { initialProps: { tabId: "queries" } });
    expect(result.current.activeTabId).toBe("queries");
    expect(result.current.subtitle).toBe("Queries copy");
    rerender({ tabId: "overview" });
    expect(result.current.activeTabId).toBe("overview");
    expect(result.current.subtitle).toBe("Overview copy");
    expect(window.location.pathname + window.location.search).toBe("/admin/observability");
    act(() => result.current.onTabChange({ nextTabId: "queries" }));
    expect(result.current.subtitle).toBe("Queries copy");
    expect(window.location.pathname + window.location.search).toBe("/admin/observability?tab=queries");
    expect(window.history.length).toBe(historyLength);
  });

  it.each([null, "missing", "queries"])("uses Overview for an unavailable request %s", tabId => {
    const { result } = renderHook(() => useObservabilityTab({ tabs: tabs.slice(0, 1), tabId }));
    expect(result.current.activeTabId).toBe("overview");
    expect(result.current.subtitle).toBe("Overview copy");
  });

  it("falls back when permissions remove the selected tab", () => {
    const { result, rerender } = renderHook(({ available }) => useObservabilityTab({ tabs: available, tabId: "queries" }), { initialProps: { available: tabs } });
    expect(result.current.activeTabId).toBe("queries");
    rerender({ available: tabs.slice(0, 1) });
    expect(result.current.activeTabId).toBe("overview");
  });
  it("also falls back after local selection when an uncontrolled mount loses Queries", () => {
    const { result, rerender } = renderHook(({ available }) => useObservabilityTab({ tabs: available }), { initialProps: { available: tabs } });
    act(() => result.current.onTabChange({ nextTabId: "queries" }));
    expect(result.current.activeTabId).toBe("queries");
    rerender({ available: tabs.slice(0, 1) });
    expect(result.current.activeTabId).toBe("overview");
    expect(result.current.subtitle).toBe("Overview copy");
  });

  it("has no active tab or subtitle while permissions expose no tabs, then adopts the first available tab", () => {
    const { result, rerender } = renderHook(({ available }) => useObservabilityTab({ tabs: available }, {}), {
      initialProps: { available: tabs.slice(0, 0) },
    });
    expect(result.current.activeTabId).toBeUndefined();
    expect(result.current.subtitle).toBeUndefined();
    expect(window.location.search).toBe("");
    rerender({ available: tabs });
    expect(result.current.activeTabId).toBe("overview");
    expect(result.current.subtitle).toBe("Overview copy");
    rerender({ available: [] });
    expect(result.current.activeTabId).toBeUndefined();
    expect(result.current.subtitle).toBeUndefined();
  });
});
