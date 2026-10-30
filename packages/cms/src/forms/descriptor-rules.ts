/** Definition constraints beyond the original four-type schema; every invalid definition fails closed. */
import type { FieldDescriptor } from "./types.js";
import { FIELD_TYPE_REGISTRY, isBrowserSafeFieldPattern, isSafeFieldPattern, MAX_FORM_FILE_BYTES, resolveFormField, SAFE_FORM_FILE_TYPES } from "./field-registry.js";
import type { FieldError } from "./forms.js";
const KEYS: ReadonlySet<string> = new Set(["id", "name", "label", "type", "required", "placeholder", "helpText", "default", "options", "minLength", "maxLength", "pattern", "min", "max", "step", "accept", "maxFileSize", "checkboxValue", "className", "attributes"]);
const TEMPORAL: ReadonlySet<string> = new Set(["date", "time", "datetime"]);
const WILDCARD_ACCEPTS: readonly string[] = ["image/*", "video/*", "*/*"];
type BoundAxis = "numeric" | "temporal" | "none";
type Option = NonNullable<FieldDescriptor["options"]>[number];

/** Explicit numeric properties win; legacy string attributes are read as numbers. */
const numberOrAttribute = (explicit: number | undefined, attribute: string | undefined): number | undefined =>
  explicit ?? (attribute === undefined ? undefined : Number(attribute));
const kindFlags = (field: FieldDescriptor): { textual?: boolean; choices?: boolean } => FIELD_TYPE_REGISTRY[field.type] as { textual?: boolean; choices?: boolean };

function minLengthErrors(field: FieldDescriptor, textual: boolean): string[] {
  const minLength = numberOrAttribute(field.minLength, field.attributes?.minlength);
  if (minLength === undefined) return [];
  const inBounds = Number.isInteger(minLength) && minLength >= 0 && minLength <= (field.maxLength ?? 5000);
  return textual && inBounds ? [] : ["minLength must be an integer within the text length bounds"];
}
function maxLengthErrors(field: FieldDescriptor, textual: boolean): string[] {
  if (field.type === "checkbox" || field.maxLength == null) return [];
  return textual && Number.isInteger(field.maxLength) ? [] : ["maxLength is only supported on text fields and must be an integer"];
}
function patternErrors(field: FieldDescriptor, textual: boolean): string[] {
  const pattern = field.pattern ?? field.attributes?.pattern;
  if (pattern === undefined) return [];
  if (!textual || typeof pattern !== "string" || !isSafeFieldPattern({ pattern })) return ["pattern must be a safe text pattern (no groups, alternation, backreferences or multiple repetitions)"];
  return isBrowserSafeFieldPattern({ pattern }) ? [] : ["pattern is ignored by browsers: escape '-' and other symbols inside [...] with a backslash, e.g. [0-9 +.\\-]"];
}
/** Text rules apply to explicit descriptor properties and their legacy attributes alike. */
function textConstraints(field: FieldDescriptor): string[] {
  const textual = kindFlags(field).textual === true;
  return [...minLengthErrors(field, textual), ...maxLengthErrors(field, textual), ...patternErrors(field, textual)];
}
const boundedLabel = (value: unknown): boolean => typeof value === "string" && value.length > 0 && value.length <= 200;
function isWellFormedOption(option: Option): boolean {
  return Boolean(option) && boundedLabel(option.value) && boundedLabel(option.label) && Object.keys(option).every((key) => key === "value" || key === "label");
}
/** Choice options are bounded, unique and non-empty; scalar/array defaults use the same validator. */
function choiceConstraints(field: FieldDescriptor): string[] {
  if (!kindFlags(field).choices) return field.options === undefined ? [] : ["options are only supported on choice fields"];
  if (!Array.isArray(field.options) || field.options.length === 0 || field.options.length > 100) return ["choice fields require 1-100 options"];
  const values = new Set<string>();
  const errors: string[] = [];
  for (const option of field.options) {
    if (!isWellFormedOption(option)) { errors.push("options must contain only a non-empty value and label (up to 200 characters)"); continue; }
    if (values.has(option.value)) errors.push("option values must be unique");
    values.add(option.value);
  }
  return errors;
}
function boundAxis(field: FieldDescriptor): BoundAxis {
  if (field.type === "number" || field.type === "range") return "numeric";
  return TEMPORAL.has(field.type) ? "temporal" : "none";
}
const boundValue = (field: FieldDescriptor, key: "min" | "max"): number | string | undefined => field[key] ?? field.attributes?.[key];
const isFiniteNumber = (value: unknown): boolean =>
  (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
const isNativeTemporal = (field: FieldDescriptor, value: unknown): boolean =>
  typeof value === "string" && resolveFormField({ field: { id: "bound", label: "Bound", type: field.type, required: true }, value }).kind === "accepted";
function boundValueError(key: "min" | "max", { field, axis }: { field: FieldDescriptor; axis: BoundAxis }): string | undefined {
  const value = boundValue(field, key);
  if (value === undefined) return undefined;
  if (axis === "numeric") return isFiniteNumber(value) ? undefined : `${key} must be a finite number`;
  if (axis === "temporal") return isNativeTemporal(field, value) ? undefined : `${key} must match the field's native date/time format`;
  return `${key} is only supported on numeric and date/time fields`;
}
function isReversedInterval(field: FieldDescriptor, axis: BoundAxis): boolean {
  const min = boundValue(field, "min");
  const max = boundValue(field, "max");
  if (min === undefined || max === undefined) return false;
  if (axis === "numeric") return Number(min) > Number(max);
  if (axis !== "temporal") return false;
  // Reuse the submission bound validator so equivalent local-time spellings stay equivalent.
  const comparison = resolveFormField({ field: { id: "bound", label: "Bound", type: field.type, required: true, min }, value: max });
  return comparison.kind === "rejected" && comparison.reason === "below_min";
}
function isInvalidStep(field: FieldDescriptor, axis: BoundAxis): boolean {
  const step = numberOrAttribute(field.step, field.attributes?.step);
  return step !== undefined && (axis !== "numeric" || !Number.isFinite(step) || step <= 0);
}
/** Numeric/date bounds must use native formats; reversed intervals and non-positive steps fail. */
function boundConstraints(field: FieldDescriptor): string[] {
  const axis = boundAxis(field);
  const errors = (["min", "max"] as const).map((key) => boundValueError(key, { field, axis })).filter((error) => error !== undefined);
  if (isReversedInterval(field, axis)) errors.push("min must not exceed max");
  if (isInvalidStep(field, axis)) errors.push("step must be a positive finite number on a numeric field");
  return errors;
}
const isInvalidFileSize = (size: number | undefined): boolean =>
  size !== undefined && (!Number.isInteger(size) || size < 1 || size > MAX_FORM_FILE_BYTES);
const isSafeAccept = (mime: string): boolean => Object.hasOwn(SAFE_FORM_FILE_TYPES, mime) || WILDCARD_ACCEPTS.includes(mime);
const isInvalidAccept = (accept: string[] | undefined): boolean => {
  if (accept === undefined) return false;
  return !Array.isArray(accept) || accept.length === 0 || accept.length > 20 || !accept.every(isSafeAccept);
};
/** File fields may narrow the safe list/size, and cannot synthesize a default upload. */
function fileConstraints(field: FieldDescriptor): string[] {
  if (field.type !== "file") return field.accept !== undefined || field.maxFileSize !== undefined ? ["accept/maxFileSize are only supported on file fields"] : [];
  const errors: string[] = [];
  if (isInvalidFileSize(field.maxFileSize)) errors.push(`maxFileSize must be 1-${MAX_FORM_FILE_BYTES} bytes`);
  if (isInvalidAccept(field.accept)) errors.push("accept must contain recognized safe MIME types or image/*, video/*, */*");
  if (field.default !== undefined) errors.push("file fields cannot have defaults");
  return errors;
}
const isShortTextOrAbsent = (value: unknown): boolean => value === undefined || (typeof value === "string" && value.length <= 500);
/** Properties, the required flag, the stable name and the free-text hints, whatever the type. */
function shapeErrors(field: FieldDescriptor): string[] {
  const errors = Object.keys(field).filter((key) => !KEYS.has(key)).map((key) => `property '${key}' is not allowed`);
  if (typeof field.required !== "boolean") errors.push("required must be a boolean");
  if (field.name !== undefined && field.name !== field.id) errors.push("name must equal the stable field id");
  for (const key of ["placeholder", "helpText"] as const) if (!isShortTextOrAbsent(field[key])) errors.push(`${key} must be a string of at most 500 characters`);
  return errors;
}
/** Never reached for a file field with a default: fileConstraints already refused it, and defaults
 * resolve only for otherwise-valid descriptors. */
function defaultErrors(field: FieldDescriptor): string[] {
  if (field.default === undefined) return [];
  const result = resolveFormField({ field: { ...field, required: false }, value: field.default });
  return result.kind === "rejected" ? [`default: ${result.reason}`] : [];
}
/** Collect definition errors without coercing an untrusted descriptor into a valid one.
 * @complexity O(k + o) for descriptor keys and at most 100 options. */
export function commonDescriptorErrors({ field }: { field: FieldDescriptor }, _optional = {}): FieldError[] {
  const errors = shapeErrors(field);
  if (Object.hasOwn(FIELD_TYPE_REGISTRY, field.type)) errors.push(...textConstraints(field), ...choiceConstraints(field), ...boundConstraints(field), ...fileConstraints(field));
  // A default is only meaningful once the rest of the descriptor is valid.
  if (errors.length === 0) errors.push(...defaultErrors(field));
  return errors.map((reason) => ({ field: field.id || "(unknown)", reason }));
}
