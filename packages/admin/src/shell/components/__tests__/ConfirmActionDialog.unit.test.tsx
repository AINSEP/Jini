// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { ConfirmActionDialog } from "../ConfirmActionDialog.js";

it("names the modal and keeps body clicks inside, while routing confirmation and both forms of cancellation", async () => {
  const user = userEvent.setup();
  const props = {
    dialogRef: createRef<HTMLDivElement>(), titleId: "archive-report-title", title: "Archive report?",
    body: "The team will no longer see this report.", cancelText: "Keep report", confirmText: "Archive report",
    cancelHandle: "keep-report", cancelAgentLabel: "Keep the current report",
    confirmHandle: "archive-report", confirmAgentLabel: "Archive the current report",
    onCancel: vi.fn(), onConfirm: vi.fn(),
  };
  const { rerender } = render(<ConfirmActionDialog {...props} extra="You can restore it later." />);
  const dialog = screen.getByRole("dialog", { name: "Archive report?" });
  expect(props.dialogRef.current).toBe(dialog);
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(within(dialog).getByText("You can restore it later.").textContent).toBe("You can restore it later.");
  const keep = within(dialog).getByRole("button", { name: "Keep report" });
  expect(document.activeElement).toBe(keep);
  await user.click(within(dialog).getByText(props.body));
  expect(props.onCancel.mock.calls).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Archive report" }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  expect(props.onCancel.mock.calls).toEqual([]);
  await user.click(keep);
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  await user.click(dialog.parentElement!);
  expect(props.onCancel).toHaveBeenCalledTimes(2);
  rerender(<ConfirmActionDialog {...props} />);
  expect(within(dialog).queryByText("You can restore it later.")).toBeNull();
});
