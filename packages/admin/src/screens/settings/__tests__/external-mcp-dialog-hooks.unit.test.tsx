// @vitest-environment jsdom
import { fireEvent, render, renderHook } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminKitProvider, useFocusTrap } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { useExternalMcpToolsModalEscape } from "../ExternalMcpToolsModal.hooks.js";
import { useExternalMcpRemoveConfirm } from "../hooks/use-external-mcp-remove-confirm.hooks.js";

type TrapCall = { containerRef: RefObject<HTMLElement | null> };

function kitWithTrap() {
  const trap = vi.fn((_required: TrapCall, _optional?: { active?: boolean | undefined }) => undefined);
  const kit = fakeAdminKit({ hooks: { useFocusTrap: trap } });
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
  return { trap, wrapper };
}

describe("useExternalMcpToolsModalEscape (kit focus-trap seam)", () => {
  it("hands its own dialogRef to the kit's useFocusTrap", () => {
    const { trap, wrapper } = kitWithTrap();
    const { result } = renderHook(() => useExternalMcpToolsModalEscape({ onClose: vi.fn(), useFocusTrapHook: useFocusTrap }), { wrapper });
    expect(trap).toHaveBeenCalled();
    expect(trap.mock.calls[0]![0].containerRef).toBe(result.current.dialogRef);
  });

  it("focuses Close on mount, restores the trigger on unmount, and closes on Escape only while mounted", () => {
    const { wrapper } = kitWithTrap();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    function Modal() {
      const { dialogRef, closeRef } = useExternalMcpToolsModalEscape({ onClose, useFocusTrapHook: useFocusTrap });
      return <div ref={dialogRef} aria-modal="true"><button ref={closeRef}>Close</button></div>;
    }
    const { getByRole, unmount } = render(<Modal />, { wrapper });
    expect(document.activeElement).toBe(getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    trigger.remove();
  });
});

describe("useExternalMcpRemoveConfirm (injected copy builder + kit focus-trap seam)", () => {
  it("returns exactly the host builder's copy, called with the name, auth mode and translator", () => {
    const { wrapper } = kitWithTrap();
    const t = (key: string) => `[${key}]`;
    const buildCopy = vi.fn((params: { name: string; isOAuth: boolean }, options: { t?: (key: string) => string }) =>
      ({ title: `${options.t?.("Remove") ?? "?"} ${params.name}`, body: params.isOAuth ? "sealed" : "plain" }));
    const { result } = renderHook(() => useExternalMcpRemoveConfirm({ name: "Atlas", isOAuth: true, onCancel: vi.fn(), t, buildCopy, useFocusTrapHook: useFocusTrap }), { wrapper });
    expect(buildCopy).toHaveBeenCalledWith({ name: "Atlas", isOAuth: true }, { t });
    expect(result.current.copy).toEqual({ title: "[Remove] Atlas", body: "sealed" });
  });

  it("traps Tab in its dialogRef and cancels on Escape until unmount", () => {
    const { trap, wrapper } = kitWithTrap();
    const onCancel = vi.fn();
    const { result, unmount } = renderHook(() => useExternalMcpRemoveConfirm({ name: "Atlas", isOAuth: false, onCancel, buildCopy: () => "copy", useFocusTrapHook: useFocusTrap }), { wrapper });
    expect(trap.mock.calls[0]![0].containerRef).toBe(result.current.dialogRef);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("needs the host's AdminKitProvider: without it the trap cannot be resolved", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Probe() { useExternalMcpRemoveConfirm({ name: "x", isOAuth: false, onCancel: () => undefined, buildCopy: () => null, useFocusTrapHook: useFocusTrap }); return null; }
    expect(() => render(<Probe />)).toThrow(/AdminKitProvider/);
    spy.mockRestore();
  });
});
