import { describe, expect, it, vi } from "vitest";
import { unchangedSaveHandlers } from "../unchanged-save-warning.js";

// An open Interactive text session only reports its edit when it closes, so `dirty` is still false
// at the moment Save is pressed; Save must flush first instead of showing "Nothing changed".
describe("unchangedSaveHandlers pending-edit flush", () => {
  const harness = (outcome: "changed" | "unchanged" | "failed") => {
    const save = vi.fn(async () => {});
    const setConfirmingUnchangedSave = vi.fn();
    const flushPendingEdits = vi.fn(async () => outcome);
    const handlers = unchangedSaveHandlers({ dirty: false, save, setConfirmingUnchangedSave }, { flushPendingEdits });
    return { save, setConfirmingUnchangedSave, flushPendingEdits, handlers };
  };

  it("saves without the warning when the flush surfaces an unsaved edit", async () => {
    const { save, setConfirmingUnchangedSave, flushPendingEdits, handlers } = harness("changed");
    handlers.onSave();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(flushPendingEdits).toHaveBeenCalledTimes(1);
    expect(setConfirmingUnchangedSave).not.toHaveBeenCalled();
  });

  it("still warns when the flush finds nothing new", async () => {
    const { save, setConfirmingUnchangedSave, handlers } = harness("unchanged");
    handlers.onSave();
    await vi.waitFor(() => expect(setConfirmingUnchangedSave).toHaveBeenCalledWith(true));
    expect(save).not.toHaveBeenCalled();
  });

  it("neither saves nor warns when the flush failed (it showed its own error)", async () => {
    const { save, setConfirmingUnchangedSave, flushPendingEdits, handlers } = harness("failed");
    handlers.onSave();
    await vi.waitFor(() => expect(flushPendingEdits).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    expect(setConfirmingUnchangedSave).not.toHaveBeenCalled();
  });

  it("a dirty editor saves straight away without flushing twice", async () => {
    const save = vi.fn(async () => {});
    const flushPendingEdits = vi.fn(async () => "changed" as const);
    unchangedSaveHandlers({ dirty: true, save, setConfirmingUnchangedSave: vi.fn() }, { flushPendingEdits }).onSave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(flushPendingEdits).not.toHaveBeenCalled();
  });
});

// L13 Stryker: lines 28–29 and 32 (Save anyway / Cancel) and the no-flush default had no coverage.
describe("unchangedSaveHandlers warning buttons", () => {
  it("without a flush, a clean Save opens the warning and does not save", async () => {
    const save = vi.fn(async () => {});
    const setConfirmingUnchangedSave = vi.fn();
    unchangedSaveHandlers({ dirty: false, save, setConfirmingUnchangedSave }).onSave();
    await vi.waitFor(() => expect(setConfirmingUnchangedSave).toHaveBeenCalledWith(true));
    expect(save).not.toHaveBeenCalled();
  });
  it("Save anyway closes the warning, then saves once", () => {
    const calls: string[] = [];
    const handlers = unchangedSaveHandlers({ dirty: false, save: async () => { calls.push("save"); }, setConfirmingUnchangedSave: open => calls.push(`open:${open}`) });
    handlers.onUnchangedSaveConfirm();
    expect(calls).toEqual(["open:false", "save"]);
  });
  it("Cancel only closes the warning", () => {
    const save = vi.fn(async () => {});
    const setConfirmingUnchangedSave = vi.fn();
    unchangedSaveHandlers({ dirty: false, save, setConfirmingUnchangedSave }).onUnchangedSaveCancel();
    expect(setConfirmingUnchangedSave).toHaveBeenCalledExactlyOnceWith(false);
    expect(save).not.toHaveBeenCalled();
  });
});
