// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDirtyGuard } from "../use-dirty-guard.hooks";

/**
 * @file `useDirtyGuard` — pins the state-drift detection and both guard mechanisms
 * (`beforeunload`, `confirmLeave`) independent of any one screen's wiring. Audit finding:
 * "None of the five editor screens have any [unsaved-changes protection]" — this is the shared
 * primitive the fix-up report cites as the one-hook way to close all five at once.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isDirty", () => {
  it("is false while original is null (nothing loaded yet to compare against)", () => {
    const { result } = renderHook(() => useDirtyGuard({ current: { title: "" }, original: null }));
    expect(result.current.isDirty).toBe(false);
  });

  it("is false when current matches the loaded original", () => {
    const original = { title: "Hello", slug: "hello" };
    const { result } = renderHook(() => useDirtyGuard({ current: { title: "Hello", slug: "hello" }, original: original }));
    expect(result.current.isDirty).toBe(false);
  });

  it("is true once current diverges from original", () => {
    const original = { title: "Hello", slug: "hello" };
    const { result } = renderHook(() => useDirtyGuard({ current: { title: "Hello (edited)", slug: "hello" }, original: original }));
    expect(result.current.isDirty).toBe(true);
  });
});

describe("confirmLeave", () => {
  it("returns true without prompting when nothing is dirty", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const original = { title: "Hello" };
    const { result } = renderHook(() => useDirtyGuard({ current: { title: "Hello" }, original: original }));

    expect(result.current.confirmLeave()).toBe(true);
    expect(result.current.confirmLeave({}, { unsavedBeyondTracked: false })).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("prompts for work outside tracked state even when the tracked form is clean", () => {
    const original = { title: "Hello" };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useDirtyGuard({ current: original, original: original }));

    expect(result.current.isDirty).toBe(false);
    expect(result.current.confirmLeave({}, { unsavedBeyondTracked: true })).toBe(false);
    expect(confirmSpy).toHaveBeenCalledOnce();
    confirmSpy.mockReturnValue(true);
    expect(result.current.confirmLeave({}, { unsavedBeyondTracked: true })).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it("prompts and returns the operator's answer when dirty", () => {
    const original = { title: "Hello" };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useDirtyGuard({ current: { title: "Hello (edited)" }, original: original }));

    expect(result.current.confirmLeave()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledOnce();

    confirmSpy.mockReturnValue(true);
    expect(result.current.confirmLeave()).toBe(true);
  });
});

describe("beforeunload", () => {
  it("is prevented while dirty", () => {
    const original = { title: "Hello" };
    renderHook(() => useDirtyGuard({ current: { title: "Hello (edited)" }, original: original }));

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { value: "unchanged", writable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe("");
  });

  it("does not intercept the event while clean", () => {
    const original = { title: "Hello" };
    renderHook(() => useDirtyGuard({ current: { title: "Hello" }, original: original }));

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it("removes its listener once no longer dirty (rerender), so a stale editor can't block an unrelated later unload", () => {
    const original = { title: "Hello" };
    const { rerender } = renderHook(({ current }) => useDirtyGuard({ current: current, original: original }), {
      initialProps: { current: { title: "Hello (edited)" } },
    });

    rerender({ current: { title: "Hello" } }); // back to matching original — clean again

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });
});
