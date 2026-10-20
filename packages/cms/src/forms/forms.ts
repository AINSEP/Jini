/** Pure field/submission validation and honeypot decisions. Error order and stored value normalization are stable. */
import type { FieldDescriptor, FormDefinitionRecord, FormAnswer, FormFileInput, FormFileStoragePort } from "./types.js";
import { FIELD_TYPE_REGISTRY, resolveFormField, type FieldResolution } from "./field-registry.js";
import { commonDescriptorErrors } from "./descriptor-rules.js";

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
export const FIELD_TYPES = new Set<string>(Object.keys(FIELD_TYPE_REGISTRY));

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
  if (typeof descriptor.id !== "string" || !descriptor.id || !FIELD_ID_PATTERN.test(descriptor.id)) {
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
  if (typeof descriptor.label !== "string") return [{ field: label, reason: "label must be a string" }];
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

function checkboxValueErrors(descriptor: FieldDescriptor, label: string): FieldError[] {
  if (descriptor.checkboxValue === undefined) return [];
  if (descriptor.type !== "checkbox" || typeof descriptor.checkboxValue !== "string") {
    return [{ field: label, reason: "checkboxValue must be a string on a checkbox field" }];
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
export function validateFieldDescriptors({ fields }: { fields: FieldDescriptor[] }, _optional = {}): FieldValidationResult {
  if (!Array.isArray(fields)) return { valid: false, fieldErrors: [{ field: "fields", reason: "must be an array" }] };
  const fieldErrors: FieldError[] = arityErrors(fields);

  const claimedIds = new Set<string>();
  for (const descriptor of fields) fieldErrors.push(...descriptorErrors(descriptor, claimedIds));

  if (fieldErrors.length > 0) return { valid: false, fieldErrors };
  return { valid: true };
}

function arityErrors(fields: FieldDescriptor[]): FieldError[] {
  if (fields.length < MIN_FIELDS) return [{ field: "fields", reason: `at least ${MIN_FIELDS} field is required` }];
  if (fields.length > MAX_FIELDS) return [{ field: "fields", reason: `at most ${MAX_FIELDS} fields are allowed` }];
  return [];
}

// One descriptor's violations, each rule in the fixed order validateFieldDescriptors documents.
function descriptorErrors(descriptor: FieldDescriptor, claimedIds: Set<string>): FieldError[] {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return [{ field: "fields", reason: "each field must be an object" }];
  const label = descriptor.id || "(unknown)";
  return [
    ...fieldIdErrors(descriptor, label, claimedIds),
    ...fieldTypeErrors(descriptor, label),
    ...labelLengthErrors(descriptor, label),
    ...maxLengthErrors(descriptor, label),
    ...checkboxValueErrors(descriptor, label),
    ...classNameErrors(descriptor, label),
    ...attributeErrors(descriptor, label),
    ...commonDescriptorErrors({ field: descriptor }),
  ];
}

export interface ValidateSubmissionPayloadInput {
  definition: FormDefinitionRecord;
  body: Record<string, unknown>;
}

export type SubmissionValidationResult =
  | { valid: true; data: Record<string, FormAnswer>; files?: Record<string, FormFileInput> }
  | { valid: false; fieldErrors: FieldError[] };

// Absence is distinct from acceptance: treating an omitted optional field as an accepted value
// would write undefined and violate the guarantee that stored answers contain only declared keys.
// The honeypot is tolerated in the raw body, but is excluded from stored answers.
// Whitespace is rejected only for required text; optional whitespace is an answer the definition
// permits. Preserve the submitted string instead of silently trimming its stored value.
// Native URL-encoded forms submit "on" for checked boxes without a value attribute; accepting
// only JSON booleans would reject every checked checkbox when client JavaScript is disabled.
// An unticked native checkbox omits its key; submission resolution treats that as absence.
// JSON and native forms differ in how they represent missing values, so null/undefined both
// mean absence. Boolean false is a real checkbox answer, only for optional native checkboxes; required consent must be checked.
function unregisteredKeyErrors(body: Record<string, unknown>, fieldsById: ReadonlyMap<string, FieldDescriptor>): FieldError[] {
  return Object.keys(body).filter((key) => key !== HONEYPOT_KEY && !fieldsById.has(key)).map((field) => ({ field, reason: "unregistered_key" }));
}

/**
 * Only declared, accepted fields reach data; the reserved honeypot never does. Report unknown
 * body keys first, then declared-field errors in definition order, independent of body key order.
 * This keeps the declared-field portion of the error list stable across equivalent submissions.
 */
export function validateSubmissionPayload(input: ValidateSubmissionPayloadInput, optional: { files?: Pick<FormFileStoragePort, "detectContentType"> } = {}): SubmissionValidationResult {
  const { definition, body } = input;
  if (!body || typeof body !== "object" || Array.isArray(body)) return { valid: false, fieldErrors: [{ field: "body", reason: "must be an object" }] };
  const fieldsById = new Map<string, FieldDescriptor>(definition.fields.map((f) => [f.id, f]));

  const fieldErrors: FieldError[] = unregisteredKeyErrors(body, fieldsById);
  const data: Record<string, FormAnswer> = {};
  const files: Record<string, FormFileInput> = {};

  for (const field of definition.fields) {
    const resolved = resolveFormField({ field, value: Object.hasOwn(body, field.id) ? body[field.id] : undefined }, optional);
    recordResolvedField({ fieldId: field.id, resolved, fieldErrors, data, files });
  }

  if (fieldErrors.length > 0) return { valid: false, fieldErrors };
  return Object.keys(files).length ? { valid: true, data, files } : { valid: true, data };
}

// Absent fields land nowhere: neither an error, nor a stored answer, nor an upload.
function recordResolvedField({ fieldId, resolved, fieldErrors, data, files }: {
  fieldId: string;
  resolved: FieldResolution;
  fieldErrors: FieldError[];
  data: Record<string, FormAnswer>;
  files: Record<string, FormFileInput>;
}): void {
  if (resolved.kind === "rejected") fieldErrors.push({ field: fieldId, reason: resolved.reason });
  else if (resolved.kind === "accepted") data[fieldId] = resolved.value;
  else if (resolved.kind === "upload") files[fieldId] = resolved.file;
}

// Only a non-empty trimmed string trips the trap; absent, non-string or whitespace-only values
// do not reject an otherwise valid submission.
export function isHoneypotTripped(input: { hp: unknown }, _optional = {}): boolean {
  if (typeof input.hp !== "string") return false;
  return input.hp.trim().length > 0;
}
