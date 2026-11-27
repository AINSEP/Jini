// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatFab } from "../ChatFab.js";
import type { FabPositionResult } from "../ChatFab.hooks.js";

/**
 * @file `ChatFab` markup, labels and wiring against a fake position hook (the drag physics belong to
 * the kit's hook; the host pins the click-after-drag integration against the real one).
 */
const KEY = "test-fab-position";
const fakeFab = (overrides: Partial<FabPositionResult> = {}): FabPositionResult => ({
  style: {}, isDragging: false, onPointerDown: vi.fn(), consumeDragFlag: () => false, ...overrides,
}) as FabPositionResult;

describe("ChatFab", () => {
  it("hands the position hook the host's storage key and the clearances", () => {
    const useFab = vi.fn(() => fakeFab());
    render(<ChatFab open positionStorageKey={KEY} onToggle={vi.fn()} avoidBottomPx={240} avoidRightPx={360} useFab={useFab} />);
    expect(useFab).toHaveBeenCalledWith({ dockOpen: true, avoidBottomPx: 240, avoidRightPx: 360, storageKey: KEY });
  });

  it("names the toggle in the caller's locale and falls back to English for an unknown one", () => {
    const { rerender } = render(<ChatFab open={false} positionStorageKey={KEY} onToggle={vi.fn()} avoidBottomPx={0} avoidRightPx={0} useFab={() => fakeFab()} label="Helper" locale="fr" />);
    expect(screen.getByRole("button", { name: "Ouvrir Helper" })).toBeTruthy();
    rerender(<ChatFab open={false} positionStorageKey={KEY} onToggle={vi.fn()} avoidBottomPx={0} avoidRightPx={0} useFab={() => fakeFab()} label="Helper" locale="xx-unsupported" />);
    expect(screen.getByRole("button", { name: "Open Helper" })).toBeTruthy();
  });

  it("toggles on click unless the click ends a drag", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ChatFab open={false} positionStorageKey={KEY} onToggle={onToggle} avoidBottomPx={0} avoidRightPx={0} useFab={() => fakeFab()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<ChatFab open={false} positionStorageKey={KEY} onToggle={onToggle} avoidBottomPx={0} avoidRightPx={0} useFab={() => fakeFab({ consumeDragFlag: () => true })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reflects the open and dragging state in class and aria-expanded", () => {
    render(<ChatFab open positionStorageKey={KEY} onToggle={vi.fn()} avoidBottomPx={0} avoidRightPx={0} useFab={() => fakeFab({ isDragging: true })} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("chat-fab-dock-open");
    expect(button.className).toContain("chat-fab-dragging");
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

it("publishes the optional assistant element handle without changing the localized accessible name", () => {
  const props = { open: true, positionStorageKey: KEY, onToggle: vi.fn(), avoidBottomPx: 0, avoidRightPx: 0, useFab: () => fakeFab(), label: "Aide", locale: "fr" };
  const { rerender } = render(<ChatFab {...props} agentHandle="assistant-toggle" />);
  const button = screen.getByRole("button", { name: "Fermer Aide" });
  expect(button.getAttribute("data-agent-element")).toBe("assistant-toggle");
  rerender(<ChatFab {...props} />);
  expect(button.getAttribute("data-agent-element")).toBeNull();
});
