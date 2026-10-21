import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminFormDefinition, AdminFormField } from "../../models.js";
import { useFormFieldsView, useFormsListView } from "../hooks/forms-view.hooks.js";
import type { FormFieldsEditorController } from "../hooks/use-form-fields-editor.hooks.js";

const field: AdminFormField = { id: "email", label: "Email", type: "email", required: false };
function controller(editingAttrsIndex: number | null): FormFieldsEditorController {
  return { editingAttrsIndex, openAttrsDialog: vi.fn(), closeAttrsDialog: vi.fn(), kebabRefs: { current: [] },
    updateField: vi.fn(), replaceField: vi.fn(), addField: vi.fn(), removeField: vi.fn() };
}

describe("useFormFieldsView", () => {
  it("has no field to edit when the open dialog's index no longer exists in the draft", () => {
    const view = renderHook(() => useFormFieldsView({ fields: [field], existingFieldIds: [], controller: controller(3) }));
    expect(view.result.current.editingField).toBeNull();
  });

  it("ignores a settings save when no dialog is open", () => {
    const fake = controller(null);
    const view = renderHook(() => useFormFieldsView({ fields: [field], existingFieldIds: [], controller: fake }));
    view.result.current.saveAttributes({ className: "wide" });
    expect(fake.updateField).not.toHaveBeenCalled();
    expect(fake.closeAttrsDialog).not.toHaveBeenCalled();
  });

  it("saves the open dialog's patch into its field and closes it", () => {
    const fake = controller(0);
    const view = renderHook(() => useFormFieldsView({ fields: [field], existingFieldIds: [], controller: fake }));
    expect(view.result.current.editingField).toBe(field);
    view.result.current.saveAttributes({ className: "wide" });
    expect(fake.updateField).toHaveBeenCalledWith(0, { className: "wide" });
    expect(fake.closeAttrsDialog).toHaveBeenCalledTimes(1);
  });
});

describe("useFormsListView", () => {
  it("refuses to navigate to a form editor when the host wired no navigation port", () => {
    const form = { id: "f1", name: "Contact", slug: "contact", status: "active", fields: [], notify: { enabled: false, recipients: [] }, createdAt: "", updatedAt: "" } as AdminFormDefinition;
    const view = renderHook(() => useFormsListView({ forms: [form], t: (key: string) => key, formatFormDates: () => [], toggleStatus: vi.fn(async () => {}), setPendingDelete: vi.fn() }));
    const edit = view.result.current.rows[0]!.menuItems.find(item => item.key === "edit")!;
    expect(() => edit.onSelect()).toThrow("Missing forms navigation port");
  });
});
