// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InfoTipProps } from "../../../react/kit.js";
import { AdminAssistantSwitch } from "../AdminAssistantSwitch.js";
import type { AdminAssistantSwitchController } from "../use-admin-assistant-switch.hooks.js";

/**
 * @file The admin dock switch's contract with its host: it renders the injected controller's live
 * `open` value and asks for the NEW state on change (a request, never a local flip), translating its
 * copy through the injected `t`.
 */

function FakeInfoTip({ label, triggerLabel }: InfoTipProps) {
  return <button type="button" aria-label={triggerLabel} title={label}>i</button>;
}

function renderSwitch(controller: AdminAssistantSwitchController, t = (key: string) => key) {
  return render(<AdminAssistantSwitch t={t} InfoTip={FakeInfoTip} useAdminAssistantSwitchHook={() => controller} />);
}

describe("AdminAssistantSwitch", () => {
  it("reflects the controller's open state", () => {
    const { rerender } = renderSwitch({ open: false, setOpen: vi.fn() });
    expect(screen.getByRole("checkbox", { name: "Open the assistant panel" })).not.toBeChecked();
    rerender(<AdminAssistantSwitch t={(k) => k} InfoTip={FakeInfoTip} useAdminAssistantSwitchHook={() => ({ open: true, setOpen: vi.fn() })} />);
    expect(screen.getByRole("checkbox", { name: "Open the assistant panel" })).toBeChecked();
  });

  it("asks the controller for the new state on toggle", () => {
    const setOpen = vi.fn();
    renderSwitch({ open: false, setOpen });
    fireEvent.click(screen.getByRole("checkbox", { name: "Open the assistant panel" }));
    expect(setOpen).toHaveBeenCalledWith({ open: true });
  });

  it("wraps the row in its jini class and translates the label", () => {
    const { container } = renderSwitch({ open: false, setOpen: vi.fn() }, (key) => `«${key}»`);
    expect(container.firstElementChild).toHaveClass("jini-assistant-switch");
    expect(screen.getByRole("checkbox", { name: "«Open the assistant panel»" })).toBeInTheDocument();
  });
});
