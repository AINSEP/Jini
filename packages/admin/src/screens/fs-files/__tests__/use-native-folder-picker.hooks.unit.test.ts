// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useNativeFolderPicker, type UseNativeFolderPickerInput } from "../hooks/use-native-folder-picker.hooks.js";

/**
 * @file The composer folder button's logic: shown only once the server confirms it can open a folder
 * dialog on this machine, one pick at a time, a cancel is a no-op, and a failure hides the button.
 */

/** Stands in for the host's HTTP error class; the host's `isDialogAlreadyOpen` reads its status. */
class FakeHttpError extends Error {
  constructor(readonly status: number) { super(`status ${status}`); }
}

/** The host binding under test: only a 409 means "a dialog is already open". */
const isDialogAlreadyOpen: UseNativeFolderPickerInput["isDialogAlreadyOpen"] = ({ error }) => error instanceof FakeHttpError && error.status === 409;

function setup(requests: Pick<UseNativeFolderPickerInput, "probe" | "pick">) {
  const onPicked = vi.fn();
  const onFailed = vi.fn();
  const hook = renderHook(() => useNativeFolderPicker({ onPicked, onFailed, isDialogAlreadyOpen, ...requests }));
  return { ...hook, onPicked, onFailed };
}

it("stays hidden until the server confirms, and hidden for good when it refuses", async () => {
  const shown = setup({ probe: async () => ({ available: true }), pick: vi.fn() });
  expect(shown.result.current.available).toBe(false);
  await waitFor(() => expect(shown.result.current.available).toBe(true));

  const refused = setup({ probe: async () => { throw new FakeHttpError(404); }, pick: vi.fn() });
  await act(async () => { await Promise.resolve(); });
  expect(refused.result.current.available).toBe(false);
});

it("hands a picked path on, and treats a cancel as nothing at all", async () => {
  const pick = vi.fn().mockResolvedValueOnce({ path: "/Users/la/My Project" }).mockResolvedValueOnce({ path: null });
  const { result, onPicked, onFailed } = setup({ probe: async () => ({ available: true }), pick });
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(async () => { result.current.pickFolder(); });
  expect(onPicked).toHaveBeenCalledWith("/Users/la/My Project");
  await act(async () => { result.current.pickFolder(); });
  expect(onPicked).toHaveBeenCalledOnce();
  expect(onFailed).not.toHaveBeenCalled();
  expect(result.current.available).toBe(true);
});

it("ignores a second click while the dialog is open", async () => {
  let release!: (value: { path: string | null }) => void;
  const pick = vi.fn(() => new Promise<{ path: string | null }>((resolve) => { release = resolve; }));
  const { result, onPicked } = setup({ probe: async () => ({ available: true }), pick });
  await waitFor(() => expect(result.current.available).toBe(true));
  act(() => { result.current.pickFolder(); });
  expect(result.current.picking).toBe(true);
  act(() => { result.current.pickFolder(); });
  expect(pick).toHaveBeenCalledOnce();
  await act(async () => { release({ path: "/a" }); });
  expect(result.current.picking).toBe(false);
  expect(onPicked).toHaveBeenCalledWith("/a");
});

it("a failed dialog hides the button and reports it; a busy answer (another tab) does neither", async () => {
  const pick = vi.fn().mockRejectedValueOnce(new FakeHttpError(409)).mockRejectedValueOnce(new FakeHttpError(500));
  const { result, onFailed } = setup({ probe: async () => ({ available: true }), pick });
  await waitFor(() => expect(result.current.available).toBe(true));
  await act(async () => { result.current.pickFolder(); });
  expect([result.current.available, onFailed.mock.calls.length]).toEqual([true, 0]);
  await act(async () => { result.current.pickFolder(); });
  expect([result.current.available, onFailed.mock.calls.length]).toEqual([false, 1]);
});
