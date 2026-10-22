import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { AdminFormField } from "../../models.js";
import { useFormFieldsEditor } from "../hooks/use-form-fields-editor.hooks.js";

afterEach(() => vi.restoreAllMocks());

// F2.5/F4.3: a wrong index, mutation of props, or closing over first-render fields must fail.
it("edits only the requested field, adds a blank field, removes the chosen field and uses fresh props", () => {
  const fields: AdminFormField[] = [
    { id: "email", label: "Email", type: "email", required: true },
    { id: "message", label: "Message", type: "textarea", required: false },
  ];
  const onChange = vi.fn();
  const { result, rerender } = renderHook((props) => useFormFieldsEditor(props), { initialProps: { fields, onChange } });
  act(() => result.current.updateField(1, { label: "Your message", required: true }));
  expect(onChange.mock.calls).toEqual([[[
    { id: "email", label: "Email", type: "email", required: true },
    { id: "message", label: "Your message", type: "textarea", required: true },
  ]]]);
  expect(fields.find((f) => f.id === "message")).toEqual({ id: "message", label: "Message", type: "textarea", required: false });

  const next: AdminFormField[] = [{ id: "phone", label: "Phone", type: "text", required: false }];
  rerender({ fields: next, onChange });
  act(() => result.current.addField());
  expect(onChange).toHaveBeenLastCalledWith([
    { id: "phone", label: "Phone", type: "text", required: false },
    { id: "", label: "", type: "text", required: false },
  ]);
  rerender({ fields, onChange });
  act(() => result.current.removeField(0));
  expect(onChange).toHaveBeenLastCalledWith([{ id: "message", label: "Message", type: "textarea", required: false }]);
  expect(onChange).toHaveBeenCalledTimes(3);
});

// F2.1/F1.6: focusing row zero instead of the opener must fail; actual DOM focus, no focus spy.
it("returns focus to the chosen row's trigger when its attributes dialog closes", () => {
  const first = document.createElement("button");
  const second = document.createElement("button");
  const editor = document.createElement("input");
  document.body.append(first, second, editor);
  try {
    const { result } = renderHook(() => useFormFieldsEditor({ fields: [], onChange: vi.fn() }));
    expect(result.current.editingAttrsIndex).toBeNull();
    result.current.kebabRefs.current = [first, second];
    act(() => result.current.openAttrsDialog(1));
    expect(result.current.editingAttrsIndex).toBe(1);
    editor.focus();
    expect(document.activeElement).toBe(editor);
    act(() => result.current.closeAttrsDialog());
    expect(result.current.editingAttrsIndex).toBeNull();
    expect(document.activeElement).toBe(second);

    editor.focus();
    act(() => result.current.closeAttrsDialog());
    expect(document.activeElement).toBe(editor);
    act(() => result.current.openAttrsDialog(2));
    act(() => result.current.closeAttrsDialog());
    expect(result.current.editingAttrsIndex).toBeNull();
    expect(document.activeElement).toBe(editor);
  } finally {
    first.remove(); second.remove(); editor.remove();
  }
});
