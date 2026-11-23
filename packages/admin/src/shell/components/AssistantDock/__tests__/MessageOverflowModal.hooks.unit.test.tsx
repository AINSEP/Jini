// @vitest-environment jsdom
import { act, renderHook as renderBareHook } from "@testing-library/react";
import { closeLightboxDialog, openLightboxDialog } from "@jini-ai/ui/admin-widgets";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { useMessageOverflowModal } from "../MessageOverflowModal.hooks.js";

/** Renders under the fake admin kit, with the real UI-library pieces these assertions are about swapped in. */
const wrapperKit = fakeAdminKit({ values: { openLightboxDialog, closeLightboxDialog } });
function wrapper({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={wrapperKit}>{children}</AdminKitProvider>;
}
function renderHook<Result, Props>(callback: (props: Props) => Result, options: { initialProps?: Props } = {}) {
  return renderBareHook(callback, { ...options, wrapper });
}

/**
 * @file `useMessageOverflowModal` — the `<dialog>` lifecycle extracted out of
 * `MessageOverflowModal.tsx`. Mirrors `ImagePreviewModal.hooks.unit.test.tsx` line for line: the
 * two hooks share the identical native-`<dialog>` lifecycle contract (see this hook's own module
 * doc for why it is a sibling rather than a shared import), so the same coverage shape applies.
 *
 * jsdom implements neither `HTMLDialogElement.showModal` nor `.close` — these tests exercise the
 * `setAttribute`/`removeAttribute` fallback branch directly, via `hasAttribute("open")`.
 */

function attachDialog(result: { current: ReturnType<typeof useMessageOverflowModal> }) {
  const dialog = document.createElement("dialog");
  document.body.appendChild(dialog);
  result.current.dialogRef.current = dialog;
  return dialog;
}

describe("useMessageOverflowModal", () => {
  it("does not set the open attribute on mount when open is false", () => {
    const { result } = renderHook(({ open }) => useMessageOverflowModal({ open, onClose: vi.fn() }), { initialProps: { open: false } });
    const dialog = attachDialog(result);

    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("sets the open attribute when open flips to true", () => {
    const { result, rerender } = renderHook(({ open }) => useMessageOverflowModal({ open, onClose: vi.fn() }), {
      initialProps: { open: false },
    });
    attachDialog(result);

    rerender({ open: true });

    expect(result.current.dialogRef.current?.hasAttribute("open")).toBe(true);
  });

  it("removes the open attribute when open flips back to false", () => {
    const { result, rerender } = renderHook(({ open }) => useMessageOverflowModal({ open, onClose: vi.fn() }), {
      initialProps: { open: false },
    });
    attachDialog(result);
    rerender({ open: true });
    expect(result.current.dialogRef.current?.hasAttribute("open")).toBe(true);

    rerender({ open: false });

    expect(result.current.dialogRef.current?.hasAttribute("open")).toBe(false);
  });

  it("handleNativeCancel prevents the browser default and routes through onClose", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useMessageOverflowModal({ open: true, onClose }));

    const preventDefault = vi.fn();
    act(() => result.current.handleNativeCancel({ preventDefault } as never));

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handleBackdropClick calls onClose only when the click target is the dialog itself", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useMessageOverflowModal({ open: true, onClose }));
    const dialog = attachDialog(result);
    const child = document.createElement("div");
    dialog.appendChild(child);

    act(() => result.current.handleBackdropClick({ target: child } as never));
    expect(onClose).not.toHaveBeenCalled();

    act(() => result.current.handleBackdropClick({ target: dialog } as never));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Coverage-gap-fill (2026-09-05), mirroring `ImagePreviewModal.hooks.unit.test.tsx`'s equivalent
   * addition: every test above exercises the jsdom fallback branch only. This polyfills
   * `showModal`/`close` onto the attached dialog element to exercise the real-browser branch too.
   */
  it("calls showModal()/close() directly, not the attribute fallback, when the browser implements them", () => {
    const { result, rerender } = renderHook(({ open }) => useMessageOverflowModal({ open, onClose: vi.fn() }), {
      initialProps: { open: false },
    });
    const dialog = attachDialog(result);
    const showModal = vi.fn(() => {
      dialog.setAttribute("open", "");
    });
    const close = vi.fn(() => {
      dialog.removeAttribute("open");
    });
    dialog.showModal = showModal;
    dialog.close = close;

    rerender({ open: true });
    expect(showModal).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    expect(close).toHaveBeenCalledTimes(1);
  });

  /**
   * `openDialog`/`closeDialog`'s own idempotency guards, mirroring
   * `ImagePreviewModal.hooks.unit.test.tsx`'s equivalent addition — the DOM element diverged from
   * React's own `open` state by the time the effect re-runs (something outside this hook's control
   * opened/closed the native `<dialog>`), rather than two `showModal`/`close` calls in a row, which
   * the effect's `[open]` dependency array makes impossible to trigger without an intervening
   * `open` change.
   */
  it("does not call showModal() again when the dialog element is already open as the effect re-runs", () => {
    const { result, rerender } = renderHook(({ open }) => useMessageOverflowModal({ open, onClose: vi.fn() }), {
      initialProps: { open: false },
    });
    const dialog = attachDialog(result);
    const showModal = vi.fn();
    dialog.showModal = showModal;
    dialog.close = vi.fn();
    dialog.setAttribute("open", "");

    rerender({ open: true });

    expect(showModal).not.toHaveBeenCalled();
  });

  it("does not call close() again when the dialog element is already closed as the effect re-runs", () => {
    const { result, rerender } = renderHook(({ open }) => useMessageOverflowModal({ open, onClose: vi.fn() }), {
      initialProps: { open: true },
    });
    const dialog = attachDialog(result);
    dialog.showModal = vi.fn();
    const close = vi.fn();
    dialog.close = close;
    dialog.removeAttribute("open");

    rerender({ open: false });

    expect(close).not.toHaveBeenCalled();
  });
});
