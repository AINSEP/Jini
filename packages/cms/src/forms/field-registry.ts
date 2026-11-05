/** The form field vocabulary and control semantics. Validation and rendering both read this registry. */
import type { FieldDescriptor, FormAnswer, FormFileInput, FormFileStoragePort } from "./types.js";
import { portableFieldValidators, isSafeFieldPattern } from "./portable-validation.js";
export { isSafeFieldPattern } from "./portable-validation.js";

/**
 * Escaping makes an attribute value inert, but cannot make a name such as onclick safe. Names
 * are deny-by-default: only aria-* and data-* namespaces and a fixed closed list are accepted.
 * Event handlers, style/formaction/href/src/srcdoc can inject behavior; id/name/type overrides
 * can break label association, submission keys or the renderer's declared field vocabulary.
 * Shared here so rendering can use the vocabulary without loading submission/descriptor validation.
 */
export const ATTRIBUTE_NAME_PATTERN =
  /^(aria-[a-z0-9-]+|data-[a-z0-9-]+|placeholder|autocomplete|inputmode|pattern|title|min|max|step|minlength|spellcheck|readonly)$/;

export type FieldResolution =
  | { kind: "absent" }
  | { kind: "rejected"; reason: string }
  | { kind: "accepted"; value: FormAnswer }
  | { kind: "upload"; file: FormFileInput };
type FieldValidator = (required: { field: FieldDescriptor; value: unknown }, optional?: Record<string, never>) => FieldResolution;
interface FieldKind { control: "input" | "textarea" | "select" | "group"; htmlType: string; validate: FieldValidator; multiple?: boolean; choices?: boolean; textual?: boolean; attributes?: Readonly<Record<string, string>>; }
const rejected = (reason: string): FieldResolution => ({ kind: "rejected", reason });
const blank = (field: FieldDescriptor): FieldResolution => (field.required ? rejected("required") : { kind: "absent" });
const { text: textValue, email: emailValue, phone: phoneValue, url: urlValue, number: numberValue,
 date: temporalValue, select: singleChoice, "multi-select": multipleChoice, checkbox: booleanValue } = portableFieldValidators;
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
const EXECUTABLE_EXTENSION = /\.(?:exe|dll|com|bat|cmd|msi|sh|bash|ps1|js|mjs|cjs|ts|tsx|jsx)(?:\.|$)/i;
const ACTIVE_DOCUMENT_EXTENSION = /\.(?:py|rb|pl|php\d*|phtml|html?|svg|xml|jar|zip|scr|vbs)(?:\.|$)/i;
const isFileInput = (value: unknown): value is FormFileInput => {
  const file = value as Partial<FormFileInput>;
  return typeof file === "object" && file.bytes instanceof Uint8Array && typeof file.filename === "string" && typeof file.contentType === "string";
};
const isWithinSizeLimit = (bytes: Uint8Array, maxFileSize: number | undefined): boolean =>
  bytes.byteLength > 0 && bytes.byteLength <= Math.min(maxFileSize ?? MAX_FORM_FILE_BYTES, MAX_FORM_FILE_BYTES);
const isUnsafeFilename = (filename: string): boolean => filename.length > 200 || /[\\/\x00-\x1f\x7f]/.test(filename) || (EXECUTABLE_EXTENSION.test(filename) || ACTIVE_DOCUMENT_EXTENSION.test(filename));
const acceptsType = (accept: string, contentType: string): boolean => accept === contentType || accept === "*/*" || accept === `${contentType.split("/")[0]}/*`;
/** The claim (if any) must equal the sniffed type, whose safe extensions must include the filename's. */
function isAllowedFileType(file: FormFileInput, { contentType, accept }: { contentType: string; accept: string[] | undefined }): boolean {
  if (file.contentType !== "" && file.contentType !== contentType) return false;
  const extensions = Object.hasOwn(SAFE_FORM_FILE_TYPES, contentType) ? SAFE_FORM_FILE_TYPES[contentType] : undefined;
  if (!extensions?.includes(file.filename.split(".").at(-1)!.toLowerCase())) return false;
  return !accept || accept.some((entry) => acceptsType(entry, contentType));
}
function resolveUpload(field: FieldDescriptor, { value, files }: { value: unknown; files: Pick<FormFileStoragePort, "detectContentType"> }): FieldResolution {
  if (!isFileInput(value)) return rejected("invalid_file");
  if (!isWithinSizeLimit(value.bytes, field.maxFileSize)) return rejected("file_size");
  if (isUnsafeFilename(value.filename)) return rejected("file_type");
  const contentType = files.detectContentType({ bytes: value.bytes });
  if (!isAllowedFileType(value, { contentType, accept: field.accept })) return rejected("file_type");
  return { kind: "upload", file: { filename: value.filename, contentType, bytes: value.bytes } };
}
/** Checks byte size, MIME, filename and detected magic before any upload side effect.
 * @complexity O(n) host sniffing, bounded by a 10 MiB per-file ceiling. */
export function resolveFormField(
  { field, value }: { field: FieldDescriptor; value: unknown },
  { files }: { files?: Pick<FormFileStoragePort, "detectContentType"> } = {},
): FieldResolution {
  if (value === undefined || value === null) return blank(field);
  const kind: FieldKind | undefined = Object.hasOwn(FIELD_TYPE_REGISTRY, field.type) ? FIELD_TYPE_REGISTRY[field.type] : undefined;
  if (!kind) return rejected("invalid_type");
  if (field.type !== "file") return kind.validate({ field, value });
  if (!files) return rejected("file_storage_unavailable");
  return resolveUpload(field, { value, files });
}
