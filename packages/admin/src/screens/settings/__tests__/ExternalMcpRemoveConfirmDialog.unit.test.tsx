// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminKitProvider, useFocusTrap } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { useExternalMcpRemoveConfirm } from "../hooks/use-external-mcp-remove-confirm.hooks.js";
import { ExternalMcpRemoveConfirmDialog, type ExternalMcpRemoveConfirmFrameProps } from "../ExternalMcpRemoveConfirmDialog.js";

/** A stand-in for the host's confirmation markup: records what it was handed and exposes the two actions. */
function FakeFrame(props: ExternalMcpRemoveConfirmFrameProps) {
  return (
    <div ref={props.dialogRef} role="dialog" aria-labelledby={props.titleId} data-cancel-handle={props.cancelHandle}
      data-confirm-handle={props.confirmHandle} data-cancel-label={props.cancelAgentLabel} data-confirm-label={props.confirmAgentLabel}>
      <h2 id={props.titleId}>{props.title}</h2>
      <p>{props.body}</p>
      <button onClick={props.onCancel}>{props.cancelText}</button>
      <button onClick={props.onConfirm}>{props.confirmText}</button>
    </div>
  );
}

const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit({})}>{children}</AdminKitProvider>;

describe("ExternalMcpRemoveConfirmDialog (host dialog + copy injected)", () => {
  // Mutation: render a hard-coded title instead of `copy.title`, or swap the cancel/confirm handles — red.
  it("renders the injected frame with the injected copy, translated button text and nested handles", () => {
    const buildCopy = vi.fn(({ name, isOAuth }: { name: string; isOAuth: boolean }) => ({ title: `Drop ${name}?`, body: isOAuth ? "oauth" : "plain" }));
    render(<ExternalMcpRemoveConfirmDialog name="Atlas" isOAuth cardHandle="mcp-atlas" onConfirm={vi.fn()} onCancel={vi.fn()}
      t={(key) => `[${key}]`} ConfirmDialog={FakeFrame} useExternalMcpRemoveConfirmHook={useExternalMcpRemoveConfirm} useFocusTrapHook={useFocusTrap} buildCopy={buildCopy} />, { wrapper });
    const dialog = screen.getByRole("dialog", { name: "Drop Atlas?" });
    expect(buildCopy).toHaveBeenCalled();
    expect(screen.getByText("oauth")).toBeTruthy();
    expect(dialog.getAttribute("aria-labelledby")).toBe("mcp-atlas-remove-confirm-title");
    expect(dialog.getAttribute("data-cancel-handle")).toBe("mcp-atlas-remove-cancel");
    expect(dialog.getAttribute("data-confirm-handle")).toBe("mcp-atlas-remove-confirm");
    expect(dialog.getAttribute("data-cancel-label")).toBe("Close this dialog without removing Atlas");
    expect(dialog.getAttribute("data-confirm-label")).toBe("Permanently remove Atlas — this cannot be undone from this screen");
    expect(screen.getByRole("button", { name: "[Cancel]" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "[Remove]" })).toBeTruthy();
  });

  it("delivers Confirm and Cancel to their own callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ExternalMcpRemoveConfirmDialog name="Atlas" isOAuth={false} cardHandle="atlas" onConfirm={onConfirm} onCancel={onCancel}
      t={(key) => key} ConfirmDialog={FakeFrame} useExternalMcpRemoveConfirmHook={useExternalMcpRemoveConfirm} useFocusTrapHook={useFocusTrap} buildCopy={() => ({ title: "T", body: "B" })} />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
