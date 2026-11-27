// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../__tests__/fetch-query-support.js";
import { useThemePageDetailsModal } from "../ThemePageDetailsModal.hooks.js";

function Details({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dialogRef, handleNativeCancel, handleBackdropClick } = useThemePageDetailsModal({ open, onClose });
  return <dialog ref={dialogRef} aria-label="About template" onCancel={handleNativeCancel} onClick={handleBackdropClick}>
    <button type="button">Template metadata</button>
  </dialog>;
}

it("keeps the native dialog controlled and routes cancellation and backdrop clicks, not inner clicks", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const view = render(<Details open={false} onClose={onClose} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<Details open onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "About template" });
  await user.click(screen.getByRole("button", { name: "Template metadata" }));
  expect(onClose.mock.calls).toEqual([]);
  // jsdom lacks the native top layer. Dispatch its cancel event to the actual dialog.
  const cancel = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose.mock.calls).toEqual([[]]);
  expect(dialog).toHaveAttribute("open");
  await user.click(dialog);
  expect(onClose.mock.calls).toEqual([[], []]);
  view.rerender(<Details open={false} onClose={onClose} />);
  expect(dialog).not.toHaveAttribute("open");
  expect(screen.queryByRole("dialog")).toBeNull();
});
