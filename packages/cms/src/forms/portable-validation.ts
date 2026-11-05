/** Portable validation owner shared by native forms and published static receivers. No Node APIs. */
import type { FieldDescriptor, FormAnswer } from "./types.js";
import type { FieldResolution } from "./field-registry.js";
type FieldValidator = (required: { field: FieldDescriptor; value: unknown }, optional?: Record<string, never>) => FieldResolution;
/** Native email syntax shared by the registry and the compatibility submission guard. */
// Match native type=email syntax (WHATWG HTML email state), including single-label domains.
// Do not trim or rewrite answers: Jini's payload contract preserves submitted strings.
const EMAIL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
/** Returns whether the entire value matches native single-address email syntax.
 * JS's $ can match before a final newline; checking the full match refuses that bypass.
 * @complexity O(n) in the address length, bounded by the caller's 5000-character text cap. */
export function isValidFormEmail({ value }: { value: string }, _optional = {}): boolean {
  return EMAIL_PATTERN.exec(value)?.[0] === value;
}

const accepted = (value: FormAnswer): FieldResolution => ({ kind: "accepted", value });
const rejected = (reason: string): FieldResolution => ({ kind: "rejected", reason });
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const fullMatch = (pattern: RegExp, value: string): boolean => pattern.exec(value)?.[0] === value;

const absent: FieldResolution = { kind: "absent" };
/** A blank answer is a missing one: refused when required, otherwise absent. */
const blank = (field: FieldDescriptor): FieldResolution => (field.required ? rejected("required") : absent);
const outcome = (reason: string | undefined, value: FormAnswer): FieldResolution => (reason === undefined ? accepted(value) : rejected(reason));

function textLengthViolation(field: FieldDescriptor, value: string): string | undefined {
  if (value.length > (field.maxLength ?? 5000)) return "too_long";
  return value !== "" && value.length < (field.minLength ?? Number(field.attributes?.minlength ?? 0)) ? "too_short" : undefined;
}
function textPatternViolation(field: FieldDescriptor, value: string): string | undefined {
  const pattern = field.pattern ?? field.attributes?.pattern;
  if (value === "" || pattern === undefined) return undefined;
  return isSafeFieldPattern({ pattern }) && fullMatch(new RegExp(`^(?:${pattern})$`, "u"), value) ? undefined : "pattern_mismatch";
}
/** Input length is capped before any format/pattern work, even on optional unconstrained text. */
function textValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (typeof value !== "string") return rejected("must be a string");
  if (field.required && value.trim() === "") return rejected("required");
  return outcome(textLengthViolation(field, value) ?? textPatternViolation(field, value), value);
}
/** Shared text constraints first; a non-empty accepted answer must then pass the format check. */
const formattedText = (isFormatted: (value: string) => boolean, reason: string): FieldValidator => ({ field, value }) => {
  const result = textValue({ field, value });
  if (result.kind !== "accepted" || value === "") return result;
  return isFormatted(value as string) ? result : rejected(reason);
};
/** Reuse the native email format owner after the shared text constraints. */
const emailValue = formattedText((value) => isValidFormEmail({ value }), "invalid_email");
/** Accept a bounded international telephone spelling without rewriting the answer. */
const phoneValue = formattedText((value) => fullMatch(/^\+?[0-9() .-]{3,50}$/, value) && /\d/.test(value), "invalid_phone");
/** True when the typed host (after any userinfo, before any port) contains a dot. */
function hasDottedHost(address: string, absolute: boolean): boolean {
  const authority = (absolute ? address.slice(address.indexOf("://") + 3) : address).split(/[/?#]/, 1)[0]!;
  // URL expands integer hosts to dotted IPv4; the typed host itself must contain a dot.
  return authority.slice(authority.lastIndexOf("@") + 1).split(":", 1)[0]!.includes(".");
}
/** The scheme is http(s) by construction: absolute addresses matched ^https?:// and bare ones get https://. */
function parsesAsDomainUrl(href: string): boolean {
  try {
    const labels = new URL(href).hostname.split(".");
    return labels.length > 1 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
  } catch { return false; }
}
/** Validate HTTP(S) addresses and handles with no rewriting; refuse active schemes and whitespace. */
function isFormUrl(address: string): boolean {
  // Owner decision 2026-10-13: store as typed, no forced https; any prefix below is validation-only.
  if (/[\s\\\x00-\x08\x0e-\x1f\x7f]/u.test(address)) return false;
  if (fullMatch(/@[A-Za-z0-9._]{1,30}/, address)) return true;
  const absolute = /^https?:\/\/[^/]/i.test(address);
  if (!absolute && !fullMatch(/[^:/?#@]+(?::\d+)?(?:[/?#].*)?/, address)) return false;
  return hasDottedHost(address, absolute) && parsesAsDomainUrl(absolute ? address : `https://${address}`);
}
const urlValue = formattedText(isFormUrl, "invalid_url");
/** Strict native numeric text or a finite JSON number; anything else is undefined. */
function parseNativeNumber(value: unknown): number | undefined {
  const numericText = typeof value === "string" && value.length <= 100 && fullMatch(NUMBER, value);
  if (typeof value !== "number" && !numericText) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
/** Range inputs have native 0..100 bounds when none are configured; number inputs have none. */
const nativeRangeBound = (field: FieldDescriptor, bound: number): number | undefined => (field.type === "range" ? bound : undefined);
type NumberBound = number | string | undefined;
function isOnStep(field: FieldDescriptor, { number, min }: { number: number; min: NumberBound }): boolean {
  const step = field.step ?? Number(field.attributes?.step ?? 1);
  const units = (number - Number(min ?? 0)) / step;
  return Number.isFinite(units) && Math.abs(units - Math.round(units)) <= 1e-8;
}
const numberBounds = (field: FieldDescriptor): { min: number | string | undefined; max: number | string | undefined } => ({
  min: field.min ?? field.attributes?.min ?? nativeRangeBound(field, 0),
  max: field.max ?? field.attributes?.max ?? nativeRangeBound(field, 100),
});
function numberBoundViolation(field: FieldDescriptor, number: number): string | undefined {
  const { min, max } = numberBounds(field);
  if (min !== undefined && number < Number(min)) return "below_min";
  if (max !== undefined && number > Number(max)) return "above_max";
  return isOnStep(field, { number, min }) ? undefined : "step_mismatch";
}
/** Native numeric text is parsed strictly, retaining finite JSON numbers as numbers in storage. */
function numberValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (value === "") return blank(field);
  const number = parseNativeNumber(value);
  if (number === undefined) return rejected("invalid_number");
  return outcome(numberBoundViolation(field, number), number);
}
/** Calendar validation compares components so Date's rollover cannot accept February 30. */
function validDate(value: string): boolean {
  if (!fullMatch(/^\d{4}-\d{2}-\d{2}$/, value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
const validTime = (value: string): boolean => fullMatch(/(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?/, value);
/** Native controls carry local wall-clock values; UTC is used only as a comparison axis. */
function temporalTimestamp(type: string, value: string): number {
  if (type === "date") return Date.parse(`${value}T00:00:00Z`);
  return Date.parse(type === "time" ? `1970-01-01T${value}Z` : `${value}Z`);
}
function isNativeTemporal(type: string, value: string): boolean {
  if (type === "date") return validDate(value);
  if (type === "time") return validTime(value);
  const [date, time, extra] = value.split("T");
  return extra === undefined && validDate(date!) && time !== undefined && validTime(time);
}
function temporalBoundViolation(field: FieldDescriptor, value: string): string | undefined {
  const min = field.min ?? field.attributes?.min;
  const max = field.max ?? field.attributes?.max;
  // Compare normalized instants: 12:30 and 12:30:00, or .1 and .100 seconds, are equal.
  const timestamp = temporalTimestamp(field.type, value);
  if (min !== undefined && timestamp < temporalTimestamp(field.type, String(min))) return "below_min";
  if (max !== undefined && timestamp > temporalTimestamp(field.type, String(max))) return "above_max";
  return undefined;
}
/** Recheck native calendar/clock syntax and configured bounds on the server. */
function temporalValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (typeof value !== "string" || value.length > 30) return rejected("invalid_datetime");
  if (value === "") return blank(field);
  if (!isNativeTemporal(field.type, value)) return rejected(`invalid_${field.type}`);
  return outcome(temporalBoundViolation(field, value), value);
}
/** A scalar choice must be one of the stored option values; arrays never collapse silently. */
function singleChoice({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (value === "") return blank(field);
  if (typeof value !== "string") return rejected("must be a string");
  return field.options?.some((option) => option.value === value) ? accepted(value) : rejected("invalid_option");
}
const isBoundedStringList = (values: unknown): values is string[] =>
  Array.isArray(values) && values.length <= 100 && values.every((item) => typeof item === "string");
function isUniqueOptionSubset(values: string[], options: FieldDescriptor["options"]): boolean {
  const allowed = new Set(options?.map((option) => option.value));
  return new Set(values).size === values.length && values.every((item) => allowed.has(item));
}
/** Normalize native one-value groups to arrays; duplicate and unlisted values are invalid. */
function multipleChoice({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  const values = typeof value === "string" ? [value] : value;
  if (!isBoundedStringList(values)) return rejected("must be a string array");
  if (field.required && values.length === 0) return rejected("required");
  return isUniqueOptionSubset(values, field.options) ? accepted([...values]) : rejected("invalid_option");
}
/** Native boxes submit on or an authored value; required consent must be checked. */
function booleanValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (field.checkboxValue !== undefined) {
    if (typeof value !== "string") return rejected("must be a boolean");
    return value === field.checkboxValue ? accepted(value) : rejected("invalid_option");
  }
  if (typeof value === "boolean") return field.required && !value ? rejected("required") : accepted(value);
  return value === "on" ? accepted(true) : rejected("must be a boolean");
}
/** Safe patterns support literals/classes and one repetition; no user-defined backtracking trees.
 * @returns False for unsupported or invalid regex syntax, never throws. */
export function isSafeFieldPattern({ pattern }: { pattern: string }, _optional = {}): boolean {
  if (pattern.length > 300 || /[()|]|\\[1-9]|\\[pPkK]/.test(pattern)) return false;
  // Multiple repetitions can still backtrack exponentially without parentheses; refuse them too.
  const outsideClasses = pattern.replace(/\\./g, "x").replace(/\[[^\]]*\]/g, "x");
  if ((outsideClasses.match(/[+*?]|\{/g) ?? []).length > 1 || /\.\*/.test(outsideClasses)) return false;
  try { new RegExp(`^(?:${pattern})$`, "u"); return true; } catch { return false; }
}


/** Exact live non-file validation semantics; aliases describe native HTML controls only. */
export const portableFieldValidators = {
 text: textValue, textarea: textValue, hidden: textValue, password: textValue, color: textValue,
 email: emailValue, phone: phoneValue, tel: phoneValue, url: urlValue,
 number: numberValue, range: numberValue, date: temporalValue, time: temporalValue,
 datetime: temporalValue, "datetime-local": temporalValue,
 select: singleChoice, radio: singleChoice, "multi-select": multipleChoice,
 "checkbox-group": multipleChoice, checkbox: booleanValue, toggle: booleanValue,
} satisfies Record<string, FieldValidator>;

/** Resolve one published field with the same validation and normalization as native submissions.
 * @complexity O(value bytes + option count), no I/O. */
export function resolvePortableFormField({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
 if (value === undefined || value === null) return blank(field);
 const validator = Object.hasOwn(portableFieldValidators, field.type) ? portableFieldValidators[field.type as keyof typeof portableFieldValidators] : undefined;
 return validator ? validator({ field, value }) : rejected("invalid_type");
}
