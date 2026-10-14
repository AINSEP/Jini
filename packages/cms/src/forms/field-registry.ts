/** The form field vocabulary and control semantics. Validation and rendering both read this registry. */
import type { FieldDescriptor, FormAnswer, FormFileInput, FormFileStoragePort } from "./types.js";
import { isValidFormEmail } from "./email-format.js";

export type FieldResolution =
  | { kind: "absent" }
  | { kind: "rejected"; reason: string }
  | { kind: "accepted"; value: FormAnswer }
  | { kind: "upload"; file: FormFileInput };
type FieldValidator = (required: { field: FieldDescriptor; value: unknown }, optional?: Record<string, never>) => FieldResolution;
interface FieldKind { control: "input" | "textarea" | "select" | "group"; htmlType: string; validate: FieldValidator; multiple?: boolean; choices?: boolean; textual?: boolean; attributes?: Readonly<Record<string, string>>; }
const accepted = (value: FormAnswer): FieldResolution => ({ kind: "accepted", value });
const rejected = (reason: string): FieldResolution => ({ kind: "rejected", reason });
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const fullMatch = (pattern: RegExp, value: string): boolean => pattern.exec(value)?.[0] === value;

/** Input length is capped before any format/pattern work, even on optional unconstrained text. */
function textValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (typeof value !== "string") return rejected("must be a string");
  if (field.required && value.trim() === "") return rejected("required");
  const maxLength = field.maxLength ?? 5000;
  if (value.length > maxLength) return rejected("too_long");
  if (value !== "" && value.length < (field.minLength ?? Number(field.attributes?.minlength ?? 0))) return rejected("too_short");
  const pattern = field.pattern ?? field.attributes?.pattern;
  if (value !== "" && pattern !== undefined) {
    if (!isSafeFieldPattern({ pattern }) || !fullMatch(new RegExp(`^(?:${pattern})$`, "u"), value)) return rejected("pattern_mismatch");
  }
  return accepted(value);
}
/** Reuse the native email format owner after the shared text constraints. */
function emailValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  const result = textValue({ field, value });
  if (result.kind !== "accepted" || value === "") return result;
  return isValidFormEmail({ value: value as string }) ? result : rejected("invalid_email");
}
/** Accept a bounded international telephone spelling without rewriting the answer. */
function phoneValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  const result = textValue({ field, value });
  if (result.kind !== "accepted" || value === "") return result;
  return fullMatch(/^\+?[0-9() .-]{3,50}$/, value as string) && /\d/.test(value as string) ? result : rejected("invalid_phone");
}
/** Validate HTTP(S) addresses and handles with no rewriting; refuse active schemes and whitespace. */
function urlValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  const result = textValue({ field, value });
  if (result.kind !== "accepted" || value === "") return result;
  // Owner decision 2026-10-13: store as typed, no forced https; any prefix below is validation-only.
  const address = value as string;
  if (/[\s\\\x00-\x1f\x7f]/u.test(address)) return rejected("invalid_url");
  if (fullMatch(/@[A-Za-z0-9._]{1,30}/, address)) return result;
  const absolute = /^https?:\/\/[^/]/i.test(address);
  if (!absolute && !fullMatch(/[^:/?#@]+(?::[0-9]+)?(?:[/?#].*)?/, address)) return rejected("invalid_url");
  const authority = (absolute ? address.slice(address.indexOf("://") + 3) : address).split(/[/?#]/, 1)[0]!;
  // URL expands integer hosts to dotted IPv4; the typed host itself must contain a dot.
  if (!authority.slice(authority.lastIndexOf("@") + 1).split(":", 1)[0]!.includes(".")) return rejected("invalid_url");
  try {
    const url = new URL(absolute ? address : `https://${address}`);
    const domain = fullMatch(/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/i, url.hostname);
    return ["http:", "https:"].includes(url.protocol) && domain ? result : rejected("invalid_url");
  } catch { return rejected("invalid_url"); }
}
/** Native numeric text is parsed strictly, retaining finite JSON numbers as numbers in storage. */
function numberValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (value === "") return field.required ? rejected("required") : { kind: "absent" };
  if (typeof value !== "number" && (typeof value !== "string" || value.length > 100 || !fullMatch(NUMBER, value))) return rejected("invalid_number");
  const number = Number(value);
  if (!Number.isFinite(number)) return rejected("invalid_number");
  const min = field.min ?? field.attributes?.min ?? (field.type === "range" ? 0 : undefined);
  const max = field.max ?? field.attributes?.max ?? (field.type === "range" ? 100 : undefined);
  if (min !== undefined && number < Number(min)) return rejected("below_min");
  if (max !== undefined && number > Number(max)) return rejected("above_max");
  const step = field.step ?? Number(field.attributes?.step ?? 1);
  const units = (number - Number(min ?? 0)) / step;
  if (!Number.isFinite(units) || Math.abs(units - Math.round(units)) > 1e-8) return rejected("step_mismatch");
  return accepted(number);
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
/** Recheck native calendar/clock syntax and configured bounds on the server. */
function temporalValue({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (typeof value !== "string" || value.length > 30) return rejected("invalid_datetime");
  if (value === "") return field.required ? rejected("required") : { kind: "absent" };
  const [date, time, extra] = value.split("T");
  const valid = field.type === "date" ? validDate(value) : field.type === "time" ? validTime(value) : extra === undefined && validDate(date!) && time !== undefined && validTime(time);
  if (!valid) return rejected(`invalid_${field.type}`);
  const min = field.min ?? field.attributes?.min;
  const max = field.max ?? field.attributes?.max;
  // Compare normalized instants: 12:30 and 12:30:00, or .1 and .100 seconds, are equal.
  const timestamp = temporalTimestamp(field.type, value);
  if (min !== undefined && timestamp < temporalTimestamp(field.type, String(min))) return rejected("below_min");
  if (max !== undefined && timestamp > temporalTimestamp(field.type, String(max))) return rejected("above_max");
  return accepted(value);
}
/** A scalar choice must be one of the stored option values; arrays never collapse silently. */
function singleChoice({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  if (value === "") return field.required ? rejected("required") : { kind: "absent" };
  if (typeof value !== "string") return rejected("must be a string");
  return field.options?.some((option) => option.value === value) ? accepted(value) : rejected("invalid_option");
}
/** Normalize native one-value groups to arrays; duplicate and unlisted values are invalid. */
function multipleChoice({ field, value }: { field: FieldDescriptor; value: unknown }, _optional = {}): FieldResolution {
  const values = typeof value === "string" ? [value] : value;
  if (!Array.isArray(values) || values.length > 100 || !values.every((item) => typeof item === "string")) return rejected("must be a string array");
  if (field.required && values.length === 0) return rejected("required");
  const allowed = new Set(field.options?.map((option) => option.value));
  if (new Set(values).size !== values.length || values.some((item) => !allowed.has(item))) return rejected("invalid_option");
  return accepted([...values]);
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
// File validation needs a host sniffer. The ordinary resolver refuses files without that port.
const fileValue: FieldValidator = (_required, _optional = {}) => rejected("file_storage_unavailable");
export const FIELD_TYPE_REGISTRY = {
  text: { control: "input", htmlType: "text", validate: textValue, textual: true },
  textarea: { control: "textarea", htmlType: "textarea", validate: textValue, textual: true },
  email: { control: "input", htmlType: "email", validate: emailValue, textual: true },
  phone: { control: "input", htmlType: "tel", validate: phoneValue, textual: true },
  // Text avoids the browser's scheme requirement while retaining URL keyboard/autofill hints.
  url: { control: "input", htmlType: "text", attributes: { inputmode: "url", autocomplete: "url", spellcheck: "false", autocapitalize: "off" }, validate: urlValue, textual: true },
  number: { control: "input", htmlType: "number", validate: numberValue },
  range: { control: "input", htmlType: "range", validate: numberValue },
  date: { control: "input", htmlType: "date", validate: temporalValue },
  time: { control: "input", htmlType: "time", validate: temporalValue },
  datetime: { control: "input", htmlType: "datetime-local", validate: temporalValue },
  select: { control: "select", htmlType: "select", validate: singleChoice, choices: true },
  "multi-select": { control: "select", htmlType: "select", validate: multipleChoice, choices: true, multiple: true },
  radio: { control: "group", htmlType: "radio", validate: singleChoice, choices: true },
  checkbox: { control: "input", htmlType: "checkbox", validate: booleanValue },
  "checkbox-group": { control: "group", htmlType: "checkbox", validate: multipleChoice, choices: true, multiple: true },
  toggle: { control: "input", htmlType: "checkbox", validate: booleanValue },
  file: { control: "input", htmlType: "file", validate: fileValue },
  hidden: { control: "input", htmlType: "hidden", validate: textValue, textual: true },
} as const satisfies Record<string, FieldKind>;

/** Safe patterns support literals/classes and one repetition; no user-defined backtracking trees.
 * @returns False for unsupported or invalid regex syntax, never throws. */
export function isSafeFieldPattern({ pattern }: { pattern: string }, _optional = {}): boolean {
  if (pattern.length > 300 || /[()|]|\\[1-9]|\\[pPkK]/.test(pattern)) return false;
  // Multiple repetitions can still backtrack exponentially without parentheses; refuse them too.
  const outsideClasses = pattern.replace(/\\./g, "x").replace(/\[[^\]]*\]/g, "x");
  if ((outsideClasses.match(/[+*?]|\{/g) ?? []).length > 1 || /\.\*/.test(outsideClasses)) return false;
  try { new RegExp(`^(?:${pattern})$`, "u"); return true; } catch { return false; }
}

/** Browsers compile the `pattern` attribute with the `v` flag, which rejects some `u`-valid classes
 * (an unescaped `-` as in `[a-z-]`, or `(`, `)`, `{`, `}`, `/`, `|` inside `[...]`). The browser
 * then drops the attribute without a word and only the server enforces it (2026-10-11), so new
 * authoring must pass both; submissions still validate with {@link isSafeFieldPattern} alone.
 * @returns False when the pattern is unsafe or a browser would ignore it, never throws. */
export function isBrowserSafeFieldPattern({ pattern }: { pattern: string }, _optional = {}): boolean {
  if (!isSafeFieldPattern({ pattern })) return false;
  try { new RegExp(`^(?:${pattern})$`, "v"); return true; } catch { return false; }
}

/** Public forms accept only known inert media/document formats; wildcard accept never expands this list. */
export const SAFE_FORM_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/gif": ["gif"], "image/webp": ["webp"], "image/avif": ["avif"],
  "video/mp4": ["mp4"], "video/webm": ["webm"], "application/pdf": ["pdf"],
};
export const MAX_FORM_FILE_BYTES = 10 * 1024 * 1024;
const DANGEROUS_EXTENSION = /\.(?:exe|dll|com|bat|cmd|msi|sh|bash|ps1|js|mjs|cjs|ts|tsx|jsx|py|rb|pl|php\d*|phtml|html?|svg|xml|jar|zip|scr|vbs)(?:\.|$)/i;
/** Checks byte size, MIME, filename and detected magic before any upload side effect.
 * @complexity O(n) host sniffing, bounded by a 10 MiB per-file ceiling. */
export function resolveFormField(
  { field, value }: { field: FieldDescriptor; value: unknown },
  { files }: { files?: Pick<FormFileStoragePort, "detectContentType"> } = {},
): FieldResolution {
  if (value === undefined || value === null) return field.required ? rejected("required") : { kind: "absent" };
  const kind: FieldKind | undefined = Object.hasOwn(FIELD_TYPE_REGISTRY, field.type) ? FIELD_TYPE_REGISTRY[field.type] : undefined;
  if (!kind) return rejected("invalid_type");
  if (field.type !== "file") return kind.validate({ field, value });
  if (!files) return rejected("file_storage_unavailable");
  const file = value as Partial<FormFileInput>;
  if (typeof file !== "object" || !(file.bytes instanceof Uint8Array) || typeof file.filename !== "string" || typeof file.contentType !== "string") return rejected("invalid_file");
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > Math.min(field.maxFileSize ?? MAX_FORM_FILE_BYTES, MAX_FORM_FILE_BYTES)) return rejected("file_size");
  if (file.filename.length > 200 || /[\\/\x00-\x1f\x7f]/.test(file.filename) || DANGEROUS_EXTENSION.test(file.filename)) return rejected("file_type");
  const contentType = files.detectContentType({ bytes: file.bytes });
  if (file.contentType !== "" && file.contentType !== contentType) return rejected("file_type");
  const extensions = Object.hasOwn(SAFE_FORM_FILE_TYPES, contentType) ? SAFE_FORM_FILE_TYPES[contentType] : undefined;
  if (!extensions || !extensions.includes(file.filename.split(".").at(-1)!.toLowerCase())) return rejected("file_type");
  if (field.accept && !field.accept.some((accept) => accept === contentType || accept === "*/*" || accept === `${contentType.split("/")[0]}/*`)) return rejected("file_type");
  return { kind: "upload", file: { filename: file.filename, contentType, bytes: file.bytes } };
}
