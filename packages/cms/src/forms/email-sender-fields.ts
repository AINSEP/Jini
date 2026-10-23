import { redactSecrets } from "@jini-ai/core";
import type { EmailSourceField } from "@jini-ai/platform/mail/senders";
import { resolveFormField } from "./field-registry.js";
import { FIELD_ID_PATTERN } from "./forms.js";
import type { FieldDescriptor, FormDefinitionRecord, FormSubmissionRecord } from "./types.js";

const BUILTINS: readonly EmailSourceField[] = [
  { token: "site_name", label: "Site name", required: true },
  { token: "site_url", label: "Site URL", required: true },
  { token: "submitted_at", label: "Submitted at", required: true },
];
const RESERVED = new Set(BUILTINS.map(field => field.token));
const PRIVATE_FIELD = /password|passphrase|secret|token|apikey|privatekey|accesskey|credential|authorization|^auth$|^pwd$|^ip$|^sourceip$|^ipaddress$|^useragent$/;

/** Stable ids contain no dots, so a namespaced collision cannot collide with an ordinary id. */
export function formEmailFieldToken({ field }: { field: FieldDescriptor }, _optional: Record<string, never> = {}): string {
  return RESERVED.has(field.id) ? `field.${field.id}` : field.id;
}

/** Export only declared answer fields, never uploads, hidden/internal values or credential fields. */
export function emailAnswerFields({ definition }: { definition: FormDefinitionRecord }, _optional: Record<string, never> = {}): FieldDescriptor[] {
  return definition.fields.filter(field => field.type !== "file" && field.type !== "hidden"
    && FIELD_ID_PATTERN.test(field.id) && !PRIVATE_FIELD.test(field.id.replace(/[^a-z0-9]/gi, "").toLowerCase()));
}

/** Derives tokens from the submission definition, preserving requiredness and presentation labels. */
export function describeFormEmailFields({ definition }: { definition: FormDefinitionRecord }, _optional: Record<string, never> = {}): readonly EmailSourceField[] {
  return [...emailAnswerFields({ definition }).map(field => ({ token: formEmailFieldToken({ field }), label: field.label, required: field.required })), ...BUILTINS.map(field => ({ ...field }))];
}

function safeText({ value }: { value: string }, _optional: Record<string, never> = {}): string | undefined {
  // MOVE: Reuse core's credential vocabulary without treating ordinary email addresses as secrets.
  return redactSecrets({ input: value }, { redactPii: false }) === value ? value : undefined;
}

function answerText(required: { field: FieldDescriptor; value: unknown }, _optional: Record<string, never> = {}): string | undefined {
  const resolved = resolveFormField(required);
  if (resolved.kind !== "accepted") return undefined;
  const value = resolved.value;
  if (typeof value === "string") return safeText({ value });
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return safeText({ value: value.join(", ") });
  return undefined;
}

/** Copies the allowlist only. Absent/invalid values stay absent; defaults and samples never enter mail.
 * submitted_at stays ISO; formatting belongs to the template/host. Choices export option values,
 * and booleans export "true"/"false".
 * @complexity O(fields + answer bytes), bounded by Forms' field count and per-answer validators. */
export function resolveFormEmailValues(
  required: { definition: FormDefinitionRecord; submission: FormSubmissionRecord; site: { readonly name: string; readonly url: string } },
  _optional: Record<string, never> = {},
): Readonly<Record<string, string>> {
  const entries: [string, string][] = [];
  for (const field of emailAnswerFields(required)) {
    if (!Object.hasOwn(required.submission.data, field.id)) continue;
    const text = answerText({ field, value: required.submission.data[field.id] });
    if (text !== undefined) entries.push([formEmailFieldToken({ field }), text]);
  }
  entries.push(["site_name", required.site.name], ["site_url", required.site.url], ["submitted_at", required.submission.submittedAt]);
  return Object.fromEntries(entries);
}
