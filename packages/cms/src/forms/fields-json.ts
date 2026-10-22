import type { FieldDescriptor, FormDefinitionRecord } from "./types.js";

export type FormAuthoring = { mode?: "builder" | "html"; html?: string | undefined };
export type HtmlFormDefinitionRecord = FormDefinitionRecord & FormAuthoring;

/** Old rows remain arrays; authored forms use the same JSON-in-text column, without a migration. */
export function decodeFormFields({ json }: { json: string }, _optional = {}): Pick<HtmlFormDefinitionRecord, "fields" | "mode" | "html"> {
  const stored = JSON.parse(json) as FieldDescriptor[] | { fields: FieldDescriptor[]; mode: "html"; html: string };
  return Array.isArray(stored) ? { fields: stored } : { fields: stored.fields, mode: stored.mode, html: stored.html };
}

export function encodeFormFields({ definition }: { definition: HtmlFormDefinitionRecord }, _optional = {}): string {
  return JSON.stringify(definition.mode === "html"
    ? { fields: definition.fields, mode: "html", html: definition.html ?? "" }
    : definition.fields);
}
