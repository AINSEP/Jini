import type { FormDefinitionRecord, FieldDescriptor } from "../index.js";
import type { HtmlFormDefinitionRecord } from "./html-authoring.js";

/** Compatibility for the installed Jini release, which accepts boolean checkbox answers only.
 * Jini's next release natively reads checkboxValue; until then this CMS HTML adapter presents
 * authored checkbox strings as text to the same validator. It changes no durable descriptor.
 * Empty authored values are successful controls; missing required controls must still fail. */
export function htmlSubmissionDefinition(
  { definition, body }: { definition: FormDefinitionRecord; body: Record<string, unknown> },
  _optional = {},
): FormDefinitionRecord {
  if ((definition as HtmlFormDefinitionRecord).mode !== "html") return definition;
  return { ...definition, fields: definition.fields.map((field) => {
    const checkbox = field as FieldDescriptor & { checkboxValue?: string };
    if (field.type !== "checkbox" || checkbox.checkboxValue === undefined || typeof body[field.id] !== "string") return field;
    return { ...field, type: "text" as const, required: false };
  }) };
}
