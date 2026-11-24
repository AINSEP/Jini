// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrowserAgentSettingsPanel } from "../BrowserAgentSettingsPanel.js";
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { WEBMCP_DICT } from "../webmcp-i18n.js";
import { createBrowserAgentSettingsPort, useBrowserAgentSettings, type BrowserAgentSettingsPort } from "../browser-agent-settings.hooks.js";

/**
 * @file The browser-agent (WebMCP) opt-out: the origin-local preference port the host binds to its
 * own storage key, the hook over it, and the human-only settings toggle.
 */

const KEY = "host.admin.webmcp.enabled";
const t = createDictionaryTranslator({ featureDictionary: WEBMCP_DICT }, { commonDictionary: {} });

/** A fresh port per test keeps the session override from leaking between cases. */
function setup() {
  localStorage.clear();
  const port = createBrowserAgentSettingsPort({ preferenceKey: KEY });
  const useBound = () => useBrowserAgentSettings({ port });
  return { port, useBound };
}

describe("browser-agent opt-out", () => {
  it("ignores unrelated storage events until the preference itself changes", () => {
    const { useBound } = setup();
    const view = renderHook(useBound);
    expect(view.result.current.enabled).toBe(true);
    act(() => {
      localStorage.setItem(KEY, "false");
      window.dispatchEvent(new StorageEvent("storage", { key: "another-preference" }));
    });
    expect(view.result.current.enabled).toBe(true);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: KEY })));
    expect(view.result.current.enabled).toBe(false);
    view.unmount();
  });

  it("uses the enabled server snapshot before browser preferences can be read", () => {
    const { useBound } = setup();
    localStorage.setItem(KEY, "false");
    function Preference() {
      const { enabled } = useBound();
      return <span>{enabled ? "Enabled" : "Disabled"}</span>;
    }
    expect(renderToString(<Preference />)).toBe("<span>Enabled</span>");
  });

  it("can be driven through an injected preference port", () => {
    let enabled = false;
    const listeners = new Set<() => void>();
    const port: BrowserAgentSettingsPort = {
      getEnabled: () => enabled,
      setEnabled: (required) => { enabled = required.enabled; for (const listener of listeners) listener(); },
      subscribe: ({ listener }) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const view = renderHook(() => useBrowserAgentSettings({ port }));
    expect(view.result.current.enabled).toBe(false);
    act(() => view.result.current.setEnabled({ enabled: true }));
    expect(view.result.current.enabled).toBe(true);
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it("defaults on, updates all mounts immediately and persists across remount under the host's key", () => {
    const { useBound } = setup();
    const first = renderHook(useBound);
    const second = renderHook(useBound);
    expect(first.result.current.enabled).toBe(true);
    act(() => first.result.current.setEnabled({ enabled: false }));
    expect(second.result.current.enabled).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("false");
    first.unmount(); second.unmount();
    const again = renderHook(useBound);
    expect(again.result.current.enabled).toBe(false);
  });

  it("responds to another tab opting out and to storage being cleared", () => {
    const { useBound } = setup();
    const view = renderHook(useBound);
    act(() => {
      localStorage.setItem(KEY, "false");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });
    expect(view.result.current.enabled).toBe(false);
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    expect(view.result.current.enabled).toBe(true);
  });

  it("retains a session-only opt-out when browser storage is blocked", () => {
    const { useBound } = setup();
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      const view = renderHook(useBound);
      expect(view.result.current.enabled).toBe(true);
      act(() => view.result.current.setEnabled({ enabled: false }));
      expect(view.result.current.enabled).toBe(false);
    } finally { read.mockRestore(); write.mockRestore(); }
  });
});

describe("BrowserAgentSettingsPanel", () => {
  it("renders a working human-only opt-out with honest browser scope", async () => {
    const { useBound } = setup();
    render(<BrowserAgentSettingsPanel locale="en" t={t} useBrowserAgentSettingsHook={useBound} />);
    const toggle = screen.getByRole("checkbox", { name: "Browser-agent access (WebMCP)" });
    expect(toggle).toBeChecked();
    // The on state is a namespaced class the host stylesheet targets, never a bare `on`.
    expect(toggle).toHaveClass("jini-toggle-row", "jini-toggle-row-on");
    expect(toggle).not.toHaveClass("on");
    expect(toggle).not.toHaveAttribute("data-agent-element");
    expect(screen.getByText(/this browser/)).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(toggle).not.toHaveClass("jini-toggle-row-on");
    expect(localStorage.getItem(KEY)).toBe("false");
  });

  it("renders the opt-out state returned by the injected useBrowserAgentSettingsHook and writes through it", async () => {
    const setEnabled = vi.fn();
    render(<BrowserAgentSettingsPanel locale="en" t={t} useBrowserAgentSettingsHook={() => ({ enabled: false, setEnabled })} />);
    const toggle = screen.getByRole("checkbox");
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledWith({ enabled: true });
  });
});
