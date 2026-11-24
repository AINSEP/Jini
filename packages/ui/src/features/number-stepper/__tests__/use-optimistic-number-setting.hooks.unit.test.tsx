import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useOptimisticNumberSetting } from "../use-optimistic-number-setting.hooks.js";

const bounds = { min: 1, max: 5 };
type Write = (input: { next: number }) => Promise<unknown>;

function setup({ write, initial = 2, onSaveFailure }: { write?: Write | undefined; initial?: number; onSaveFailure?: (input: { failure: unknown }) => void }) {
  return renderHook(() => {
    const [value, setNext] = useState(initial);
    const setValue = ({ next }: { next: number }) => setNext(next);
    return useOptimisticNumberSetting({ value, setValue, write, bounds, saveError: "Could not save." }, onSaveFailure ? { onSaveFailure } : {});
  });
}

describe("useOptimisticNumberSetting", () => {
  it("is unavailable with no persistence write, and a save then does nothing", () => {
    const view = setup({ write: undefined });
    expect(view.result.current.available).toBe(false);
    act(() => view.result.current.save({ next: 4 }));
    expect(view.result.current.value).toBe(2);
  });

  it("shows a save at once, then the value the store answered, clamped to the upper limit", async () => {
    const write = vi.fn<Write>(async ({ next }) => next + 10);
    const view = setup({ write });
    expect(view.result.current.available).toBe(true);
    await act(async () => view.result.current.save({ next: 4 }));
    expect(write).toHaveBeenCalledWith({ next: 4 });
    expect(view.result.current.value).toBe(5);
    expect(view.result.current.error).toBeNull();
  });

  it("keeps the saved value when the store answers something that is not a whole number in range", async () => {
    const view = setup({ write: async () => "ok" });
    await act(async () => view.result.current.save({ next: 3 }));
    expect(view.result.current.value).toBe(3);
  });

  it("saves nothing when the value does not change", async () => {
    const write = vi.fn<Write>(async () => 2);
    const view = setup({ write });
    await act(async () => view.result.current.save({ next: 2 }));
    expect(write).not.toHaveBeenCalled();
  });

  it("puts the previous value back on a failed save, shows the injected copy, reports the failure, and clears it on the next save", async () => {
    const onSaveFailure = vi.fn();
    let fail = true;
    const view = setup({ write: async ({ next }) => { if (fail) throw new Error("disk full"); return next; }, onSaveFailure });
    await act(async () => view.result.current.save({ next: 4 }));
    expect(view.result.current.value).toBe(2);
    expect(view.result.current.error).toBe("Could not save.");
    expect(onSaveFailure).toHaveBeenCalledWith({ failure: new Error("disk full") });
    fail = false;
    await act(async () => view.result.current.save({ next: 3 }));
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.value).toBe(3);
  });

  it("a failed save without a reporter still rolls back", async () => {
    const view = setup({ write: async () => { throw "nope"; } });
    await act(async () => view.result.current.save({ next: 5 }));
    expect(view.result.current.value).toBe(2);
    expect(view.result.current.error).toBe("Could not save.");
  });
});
