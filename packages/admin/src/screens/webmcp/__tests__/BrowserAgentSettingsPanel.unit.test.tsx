// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrowserAgentSettingsPanel } from "../BrowserAgentSettingsPanel.js";

/** @file The panel renders the injected preference hook's state and writes through its setter only. */
describe("BrowserAgentSettingsPanel", () => {
  it("shows the injected preference and toggles it through the injected setter", async () => {
    const setEnabled = vi.fn();
    render(<BrowserAgentSettingsPanel locale="en" useBrowserAgentSettingsHook={() => ({ enabled: true, setEnabled })} />);
    const toggle = screen.getByRole("checkbox", { name: "Browser-agent access (WebMCP)" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveClass("jini-toggle-row", "on");
    await userEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith({ enabled: false });
  });
});
