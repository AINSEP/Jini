import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useRemoveConfirmDialog, useAddCustomCredentialDialog } from "../AccessTokensTab.hooks.js";
import type { AccessTokenRow } from "../../access-token-rows.js";

afterEach(cleanup);

test("removal confirmation closes the dialog before invoking the stored-row removal", () => {
  const events: string[] = [];
  const ref = { current: { close: () => events.push("close") } as HTMLDialogElement };
  const row = { id: "stored" } as AccessTokenRow;
  const removeToken = vi.fn(async () => { events.push("remove"); });
  const { result } = renderHook(() => useRemoveConfirmDialog({ ref, row, controller: { removeToken } }));
  expect(removeToken).not.toHaveBeenCalled();
  result.current.confirm();
  expect(events).toEqual(["close", "remove"]);
  expect(removeToken).toHaveBeenCalledWith(row);
});

test("a custom credential needs its key, and a failed save leaves the dialog open", async () => {
  const close = vi.fn();
  const controller = {
    customAddForm: { name: "Key", category: "general" as const, baseUrl: "https://example.test", additionalHosts: "", token: "", username: "" },
    resetCustomAddForm: vi.fn(), createCustomCredential: vi.fn(async () => false),
  };
  const ref = { current: { close } as unknown as HTMLDialogElement };
  const { result, rerender } = renderHook(() => useAddCustomCredentialDialog({ ref, controller }));
  expect(result.current.readyToSave).toBe(false);
  controller.customAddForm.token = "key";
  rerender();
  expect(result.current.readyToSave).toBe(true);
  await result.current.save();
  expect(close).not.toHaveBeenCalled();
  result.current.close();
  expect(close).toHaveBeenCalledOnce();
  expect(controller.resetCustomAddForm).toHaveBeenCalledOnce();
});
