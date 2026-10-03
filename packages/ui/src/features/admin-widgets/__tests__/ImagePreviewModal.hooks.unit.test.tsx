import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useImagePreviewModal } from "../components/ImagePreviewModal.hooks";

/**
 * @file `useImagePreviewModal` — the `<dialog>` lifecycle extracted out of `ImagePreviewModal.tsx`
 * (`ImagePreviewModal.hooks.tsx`). `ImagePreviewModal.unit.test.tsx` already covers the same
 * behavior end-to-end through the rendered component, so this file's job is to pin the hook's own
 * contract in isolation: it toggles the dialog's `open` attribute in response to `open` changing,
 * and its two dismiss handlers behave correctly.
 *
 * jsdom implements neither `HTMLDialogElement.showModal` nor `.close` (the same reason the
 * component itself has a `setAttribute`/`removeAttribute` fallback branch) — these tests exercise
 * that fallback branch directly, via `hasAttribute("open")`, the same assertion
 * `ImagePreviewModal.unit.test.tsx` already uses through the rendered component.
 */

function attachDialog(result: { current: ReturnType<typeof useImagePreviewModal> }) {
  const dialog = document.createElement("dialog");
  document.body.appendChild(dialog);
  result.current.dialogRef.current = dialog;
  return dialog;
}

describe("useImagePreviewModal", () => {
  it("does not set the open attribute on mount when open is false", () => {
    const { result } = renderHook(({ open }) => useImagePreviewModal({ open: open, onClose: vi.fn() }), { initialProps: { open: false } });
    const dialog = attachDialog(result);

    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("sets the open attribute when open flips to true", () => {
    const { result, rerender } = renderHook(({ open }) => useImagePreviewModal({ open: open, onClose: vi.fn() }), {
      initialProps: { open: false },
    });
    attachDialog(result);

    rerender({ open: true });

    expect(result.current.dialogRef.current?.hasAttribute("open")).toBe(true);
  });

  it("removes the open attribute when open flips back to false", () => {
    const { result, rerender } = renderHook(({ open }) => useImagePreviewModal({ open: open, onClose: vi.fn() }), {
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
    const { result } = renderHook(() => useImagePreviewModal({ open: true, onClose: onClose }));

    const preventDefault = vi.fn();
    act(() => result.current.handleNativeCancel({ preventDefault } as never));

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handleBackdropClick calls onClose only when the click target is the dialog itself", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useImagePreviewModal({ open: true, onClose: onClose }));
    const dialog = attachDialog(result);
    const child = document.createElement("img");
    dialog.appendChild(child);

    act(() => result.current.handleBackdropClick({ target: child } as never));
    expect(onClose).not.toHaveBeenCalled();

    act(() => result.current.handleBackdropClick({ target: dialog } as never));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Coverage-gap-fill (2026-09-05). Every test above exercises the jsdom fallback branch only (this
   * file's own header names that as deliberate). This polyfills `showModal`/`close` onto the
   * attached dialog element, the real-browser shape the fallback exists to substitute for, so the
   * "modern browser" branch itself gets exercised at least once too.
   */
  it("calls showModal()/close() directly, not the attribute fallback, when the browser implements them", () => {
    const { result, rerender } = renderHook(({ open }) => useImagePreviewModal({ open: open, onClose: vi.fn() }), {
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
   * `openDialog`/`closeDialog`'s own idempotency guards (`if (!dialog.open) …` / `if (dialog.open)
   * …`) — the module doc's "no-op if already open" half of the modern-browser branch, never hit by
   * the test above (there, `open` always transitions FROM the state the dialog element itself was
   * already in). Modeled here as the DOM element having diverged from React's own `open` state by
   * the time the effect re-runs — a native `<dialog>` can be opened/closed by something outside
   * this hook's control (devtools, another script) — rather than by calling `showModal`/`close`
   * twice in a row, which the effect's own `[open]` dependency array makes impossible to trigger
   * without an intervening `open` change.
   */
  it("does not call showModal() again when the dialog element is already open as the effect re-runs", () => {
    const { result, rerender } = renderHook(({ open }) => useImagePreviewModal({ open: open, onClose: vi.fn() }), {
      initialProps: { open: false },
    });
    const dialog = attachDialog(result);
    const showModal = vi.fn();
    dialog.showModal = showModal;
    dialog.close = vi.fn();
    dialog.setAttribute("open", ""); // diverged: already open before this open:false -> true transition

    rerender({ open: true });

    expect(showModal).not.toHaveBeenCalled();
  });

  it("does not call close() again when the dialog element is already closed as the effect re-runs", () => {
    const { result, rerender } = renderHook(({ open }) => useImagePreviewModal({ open: open, onClose: vi.fn() }), {
      initialProps: { open: true },
    });
    const dialog = attachDialog(result);
    dialog.showModal = vi.fn();
    const close = vi.fn();
    dialog.close = close;
    dialog.removeAttribute("open"); // diverged: already closed before this open:true -> false transition

    rerender({ open: false });

    expect(close).not.toHaveBeenCalled();
  });
});
