// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useFocusTrap } from "@jini-ai/ui/panel-kit";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { useSkillConfirmation } from "../use-skill-confirmation.hooks.js";

// The dialog's Tab containment comes from the kit's focus trap; mount the UI library's real one.
const kit = fakeAdminKit({ hooks: { useFocusTrap } });
const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;

afterEach(() => { document.body.replaceChildren(); });

it("focuses Cancel, traps Tab, cancels on Escape and returns focus to the opener", () => {
  const opener = document.createElement("button");
  const dialog = document.createElement("div");
  const cancel = document.createElement("button");
  const confirm = document.createElement("button");
  dialog.append(cancel, confirm);
  document.body.append(opener, dialog);
  opener.focus();
  const onCancel = vi.fn();
  const { result, rerender, unmount } = renderHook(({ active }) => useSkillConfirmation({ active: active, onCancel: onCancel }), { initialProps: { active: false }, wrapper });
  result.current.dialogRef.current = dialog;
  rerender({ active: true });
  expect(document.activeElement).toBe(cancel);
  confirm.focus();
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  act(() => document.dispatchEvent(tab));
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(cancel);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
  expect(document.activeElement).toBe(confirm);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onCancel).toHaveBeenCalledTimes(1);
  rerender({ active: false });
  expect(document.activeElement).toBe(opener);
  unmount();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("keeps focus inside the dialog when the busy cancellation callback changes", () => {
  const dialog = document.createElement("div");
  const cancel = document.createElement("button");
  const confirm = document.createElement("button");
  dialog.append(cancel, confirm);
  document.body.append(dialog);
  const firstCancel = vi.fn();
  const busyCancel = vi.fn();
  const { result, rerender } = renderHook(({ active, onCancel }) => useSkillConfirmation({ active: active, onCancel: onCancel }), { initialProps: { active: false, onCancel: firstCancel }, wrapper });
  result.current.dialogRef.current = dialog;
  rerender({ active: true, onCancel: firstCancel });
  confirm.focus();
  rerender({ active: true, onCancel: busyCancel });
  expect(document.activeElement).toBe(confirm);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(firstCancel).not.toHaveBeenCalled();
  expect(busyCancel).toHaveBeenCalledTimes(1);
});
