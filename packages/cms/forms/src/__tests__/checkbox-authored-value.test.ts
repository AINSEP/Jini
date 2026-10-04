import { describe, expect, it } from "vitest";
import { validateSubmissionPayload, validateFieldDescriptors } from "../forms.js";
import type { FieldDescriptor, FormDefinitionRecord } from "../types.js";

describe("authored checkbox values", () => {
  const definition = { fields: [{ id: "consent", label: "Consent", type: "checkbox", required: true, checkboxValue: "yes" }] } as FormDefinitionRecord;
  it("persists the posted string rather than coercing it to a boolean", () => {
    expect(validateSubmissionPayload({ definition, body: { consent: "yes" } })).toEqual({ valid: true, data: { consent: "yes" } });
  });
  it("preserves an explicitly authored empty value and still rejects an omitted required box", () => {
    expect(validateSubmissionPayload({ definition, body: { consent: "" } })).toEqual({ valid: true, data: { consent: "" } });
    expect(validateSubmissionPayload({ definition, body: {} })).toEqual({ valid: false, fieldErrors: [{ field: "consent", reason: "required" }] });
  });
  it("keeps the native default boolean and refuses arrays/objects", () => {
    const native = { ...definition, fields: definition.fields.map(({ checkboxValue: _, ...field }) => field) };
    expect(validateSubmissionPayload({ definition: native, body: { consent: "on" } })).toEqual({ valid: true, data: { consent: true } });
    for (const consent of [["yes"], { value: "yes" }]) {
      expect(validateSubmissionPayload({ definition, body: { consent } })).toEqual({ valid: false, fieldErrors: [{ field: "consent", reason: "must be a boolean" }] });
    }
  });
  it("rejects invalid authoring metadata instead of widening non-checkbox submission types", () => {
    for (const field of [{ ...definition.fields[0], type: "text" }, { ...definition.fields[0], checkboxValue: null }]) {
      expect(validateFieldDescriptors({ fields: [field as FieldDescriptor] })).toEqual({ valid: false, fieldErrors: [
        { field: "consent", reason: "checkboxValue must be a string on a checkbox field" },
      ] });
    }
  });
});
