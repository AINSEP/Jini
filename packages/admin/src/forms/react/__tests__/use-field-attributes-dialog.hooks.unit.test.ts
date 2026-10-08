import { createElement } from "react";
import type { FormEvent } from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminFormField } from "../../models.js";
import { FieldAttributesDialog } from "../components/FieldAttributesDialog.js";
import { useFieldAttributesDialog } from "../hooks/use-field-attributes-dialog.hooks.js";

const field: AdminFormField = {
  id: "email", label: "Email", type: "email", required: true,
  className: "old-class", attributes: { "aria-label": "Old email", "data-section": "contact" },
};

function setup(input: AdminFormField = field) {
  const onSave = vi.fn();
  const hook = renderHook(() => useFieldAttributesDialog({ field: input, onSave, onCancel: vi.fn() }));
  function submit() {
    const event = new Event("submit", { cancelable: true });
    act(() => hook.result.current.submit(event as unknown as FormEvent));
    expect(event.defaultPrevented).toBe(true);
  }
  return { ...hook, onSave, submit };
}

describe("field-attributes draft and submit contract", () => {
  // F2.3/F2.4/F2.5: retaining an obsolete onCancel must fail without submitting the draft.
  // Jini owns native cancellation now; exercise the actual rendered domain boundary.
  it("delivers native cancel to the current callback without submitting the draft", () => {
    const first = vi.fn(), second = vi.fn(), onSave = vi.fn();
    const props = { field, fieldIndex: 0, onSave, t: (key: string) => key };
    const { rerender, unmount } = render(createElement(FieldAttributesDialog, { ...props, onCancel: first }));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(first.mock.calls).toEqual([]);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(first.mock.calls).toEqual([[]]);
    rerender(createElement(FieldAttributesDialog, { ...props, onCancel: second }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(first.mock.calls).toEqual([[]]);
    expect(second.mock.calls).toEqual([[]]);
    expect(onSave.mock.calls).toEqual([]);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(second.mock.calls).toEqual([[]]);
  });

  // F2.5/F4.3: sending the original draft, updating every row, or removing the wrong row fails.
  // The hook's public output is the interface used by FormEditor; its real UI save is a sibling test.
  it("seeds stored attributes, edits by row identity, removes one row and submits the edited patch", () => {
    const { result, onSave, submit } = setup();
    expect(result.current.className).toBe("old-class");
    expect(result.current.rows.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "aria-label", value: "Old email" }, { name: "data-section", value: "contact" },
    ]);
    const emailRow = result.current.rows.find((row) => row.name === "aria-label")!;
    const sectionRow = result.current.rows.find((row) => row.name === "data-section")!;
    expect(emailRow).toBeDefined();
    expect(sectionRow).toBeDefined();
    act(() => {
      result.current.setClassName("  new-class  ");
      result.current.updateRow(emailRow._rowId, { value: "Work email" });
      result.current.removeRow(sectionRow._rowId);
      result.current.addRow();
    });
    const added = result.current.rows.find((row) => row.name === "")!;
    expect(added).toBeDefined();
    expect(added.value).toBe("");
    expect(added._rowId).not.toBe(emailRow._rowId);
    expect(added._rowId).not.toBe(sectionRow._rowId);
    act(() => result.current.updateRow(added._rowId, { name: " title ", value: "Email help" }));
    submit();
    expect(onSave.mock.calls).toEqual([[{
      className: "new-class", attributes: { "aria-label": "Work email", title: "Email help" },
    }]]);
    expect(field.attributes).toEqual({ "aria-label": "Old email", "data-section": "contact" });
  });

  // F6.2: removing setError(null) or saving despite validation failure must fail.
  it("rejects an event-handler attribute, then clears the error when the row is repaired and saved", () => {
    const { result, onSave, submit } = setup({ ...field, attributes: { onclick: "alert(1)" } });
    submit();
    expect(result.current.error).toBe('Attribute "onclick" isn\'t allowed. Use aria-*, data-*, or one of the suggested names.');
    expect(onSave).not.toHaveBeenCalled();
    const row = result.current.rows.find((r) => r.name === "onclick")!;
    act(() => result.current.updateRow(row._rowId, { name: "data-action", value: "contact" }));
    submit();
    expect(result.current.error).toBeNull();
    expect(onSave.mock.calls).toEqual([[{ className: "old-class", attributes: { "data-action": "contact" } }]]);
  });

  // F4.4: each limit fixture has otherwise valid values so another guard cannot mask it.
  it("accepts 300 CSS characters and refuses 301 without delivering a second save", () => {
    const { result, onSave, submit } = setup({ ...field, attributes: undefined });
    act(() => result.current.setClassName("x".repeat(300)));
    submit();
    expect(onSave.mock.calls).toEqual([[{ className: "x".repeat(300), attributes: undefined }]]);
    act(() => result.current.setClassName("x".repeat(301)));
    submit();
    expect(result.current.error).toBe("CSS classes must be at most 300 characters.");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("refuses 13 named attributes, then permits the remaining 12 after a row is removed", () => {
    const attributes = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`data-key-${i}`, `value-${i}`]));
    const { result, onSave, submit } = setup({ ...field, attributes });
    submit();
    expect(result.current.error).toBe("At most 12 attributes are allowed per field.");
    expect(onSave).not.toHaveBeenCalled();
    const row = result.current.rows.find((r) => r.name === "data-key-12")!;
    act(() => result.current.removeRow(row._rowId));
    submit();
    expect(result.current.error).toBeNull();
    expect(onSave.mock.calls).toEqual([[{ className: "old-class", attributes: {
      "data-key-0": "value-0", "data-key-1": "value-1", "data-key-2": "value-2",
      "data-key-3": "value-3", "data-key-4": "value-4", "data-key-5": "value-5",
      "data-key-6": "value-6", "data-key-7": "value-7", "data-key-8": "value-8",
      "data-key-9": "value-9", "data-key-10": "value-10", "data-key-11": "value-11",
    } }]]);
  });

  it("submits undefined properties for an empty draft, ignoring a blank trailing attribute row", () => {
    const { result, onSave, submit } = setup({ ...field, className: undefined, attributes: undefined });
    expect(result.current.className).toBe("");
    expect(result.current.rows).toEqual([]);
    act(() => { result.current.setClassName("   "); result.current.addRow(); });
    submit();
    expect(onSave.mock.calls).toEqual([[{ className: undefined, attributes: undefined }]]);
  });
});
