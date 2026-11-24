// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { MailCaptureClearAnswer } from "@jini-ai/core/contracts/mail";
import { STALE_CAPTURE_MESSAGE, useCaptureClearFlow, useEmailActivity } from "../hooks/use-email-activity.hooks.js";

/** @file The clear-all-test-emails flow: preview first, a reviewed revision to confirm, plain-words failures, owner-only visibility. */
class FakeApiError extends Error { readonly status: number; constructor({ message, status }: { message: string; status: number }) { super(message); this.status = status; } }
const PREVIEW: MailCaptureClearAnswer = { cleared: false, confirmationRequired: true, plan: { count: 3, newestAt: "2026-11-24T10:00:00Z" }, revision: "3:2026-11-24T10:00:00Z" };

type ClearMock = Mock<(options?: { confirm?: { revision: string } }) => Promise<MailCaptureClearAnswer>>;
const previewing = (): ClearMock => vi.fn(async (_options?: { confirm?: { revision: string } }) => PREVIEW);

function setup(over: { permissions?: readonly string[]; clearCaptured?: ClearMock | undefined } = {}) {
  const clearCaptured = "clearCaptured" in over ? over.clearCaptured : previewing();
  const api = clearCaptured ? { clearCaptured } : {};
  const view = renderHook(() => useCaptureClearFlow({ api, permissions: over.permissions ?? ["mail.capture.clear"], ApiError: FakeApiError }));
  return { ...view, clearCaptured: clearCaptured as ClearMock };
}

describe("useCaptureClearFlow", () => {
  it.each([
    ["the owner wildcard", ["*"], true],
    ["the exact grant", ["mail.capture.clear"], true],
    ["only the suppression grant", ["mail.suppressions.manage"], false],
    ["permissions not known yet", undefined, false],
  ] as const)("offers the action for %s: %s", (_name, permissions, expected) => {
    const { result } = renderHook(() => useCaptureClearFlow({ api: { clearCaptured: vi.fn() }, permissions, ApiError: FakeApiError }));
    expect(result.current.canClear).toBe(expected);
  });

  it("does not offer the action when the host has no capture store, and start does nothing", async () => {
    const { result } = setup({ clearCaptured: undefined });
    expect(result.current.canClear).toBe(false);
    await act(() => result.current.start());
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("shows a checking state, then the previewed count, and cancel sends no confirmed request", async () => {
    let release: (answer: MailCaptureClearAnswer) => void = () => {};
    const clearCaptured: ClearMock = vi.fn((_options?: { confirm?: { revision: string } }) => new Promise<MailCaptureClearAnswer>((resolve) => { release = resolve; }));
    const { result } = setup({ clearCaptured });
    act(() => { void result.current.start(); });
    expect(result.current.state).toEqual({ kind: "checking" });
    await act(async () => release(PREVIEW));
    expect(result.current.state).toMatchObject({ kind: "confirm", plan: { count: 3 }, pending: false, error: null });
    act(() => result.current.cancel());
    expect(result.current.state).toEqual({ kind: "idle" });
    await act(() => result.current.confirm());
    expect(clearCaptured).toHaveBeenCalledTimes(1);
    expect(clearCaptured).toHaveBeenCalledWith();
  });

  it("confirms with exactly the previewed revision and reports how many were cleared", async () => {
    const { result, clearCaptured } = setup();
    await act(() => result.current.start());
    clearCaptured.mockResolvedValueOnce({ cleared: true, deleted: 3 });
    await act(() => result.current.confirm());
    expect(clearCaptured).toHaveBeenLastCalledWith({ confirm: { revision: PREVIEW.revision } });
    expect(result.current.state).toEqual({ kind: "cleared", deleted: 3 });
    expect(clearCaptured).toHaveBeenCalledTimes(2);
  });

  it("refreshes the send list once after a confirmed clear, and not after cancel or a failure", async () => {
    const onCleared = vi.fn();
    const clearCaptured = previewing();
    const { result } = renderHook(() => useCaptureClearFlow({ api: { clearCaptured }, permissions: ["*"], ApiError: FakeApiError }, { onCleared }));
    await act(() => result.current.start());
    act(() => result.current.cancel());
    await act(() => result.current.start());
    clearCaptured.mockRejectedValueOnce(new FakeApiError({ message: "Try again in a minute.", status: 503 }));
    await act(() => result.current.confirm());
    expect(onCleared).not.toHaveBeenCalled();
    clearCaptured.mockResolvedValueOnce({ cleared: true, deleted: 3 });
    await act(() => result.current.confirm());
    expect(onCleared).toHaveBeenCalledTimes(1);
  });

  it("says there is nothing to clear when the preview counts none, and never sends a confirmed request", async () => {
    const { result, clearCaptured } = setup({ clearCaptured: vi.fn(async () => ({ ...PREVIEW, plan: { count: 0, newestAt: null }, revision: "0:" })) });
    await act(() => result.current.start());
    expect(result.current.state).toEqual({ kind: "empty" });
    await act(() => result.current.confirm());
    expect(clearCaptured).toHaveBeenCalledTimes(1);
  });

  it("answers a changed set (HTTP 400) in plain words and asks for a fresh review instead of retrying the old revision", async () => {
    const { result, clearCaptured } = setup();
    await act(() => result.current.start());
    clearCaptured.mockRejectedValueOnce(new FakeApiError({ message: "Captured test emails changed or no reviewed revision was supplied. Review and confirm again.", status: 400 }));
    await act(() => result.current.confirm());
    expect(result.current.state).toEqual({ kind: "error", message: STALE_CAPTURE_MESSAGE });
    expect(STALE_CAPTURE_MESSAGE).toBe("The test emails changed. Review and confirm again.");
    clearCaptured.mockResolvedValueOnce({ ...PREVIEW, plan: { count: 4, newestAt: null }, revision: "4:" });
    await act(() => result.current.start());
    expect(result.current.state).toMatchObject({ kind: "confirm", plan: { count: 4 } });
  });

  it("names the owner when the server refuses the preview, and shows other failures' own safe message", async () => {
    const forbidden = setup({ clearCaptured: vi.fn(async () => { throw new FakeApiError({ message: "not authorized for 'mail.capture.clear'", status: 403 }); }) });
    await act(() => forbidden.result.current.start());
    expect(forbidden.result.current.state).toEqual({ kind: "error", message: "Only the site owner can clear test emails." });
    const down = setup({ clearCaptured: vi.fn(async () => { throw new FakeApiError({ message: "Try again in a minute.", status: 503 }); }) });
    await act(() => down.result.current.start());
    await waitFor(() => expect(down.result.current.state).toEqual({ kind: "error", message: "Try again in a minute." }));
  });

  it("keeps the dialog open with the failure when a confirmed clear fails for another reason", async () => {
    const { result, clearCaptured } = setup();
    await act(() => result.current.start());
    clearCaptured.mockRejectedValueOnce(new FakeApiError({ message: "Try again in a minute.", status: 503 }));
    await act(() => result.current.confirm());
    expect(result.current.state).toMatchObject({ kind: "confirm", pending: false, error: "Try again in a minute.", plan: { count: 3 } });
  });
});

describe("useEmailActivity takes its load and capture-clear hooks from the host", () => {
  it("uses the injected useLoadHook and useCaptureClearFlowHook, not its own module's", () => {
    const flow = { canClear: true, state: { kind: "idle" as const }, start: vi.fn(), confirm: vi.fn(), cancel: vi.fn() };
    const useCaptureClearFlowHook = vi.fn(() => flow);
    const useLoadHook = vi.fn(() => ({ view: { kind: "loading" as const }, reload: vi.fn(), setData: vi.fn() }));
    const pending = () => new Promise<never>(() => {});
    const api = { listActivity: vi.fn(pending), getActivity: vi.fn(pending), listSuppressions: vi.fn(pending), removeSuppression: vi.fn(pending), readFeedback: vi.fn(pending), clearCaptured: vi.fn(pending) };
    const { result } = renderHook(() => useEmailActivity({ api, ApiError: FakeApiError, useLoadHook, useCaptureClearFlowHook }, { debounceMs: 0, permissions: ["*"] }));
    expect(result.current.capture).toBe(flow);
    expect(useCaptureClearFlowHook).toHaveBeenCalledWith(expect.objectContaining({ api, permissions: ["*"], ApiError: FakeApiError }), expect.objectContaining({ onCleared: expect.any(Function) }));
    expect(useLoadHook).toHaveBeenCalledWith(expect.objectContaining({ ApiError: FakeApiError }));
    expect(api.readFeedback).not.toHaveBeenCalled();
    expect(api.clearCaptured).not.toHaveBeenCalled();
  });
});
