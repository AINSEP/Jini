/** Definition constraints beyond the original four-type schema; every invalid definition fails closed. */
import type { FieldDescriptor } from "./types.js";
import { FIELD_TYPE_REGISTRY, isBrowserSafeFieldPattern, isSafeFieldPattern, MAX_FORM_FILE_BYTES, resolveFormField, SAFE_FORM_FILE_TYPES } from "./field-registry.js";
import type { FieldError } from "./forms.js";
const KEYS: ReadonlySet<string> = new Set(["id", "name", "label", "type", "required", "placeholder", "helpText", "default", "options", "minLength", "maxLength", "pattern", "min", "max", "step", "accept", "maxFileSize", "checkboxValue", "className", "attributes"]);
const TEMPORAL: ReadonlySet<string> = new Set(["date", "time", "datetime"]);
const fail = (field: string, reason: string): FieldError => ({ field, reason });

/** Text rules apply to explicit descriptor properties and their legacy attributes alike. */
function textConstraints(field: FieldDescriptor): string[] {
  const errors: string[] = [];
  const kind = FIELD_TYPE_REGISTRY[field.type] as { textual?: boolean } | undefined;
  const minLength = field.minLength ?? (field.attributes?.minlength !== undefined ? Number(field.attributes.minlength) : undefined);
  const pattern = field.pattern ?? field.attributes?.pattern;
  if (minLength !== undefined && (!kind?.textual || !Number.isInteger(minLength) || minLength < 0 || minLength > (field.maxLength ?? 5000))) errors.push("minLength must be an integer within the text length bounds");
  if (field.type !== "checkbox" && field.maxLength != null && (!kind?.textual || !Number.isInteger(field.maxLength))) errors.push("maxLength is only supported on text fields and must be an integer");
  if (pattern !== undefined && (!kind?.textual || typeof pattern !== "string" || !isSafeFieldPattern({ pattern }))) errors.push("pattern must be a safe text pattern (no groups, alternation, backreferences or multiple repetitions)");
  else if (typeof pattern === "string" && !isBrowserSafeFieldPattern({ pattern })) errors.push("pattern is ignored by browsers: escape '-' and other symbols inside [...] with a backslash, e.g. [0-9 +.\\-]");
  return errors;
}
/** Choice options are bounded, unique and non-empty; scalar/array defaults use the same validator. */
function choiceConstraints(field: FieldDescriptor): string[] {
  const kind = FIELD_TYPE_REGISTRY[field.type] as { choices?: boolean } | undefined;
  if (!kind?.choices) return field.options === undefined ? [] : ["options are only supported on choice fields"];
  if (!Array.isArray(field.options) || field.options.length === 0 || field.options.length > 100) return ["choice fields require 1-100 options"];
  const values = new Set<string>();
  const errors: string[] = [];
  for (const option of field.options) {
    if (!option || typeof option.value !== "string" || option.value.length === 0 || option.value.length > 200 || typeof option.label !== "string" || option.label.length === 0 || option.label.length > 200 || Object.keys(option).some((key) => key !== "value" && key !== "label")) {
      errors.push("options must contain only a non-empty value and label (up to 200 characters)"); continue;
    }
    if (values.has(option.value)) errors.push("option values must be unique");
    values.add(option.value);
  }
  return errors;
}
/** Numeric/date bounds must use native formats; reversed intervals and non-positive steps fail. */
function boundConstraints(field: FieldDescriptor): string[] {
  const errors: string[] = [];
  const numeric = field.type === "number" || field.type === "range";
  const temporal = TEMPORAL.has(field.type);
  for (const key of ["min", "max"] as const) {
    const value = field[key] ?? field.attributes?.[key];
    if (value === undefined) continue;
    if (numeric) {
      if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) errors.push(`${key} must be a finite number`);
      else if (!Number.isFinite(Number(value))) errors.push(`${key} must be a finite number`);
    } else if (temporal) {
      if (typeof value !== "string" || resolveFormField({ field: { id: "bound", label: "Bound", type: field.type, required: true }, value }).kind !== "accepted") errors.push(`${key} must match the field's native date/time format`);
    } else errors.push(`${key} is only supported on numeric and date/time fields`);
  }
  const min = field.min ?? field.attributes?.min;
  const max = field.max ?? field.attributes?.max;
  if (min !== undefined && max !== undefined) {
    // Reuse the submission bound validator so equivalent local-time spellings stay equivalent.
    const comparison = temporal ? resolveFormField({ field: { id: "bound", label: "Bound", type: field.type, required: true, min }, value: max }) : undefined;
    if (numeric ? Number(min) > Number(max) : comparison?.kind === "rejected" && comparison.reason === "below_min") errors.push("min must not exceed max");
  }
  const step = field.step ?? (field.attributes?.step !== undefined ? Number(field.attributes.step) : undefined);
  if (step !== undefined && (!numeric || !Number.isFinite(step) || step <= 0)) errors.push("step must be a positive finite number on a numeric field");
  return errors;
}
/** File fields may narrow the safe list/size, and cannot synthesize a default upload. */
function fileConstraints(field: FieldDescriptor): string[] {
  if (field.type !== "file") return field.accept !== undefined || field.maxFileSize !== undefined ? ["accept/maxFileSize are only supported on file fields"] : [];
  const errors: string[] = [];
  if (field.maxFileSize !== undefined && (!Number.isInteger(field.maxFileSize) || field.maxFileSize < 1 || field.maxFileSize > MAX_FORM_FILE_BYTES)) errors.push(`maxFileSize must be 1-${MAX_FORM_FILE_BYTES} bytes`);
  if (field.accept !== undefined && (!Array.isArray(field.accept) || field.accept.length === 0 || field.accept.length > 20 || field.accept.some((mime) => !Object.hasOwn(SAFE_FORM_FILE_TYPES, mime) && !["image/*", "video/*", "*/*"].includes(mime)))) errors.push("accept must contain recognized safe MIME types or image/*, video/*, */*");
  if (field.default !== undefined) errors.push("file fields cannot have defaults");
  return errors;
}
/** Collect definition errors without coercing an untrusted descriptor into a valid one.
 * @complexity O(k + o) for descriptor keys and at most 100 options. */
export function commonDescriptorErrors({ field }: { field: FieldDescriptor }, _optional = {}): FieldError[] {
  const errors: string[] = [];
  for (const key of Object.keys(field)) if (!KEYS.has(key)) errors.push(`property '${key}' is not allowed`);
  if (typeof field.required !== "boolean") errors.push("required must be a boolean");
  if (field.name !== undefined && field.name !== field.id) errors.push("name must equal the stable field id");
  for (const key of ["placeholder", "helpText"] as const) if (field[key] !== undefined && (typeof field[key] !== "string" || field[key]!.length > 500)) errors.push(`${key} must be a string of at most 500 characters`);
  if (Object.hasOwn(FIELD_TYPE_REGISTRY, field.type)) errors.push(...textConstraints(field), ...choiceConstraints(field), ...boundConstraints(field), ...fileConstraints(field));
  if (field.default !== undefined && field.type !== "file" && errors.length === 0) {
    const result = resolveFormField({ field: { ...field, required: false }, value: field.default });
    if (result.kind === "rejected") errors.push(`default: ${result.reason}`);
  }
  return errors.map((reason) => fail(field.id || "(unknown)", reason));
}
