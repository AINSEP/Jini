// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { fireEvent, render as renderBare, renderHook as renderBareHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { closeLightboxDialog, openLightboxDialog } from "@jini-ai/ui/admin-widgets";
import { describe, expect, it, vi } from "vitest";

import { useEditMediaModal } from "../use-edit-media-modal.hooks.js";

/** The real UI-library dialog helpers these assertions are about, passed explicitly the way a host binds them from its kit. */
const helpers = { openLightboxDialog, closeLightboxDialog };
const render = (ui: ReactNode) => renderBare(ui);
const renderHook = renderBareHook;

type DialogMode = "native-methods" | "fallback";

function Harness({ open, mode, onClose, alreadyOpen = false, onNativeOpen, onNativeClose }: {
  open: boolean; mode: DialogMode; onClose: () => void; alreadyOpen?: boolean;
  onNativeOpen?: (dialog: HTMLDialogElement) => void;
  onNativeClose?: (dialog: HTMLDialogElement) => void;
}) {
  const controller = useEditMediaModal({ open, onClose, ...helpers });
  return <dialog aria-label="Edit media" ref={(dialog) => {
    controller.dialogRef.current = dialog;
    if (!dialog) return;
    if (alreadyOpen) dialog.setAttribute("open", "");
    // jsdom cannot implement a browser's modal top layer. Fake only these host APIs;
    // keep their open state and reject duplicate operations (F3.3/F3.6).
    Object.defineProperties(dialog, {
      showModal: { configurable: true, value: mode === "fallback" ? undefined : function (this: HTMLDialogElement) {
        onNativeOpen?.(this);
        if (this.open) throw new Error("already open");
        this.setAttribute("open", "");
      } },
      close: { configurable: true, value: mode === "fallback" ? undefined : function (this: HTMLDialogElement) {
        onNativeClose?.(this);
        if (!this.open) throw new Error("already closed");
        this.removeAttribute("open");
      } },
    });
  }} onCancel={controller.handleNativeCancel} onClick={controller.handleBackdropClick}>
    <button>Dialog content</button>
  </dialog>;
}

describe.each<DialogMode>(["native-methods", "fallback"])("edit dialog lifecycle: %s", (mode) => {
  // F2.1/F6.2: deleting the close branch or ignoring false->true must fail on DOM state.
  it("opens, stays open on unchanged props, closes, and can reopen", () => {
    const onClose = vi.fn();
    const onNativeOpen = vi.fn();
    const onNativeClose = vi.fn();
    const host = { mode, onNativeOpen, onNativeClose };
    const { container, rerender } = render(<Harness open={false} {...host} onClose={onClose} />);
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(false);
    rerender(<Harness open {...host} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Edit media" })).toBe(dialog);
    expect(dialog.open).toBe(true);
    rerender(<Harness open {...host} onClose={vi.fn()} />);
    expect(dialog.open).toBe(true);
    rerender(<Harness open={false} {...host} onClose={onClose} />);
    expect(dialog.open).toBe(false);
    rerender(<Harness open {...host} onClose={onClose} />);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // F2.2/F2.5: native modal presentation cannot be replaced by setting an attribute.
    // Pin the host-method contract and receiver as well as its observable open state.
    expect(onNativeOpen).toHaveBeenCalledTimes(mode === "native-methods" ? 2 : 0);
    expect(onNativeClose).toHaveBeenCalledTimes(mode === "native-methods" ? 1 : 0);
    for (const [receiver] of [...onNativeOpen.mock.calls, ...onNativeClose.mock.calls]) {
      expect(receiver).toBe(dialog);
    }
  });

  // F2.5/F4.3: unconditionally closing on every click must fail on the child control.
  it("ignores content clicks and delivers a backdrop dismissal to the current callback", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness open mode={mode} onClose={first} />);
    await user.click(screen.getByRole("button", { name: "Dialog content" }));
    expect(first).not.toHaveBeenCalled();
    rerender(<Harness open mode={mode} onClose={second} />);
    await user.click(screen.getByRole("dialog", { name: "Edit media" }));
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[]]);
  });

  // F3.1: this tests the cancel EVENT handler, not native Escape-key routing, which needs
  // a real browser. F2.1: the parent consumes dismissal and the real effect closes the DOM.
  it("prevents the cancel event's default and closes when its parent consumes dismissal", () => {
    const onClose = vi.fn();
    function Controlled() {
      const [open, setOpen] = useState(true);
      return <Harness open={open} mode={mode} onClose={() => { onClose(); setOpen(false); }} />;
    }
    render(<Controlled />);
    const dialog = screen.getByRole("dialog", { name: "Edit media" }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const event = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose.mock.calls).toEqual([[]]);
    expect(dialog.open).toBe(false);
  });
});

it("does not call showModal on a native dialog that is already open", () => {
  // Removing the native open guard would hit the strict host fake's duplicate-open error.
  render(<Harness open alreadyOpen mode="native-methods" onClose={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "Edit media" })).toHaveAttribute("open");
});

it("permits a render without an attached dialog ref", () => {
  const { result, rerender } = renderHook(({ open }) => useEditMediaModal({ open, onClose: vi.fn(), ...helpers }), { initialProps: { open: true } });
  expect(result.current.dialogRef.current).toBeNull();
  rerender({ open: false });
  expect(result.current.dialogRef.current).toBeNull();
});

it("opens and closes through the dialog helpers passed in its args", () => {
  // The lifecycle reaches the dialog only through the injected helpers; a direct UI-library import
  // or a kit lookup would bypass these spies.
  const open = vi.fn();
  const close = vi.fn();
  function Probe({ isOpen }: { isOpen: boolean }) {
    const controller = useEditMediaModal({ open: isOpen, onClose: vi.fn(), openLightboxDialog: open, closeLightboxDialog: close });
    return <dialog aria-label="Edit media" ref={controller.dialogRef} />;
  }
  const { rerender } = renderBare(<Probe isOpen />);
  const dialog = document.querySelector("dialog[aria-label=\"Edit media\"]");
  expect(open.mock.calls).toEqual([[dialog]]);
  rerender(<Probe isOpen={false} />);
  expect(close.mock.calls).toEqual([[dialog]]);
});
