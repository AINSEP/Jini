import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImagePreviewModal } from "../components/ImagePreviewModal";
import type { ImagePreviewModalController } from "../components/ImagePreviewModal.hooks";

/**
 * @file `ImagePreviewModal` — the click-to-expand lightbox for a theme card's screenshot thumbnail.
 * Same native-`<dialog>` shape `Pages.unit.test.tsx`'s `ConfirmDialog` assertions already exercise
 * (`dialog.hasAttribute("open")`), applied to this component's own three close paths: the close
 * button, a backdrop click, and Escape (the dialog's native `cancel` event).
 */

describe("open/closed state", () => {
  it("has no open attribute when open is false", () => {
    render(<ImagePreviewModal open={false} src="/theme-assets/basic/screenshots/index.png" alt="Basic theme preview" onClose={vi.fn()} />);
    const dialog = document.querySelector("dialog.image-preview-modal")!;
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("has the open attribute when open is true", () => {
    render(<ImagePreviewModal open={true} src="/theme-assets/basic/screenshots/index.png" alt="Basic theme preview" onClose={vi.fn()} />);
    const dialog = document.querySelector("dialog.image-preview-modal")!;
    expect(dialog.hasAttribute("open")).toBe(true);
  });
});

describe("image content", () => {
  it("renders the image at the given src with the given alt text", () => {
    render(<ImagePreviewModal open={true} src="/theme-assets/basic/screenshots/index.png" alt="Basic theme preview" onClose={vi.fn()} />);
    const img = screen.getByAltText("Basic theme preview");
    expect(img).toHaveAttribute("src", "/theme-assets/basic/screenshots/index.png");
  });
});

describe("closing", () => {
  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ImagePreviewModal open={true} src="/x.png" alt="x" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop (the dialog element itself, not a child) is clicked", () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal open={true} src="/x.png" alt="x" onClose={onClose} />);
    const dialog = document.querySelector("dialog.image-preview-modal")!;
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when a click lands on a child (the image), not the dialog's own backdrop area", () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal open={true} src="/x.png" alt="x" onClose={onClose} />);
    fireEvent.click(screen.getByAltText("x"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on the dialog's native cancel event (Escape) and prevents the browser's own close", () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal open={true} src="/x.png" alt="x" onClose={onClose} />);
    const dialog = document.querySelector("dialog.image-preview-modal")!;
    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cancelEvent.defaultPrevented).toBe(true);
  });
});

describe("ImagePreviewModal modal-hook injection", () => {
  it("renders purely off an injected fake, proving useImagePreviewModal is not hardcoded", () => {
    // A fake `dialogRef` that never points at a real element would make the real hook's effect a
    // silent no-op (`if (!dialog) return;`) — proof here comes from the handlers instead: a fake
    // `handleBackdropClick` that calls `onClose` unconditionally, regardless of click target, is
    // something the real hook never does (it always checks `e.target === dialogRef.current`
    // first).
    const onClose = vi.fn();
    function useFakeImagePreviewModal(): ImagePreviewModalController {
      return {
        dialogRef: { current: null },
        handleNativeCancel: () => {},
        handleBackdropClick: () => onClose(),
      };
    }

    render(<ImagePreviewModal open={true} src="/x.png" alt="x" onClose={vi.fn()} useModal={useFakeImagePreviewModal} />);

    // Clicking the image (a child, never the backdrop under the real hook's own guard) still
    // triggers the fake's unconditional onClose — proving this render used the fake, not the real
    // `useImagePreviewModal`.
    fireEvent.click(screen.getByAltText("x"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
