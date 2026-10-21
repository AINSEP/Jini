import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminFormField } from "../../models.js";
import { FormFieldsEditor } from "../components/FormFieldsEditor.js";
import { FieldAttributesDialog } from "../components/FieldAttributesDialog.js";

/**
 * @file Operator edits on a rendered field row and in the field settings dialog: every row input
 * and every dialog control writes its own field of the draft, observed through `onChange`/`onSave`.
 */

afterEach(cleanup);
const t = (key: string) => key;

function Host({ initial, existing = [], onChange }: { initial: AdminFormField[]; existing?: string[]; onChange: (fields: AdminFormField[]) => void }) {
  const [fields, setFields] = useState(initial);
  return <FormFieldsEditor fields={fields} existingFieldIds={existing} t={t} onChange={(next) => { onChange(next); setFields(next); }} />;
}

describe("field rows", () => {
  it("writes id, label, required and max length edits into the draft", () => {
    const onChange = vi.fn();
    render(<Host initial={[{ id: "", label: "", type: "text", required: false }]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Field 1 id"), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText("Field 1 label"), { target: { value: "Email" } });
    fireEvent.click(screen.getByLabelText("Field 1 required"));
    fireEvent.change(screen.getByLabelText("Field 1 max length"), { target: { value: "120" } });
    expect(onChange.mock.lastCall?.[0]).toEqual([expect.objectContaining({ id: "email", label: "Email", required: true, maxLength: 120 })]);
    fireEvent.change(screen.getByLabelText("Field 1 max length"), { target: { value: "" } });
    expect(onChange.mock.lastCall?.[0][0].maxLength).toBeNull();
  });

  it("removes only the row whose Remove button is pressed", () => {
    const onChange = vi.fn();
    const fields: AdminFormField[] = [{ id: "a", label: "A", type: "text", required: false }, { id: "b", label: "B", type: "text", required: false }];
    render(<Host initial={fields} onChange={onChange} />);
    const rows = screen.getAllByRole("row").slice(1);
    fireEvent.click(within(rows[0]!).getByRole("button", { name: /Remove/ }));
    expect(onChange.mock.lastCall?.[0].map((f: AdminFormField) => f.id)).toEqual(["b"]);
  });
});

describe("field settings dialog", () => {
  it("edits and removes HTML attribute rows before saving", () => {
    const onSave = vi.fn();
    const field: AdminFormField = { id: "email", label: "Email", type: "email", required: false, attributes: { "aria-label": "Old", "data-section": "contact" } };
    render(<FieldAttributesDialog field={field} fieldIndex={0} onSave={onSave} onCancel={vi.fn()} t={t} />);
    const values = screen.getAllByLabelText("Value");
    fireEvent.change(values[0]!, { target: { value: "Work email" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0].attributes).toEqual({ "aria-label": "Work email" });
  });

  it("edits option values, ticks a multi-choice default and removes an option", () => {
    const onSave = vi.fn();
    const field: AdminFormField = { id: "topics", label: "Topics", type: "checkbox-group", required: false,
      options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }] };
    render(<FieldAttributesDialog field={field} fieldIndex={0} onSave={onSave} onCancel={vi.fn()} t={t} />);
    fireEvent.change(screen.getByLabelText("Option 2 value"), { target: { value: "beta" } });
    fireEvent.click(screen.getByLabelText("Option 2 selected by default"));
    fireEvent.click(screen.getByLabelText("Remove option 3"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const patch = onSave.mock.calls[0]![0];
    expect(patch.options).toEqual([{ value: "a", label: "Alpha" }, { value: "beta", label: "Beta" }]);
    expect(patch.default).toEqual(["beta"]);
  });

  it("toggles accepted upload types for a file field", () => {
    const onSave = vi.fn();
    const field: AdminFormField = { id: "cv", label: "CV", type: "file", required: false, accept: ["image/*"] };
    render(<FieldAttributesDialog field={field} fieldIndex={0} onSave={onSave} onCancel={vi.fn()} t={t} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Images" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Videos" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]![0].accept).toEqual(["video/*"]);
  });
});
