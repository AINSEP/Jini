import type { FormDefinitionRecord } from "../index.js";

/** Earlier published releases accepted boolean checkbox answers only, so their HTML view
 * presented authored strings as text. The field registry now natively validates checkboxValue,
 * choice options and file types. Keep this public adapter as identity for host compatibility:
 * changing a choice to text here would bypass the server's declared-value allowlist. */
export function htmlSubmissionDefinition(
  { definition }: { definition: FormDefinitionRecord; body: Record<string, unknown> },
  _optional = {},
): FormDefinitionRecord {
  return definition;
}
