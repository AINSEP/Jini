/** Pure field/submission validation and honeypot decisions. Error order and stored value normalization are stable. */
import type { FieldDescriptor, FormDefinitionRecord } from "./types.js";

// Domain validation stays independent of feature manifests, and returns decisions without I/O
// or exceptions so write and submission services can choose their own error presentation.
// Published tool schemas and render-time defensive checks use these exported bounds/patterns
// instead of restating them; validation owns the enforcement rule.
const MIN_FIELDS = 1;
export const MAX_FIELDS = 20;
const MIN_LABEL_LENGTH = 1;
export const MAX_LABEL_LENGTH = 200;
export const MIN_MAX_LENGTH = 1;
export const MAX_MAX_LENGTH = 5000;
export const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const FIELD_TYPES = new Set(["text", "email", "textarea", "checkbox"]);

export const MAX_CLASS_NAME_LENGTH = 300;
export const MAX_ATTRIBUTES_PER_FIELD = 12;
export const MAX_ATTRIBUTE_VALUE_LENGTH = 300;

/**
 * Escaping makes an attribute value inert, but cannot make a name such as onclick safe. Names
 * are deny-by-default: only aria-* and data-* namespaces and a fixed closed list are accepted.
 * Event handlers, style/formaction/href/src/srcdoc can inject behavior; id/name/type overrides
 * can break label association, submission keys or the renderer's declared field vocabulary.
 */
export const ATTRIBUTE_NAME_PATTERN =
  /^(aria-[a-z0-9-]+|data-[a-z0-9-]+|placeholder|autocomplete|inputmode|pattern|title|min|max|step|minlength|spellcheck|readonly)$/;

// Accepted as submission metadata, never as a declared field or stored answer.
export const HONEYPOT_KEY = "_hp";

export interface FieldError {
  field: string;
  reason: string;
}

export type FieldValidationResult = { valid: true } | { valid: false; fieldErrors: FieldError[] };

// Malformed IDs are never claimed: repeated malformed IDs must each report their shape error
// rather than misleading the second field's author with a duplicate-ID diagnosis.
function fieldIdErrors(descriptor: FieldDescriptor, label: string, claimedIds: Set<string>): FieldError[] {
  if (!descriptor.id || !FIELD_ID_PATTERN.test(descriptor.id)) {
    return [{ field: label, reason: "id must match ^[a-z][a-z0-9_]*$" }];
  }
  if (claimedIds.has(descriptor.id)) {
    return [{ field: descriptor.id, reason: "duplicate field id" }];
  }
  claimedIds.add(descriptor.id);
  return [];
}

function fieldTypeErrors(descriptor: FieldDescriptor, label: string): FieldError[] {
  if (!FIELD_TYPES.has(descriptor.type)) {
    return [{ field: label, reason: `type '${descriptor.type}' is not in the registered vocabulary` }];
  }
  return [];
}

function labelLengthErrors(descriptor: FieldDescriptor, label: string): FieldError[] {
  if (descriptor.label.length < MIN_LABEL_LENGTH || descriptor.label.length > MAX_LABEL_LENGTH) {
    return [{ field: label, reason: `label must be ${MIN_LABEL_LENGTH}-${MAX_LABEL_LENGTH} characters` }];
  }
  return [];
}

// A checkbox carries a boolean, so no character cap can be honored. Report that prohibition
// before any numeric range error, rather than asking the author to fix a number they must remove.
function maxLengthErrors(descriptor: FieldDescriptor, label: string): FieldError[] {
  if (descriptor.maxLength == null) return [];
  if (descriptor.type === "checkbox") {
    return [{ field: label, reason: "maxLength is forbidden for checkbox fields" }];
  }
  if (descriptor.maxLength < MIN_MAX_LENGTH || descriptor.maxLength > MAX_MAX_LENGTH) {
    return [{ field: label, reason: `maxLength must be ${MIN_MAX_LENGTH}-${MAX_MAX_LENGTH}` }];
  }
  return [];
}

// HTML-escaped class names are inert; only their length is bounded. Check type defensively
// because real inputs include parsed request bodies, regardless of the descriptor's static type.
function classNameErrors(descriptor: FieldDescriptor, label: string): FieldError[] {
  const { className } = descriptor;
  if (className == null) return [];
  if (typeof className !== "string") {
    return [{ field: label, reason: "className must be a string" }];
  }
  if (className.length > MAX_CLASS_NAME_LENGTH) {
    return [{ field: label, reason: `className must be at most ${MAX_CLASS_NAME_LENGTH} characters` }];
  }
  return [];
}

// A refused name will never render, so its value is moot. Reporting value errors as well would
// imply that correcting a value could make a structurally unsafe attribute acceptable.
function attributeEntryErrors(label: string, attrName: string, attrValue: unknown): FieldError[] {
  if (!ATTRIBUTE_NAME_PATTERN.test(attrName)) {
    return [{ field: label, reason: `attribute '${attrName}' is not allowed` }];
  }
  if (typeof attrValue !== "string") {
    return [{ field: label, reason: `attribute '${attrName}' value must be a string` }];
  }
  if (attrValue.length > MAX_ATTRIBUTE_VALUE_LENGTH) {
    return [{ field: label, reason: `attribute '${attrName}' value must be at most ${MAX_ATTRIBUTE_VALUE_LENGTH} characters` }];
  }
  return [];
}

// Exceeding the count cap still checks every attribute so the author sees unsafe names in one
// round trip. This visits O(a) caller-supplied attributes; the reported cap does not truncate work.
function attributeErrors(descriptor: FieldDescriptor, label: string): FieldError[] {
  const { attributes } = descriptor;
  if (attributes == null) return [];

  const entries = Object.entries(attributes);
  const errors: FieldError[] = [];
  if (entries.length > MAX_ATTRIBUTES_PER_FIELD) {
    errors.push({ field: label, reason: `at most ${MAX_ATTRIBUTES_PER_FIELD} attributes are allowed` });
  }
  for (const [attrName, attrValue] of entries) {
    errors.push(...attributeEntryErrors(label, attrName, attrValue));
  }
  return errors;
}

/**
 * Collect every violation, not just the first: arity errors, then descriptors in array order,
 * then each rule in the fixed order below. Callers display this list as-is, so order is observable.
 * Empty helper results mean a satisfied rule. Bounds are 1-20 fields, labels 1-200 characters,
 * and maxLength 1-5000 (never on checkboxes), with unique lowercase field IDs.
 */
export function validateFieldDescriptors({ fields }: { fields: FieldDescriptor[] }): FieldValidationResult {
  const fieldErrors: FieldError[] = [];

  if (fields.length < MIN_FIELDS) {
    fieldErrors.push({ field: "fields", reason: `at least ${MIN_FIELDS} field is required` });
  }
  if (fields.length > MAX_FIELDS) {
    fieldErrors.push({ field: "fields", reason: `at most ${MAX_FIELDS} fields are allowed` });
  }

  const claimedIds = new Set<string>();
  for (const descriptor of fields) {
    const label = descriptor.id || "(unknown)";
    fieldErrors.push(
      ...fieldIdErrors(descriptor, label, claimedIds),
      ...fieldTypeErrors(descriptor, label),
      ...labelLengthErrors(descriptor, label),
      ...maxLengthErrors(descriptor, label),
      ...classNameErrors(descriptor, label),
      ...attributeErrors(descriptor, label),
    );
  }

  if (fieldErrors.length > 0) return { valid: false, fieldErrors };
  return { valid: true };
}

export interface ValidateSubmissionPayloadInput {
  definition: FormDefinitionRecord;
  body: Record<string, unknown>;
}

export type SubmissionValidationResult =
  | { valid: true; data: Record<string, string | boolean> }
  | { valid: false; fieldErrors: FieldError[] };

// Absence is distinct from acceptance: treating an omitted optional field as an accepted value
// would write undefined and violate the guarantee that stored answers contain only declared keys.
type SubmittedValue =
  | { kind: "absent" }
  | { kind: "rejected"; reason: string }
  | { kind: "accepted"; value: string | boolean };

// The honeypot is tolerated in the raw body, but is excluded from stored answers.
function unregisteredKeyErrors(body: Record<string, unknown>, fieldsById: ReadonlyMap<string, FieldDescriptor>): FieldError[] {
  const errors: FieldError[] = [];
  for (const key of Object.keys(body)) {
    if (key === HONEYPOT_KEY) continue;
    if (!fieldsById.has(key)) {
      errors.push({ field: key, reason: "unregistered_key" });
    }
  }
  return errors;
}

// Whitespace is rejected only for required text; optional whitespace is an answer the definition
// permits. Preserve the submitted string instead of silently trimming its stored value.
function resolveTextValue(field: FieldDescriptor, value: unknown): SubmittedValue {
  if (typeof value !== "string") return { kind: "rejected", reason: "must be a string" };
  if (field.required && value.trim() === "") return { kind: "rejected", reason: "required" };
  if (field.maxLength != null && value.length > field.maxLength) return { kind: "rejected", reason: "too_long" };
  return { kind: "accepted", value };
}

// Native URL-encoded forms submit "on" for checked boxes without a value attribute; accepting
// only JSON booleans would reject every checked checkbox when client JavaScript is disabled.
// An unticked native checkbox omits its key; submission resolution treats that as absence.
const HTML_CHECKBOX_ON_VALUE = "on";

function resolveCheckboxValue(value: unknown): SubmittedValue {
  if (typeof value === "boolean") return { kind: "accepted", value };
  if (value === HTML_CHECKBOX_ON_VALUE) return { kind: "accepted", value: true };
  return { kind: "rejected", reason: "must be a boolean" };
}

// JSON and native forms differ in how they represent missing values, so null/undefined both
// mean absence. Boolean false is a real checkbox answer, including for a required checkbox.
function resolveSubmittedValue(field: FieldDescriptor, value: unknown): SubmittedValue {
  if (value === undefined || value === null) {
    return field.required ? { kind: "rejected", reason: "required" } : { kind: "absent" };
  }
  if (field.type === "checkbox") return resolveCheckboxValue(value);
  return resolveTextValue(field, value);
}

/**
 * Only declared, accepted fields reach data; the reserved honeypot never does. Report unknown
 * body keys first, then declared-field errors in definition order, independent of body key order.
 * This keeps the declared-field portion of the error list stable across equivalent submissions.
 */
export function validateSubmissionPayload(input: ValidateSubmissionPayloadInput): SubmissionValidationResult {
  const { definition, body } = input;
  const fieldsById = new Map<string, FieldDescriptor>(definition.fields.map((f) => [f.id, f]));

  const fieldErrors: FieldError[] = unregisteredKeyErrors(body, fieldsById);
  const data: Record<string, string | boolean> = {};

  for (const field of definition.fields) {
    const resolved = resolveSubmittedValue(field, body[field.id]);
    if (resolved.kind === "rejected") {
      fieldErrors.push({ field: field.id, reason: resolved.reason });
    } else if (resolved.kind === "accepted") {
      data[field.id] = resolved.value;
    }
  }

  if (fieldErrors.length > 0) return { valid: false, fieldErrors };
  return { valid: true, data };
}

// Only a non-empty trimmed string trips the trap; absent, non-string or whitespace-only values
// do not reject an otherwise valid submission.
export function isHoneypotTripped(input: { hp: unknown }): boolean {
  if (typeof input.hp !== "string") return false;
  return input.hp.trim().length > 0;
}
