import { FIELD_TYPE_REGISTRY, type FieldType } from "@jini-ai/cms/forms";
import type { AdminFormField, AdminFormSubmission } from "./models.js";

export interface FormAnswerColumn {
  key: string;
  header: string;
  cell: (submission: AdminFormSubmission) => string;
  /** Formats one stored answer for this field; detail rows reuse it so they match the table. */
  format?: (value: unknown) => string;
}

/** Display options for answers: translated boolean labels and the date-formatting locale (default: runtime's). */
export type FormAnswerDisplay = { yes?: string; no?: string; locale?: string };

/** Persisted descriptors, including those derived from HTML, supply column headers, choice labels and field types. */
export function formAnswerColumns({ fields }: { fields: readonly AdminFormField[] }, display: FormAnswerDisplay = {}): FormAnswerColumn[] {
  return fields.map((field) => {
    const format = (value: unknown) => formatFormAnswer({ value, options: field.options, type: field.type }, display);
    return { key: `answer:${field.id}`, header: field.label, cell: (submission) => format(submission.data[field.id]), format };
  });
}

/** The stored shape of a file-field answer (`FormFileReference` in `@jini-ai/cms/forms`). */
export interface FormAnswerFile { mediaId: string; filename: string; byteSize?: number }

/** Narrows a stored answer to an uploaded-file reference.
 * @complexity O(1). */
export function formAnswerFile({ value }: { value: unknown }, _optional = {}): FormAnswerFile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { mediaId, filename, byteSize } = value as Record<string, unknown>;
  if (typeof mediaId !== "string" || typeof filename !== "string") return null;
  return { mediaId, filename, ...(typeof byteSize === "number" ? { byteSize } : {}) };
}

/** One answer as display text. Multi-choice answers are arrays and file answers are objects;
 * `String()` turned those into `a,b` and `[object Object]` (2026-10-11).
 * Options resolve stored choice values to visitor-facing labels; removed options retain raw values.
 * Booleans read Yes/No and date/time/datetime answers read in the locale's short form instead of
 * `true` and `2026-11-02T10:15` (2026-10-11); stored data is unchanged.
 * @complexity O(n * (o + 1)) time for n answer items and o options; O(n) output space, no I/O. */
export function formatFormAnswer(
  { value, options, type }: { value: unknown; options?: AdminFormField["options"]; type?: string | undefined },
  display: FormAnswerDisplay = {},
): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(item => formatFormAnswer({ value: item, options, type }, display)).join(", ");
  if (typeof value === "boolean") return value ? display.yes ?? "Yes" : display.no ?? "No";
  if (typeof value === "string" && type !== undefined && type in TEMPORAL_STYLES) return formatTemporal({ value, type }, display);
  if (typeof value === "string") return options?.find(option => option.value === value)?.label ?? value;
  const file = formAnswerFile({ value });
  if (file) return file.byteSize === undefined ? file.filename : `${file.filename} (${formatByteSize({ bytes: file.byteSize })})`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const TEMPORAL_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  time: { timeStyle: "short" },
  datetime: { dateStyle: "medium", timeStyle: "short" },
};
const TEMPORAL_VALUE = /^(?:(\d{4})-(\d{2})-(\d{2}))?T?(?:(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Stored temporal answers are zone-less wall-clock values, so they format in UTC to show exactly
 * what the visitor entered; unparseable values stay raw. */
function formatTemporal({ value, type }: { value: string; type: string }, { locale }: FormAnswerDisplay): string {
  const match = TEMPORAL_VALUE.exec(value);
  if (!match || (match[1] === undefined && match[4] === undefined)) return value;
  const [, y = "1970", mo = "01", d = "01", h = "00", mi = "00", sec = "00"] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)));
  return new Intl.DateTimeFormat(locale, { ...TEMPORAL_STYLES[type], timeZone: "UTC" }).format(date);
}

function formatByteSize({ bytes }: { bytes: number }): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/** Detail rows reuse the table's persisted field labels, including HTML-derived descriptors.
 * Removed fields retain their answers with a plain fallback instead of exposing their IDs.
 * A file answer also carries its reference so the view can link the download.
 * @complexity O(c + a) time and space for c columns and a submitted answers; no I/O.
 */
export function formSubmissionRows(
  { data, answerColumns }: { data: AdminFormSubmission['data']; answerColumns: readonly FormAnswerColumn[] },
  { unknownFieldLabel = "Unknown field" }: { unknownFieldLabel?: string } = {},
): Array<{ key: string; label: string; value: string; file: FormAnswerFile | null }> {
  const columns = new Map(answerColumns.map(column => [column.key, column]));
  return Object.entries(data).map(([key, value]) => {
    const column = columns.get(`answer:${key}`);
    const formatted = column?.format ? column.format(value) : formatFormAnswer({ value });
    return { key, label: column?.header.trim() || unknownFieldLabel, value: formatted, file: formAnswerFile({ value }) };
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

type StarterKind = { control: string; htmlType: string; multiple?: boolean; attributes?: Readonly<Record<string, string>> };
const kindOf = (type: string): StarterKind =>
  Object.hasOwn(FIELD_TYPE_REGISTRY, type) ? FIELD_TYPE_REGISTRY[type as FieldType] as StarterKind : { control: "input", htmlType: "text" };
const isDefault = (field: AdminFormField, value: string): boolean =>
  Array.isArray(field.default) ? field.default.includes(value) : field.default === value;

/** Name, required and the stored constraints, as authored HTML attributes the CMS reads back. */
function starterAttributes(field: AdminFormField, kind: StarterKind): string {
  const constraints: Array<[string, unknown]> = [
    ["placeholder", kind.control === "select" ? undefined : field.placeholder], ["minlength", field.minLength], ["maxlength", field.maxLength],
    ["pattern", field.pattern], ["min", field.min], ["max", field.max], ["step", field.step], ["accept", field.accept?.join(",")],
    ...Object.entries(kind.attributes ?? {}),
  ];
  return `name="${escapeHtml(field.id)}"${field.required ? " required" : ""}` +
    constraints.filter(([, value]) => value != null && value !== "").map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`).join("");
}

/** One field's starter markup; every control comes from the registry kind, as the public render does. */
function starterField(field: AdminFormField): string {
  const kind = kindOf(field.type);
  const label = escapeHtml(field.label);
  const attrs = starterAttributes(field, kind);
  const options = field.options ?? [];
  if (kind.control === "group") {
    // One box per option under a shared name; the CMS collects them back into this choice field.
    // Native `required` on every checkbox would demand ALL of them, so a checkbox group leaves it
    // off (the server still enforces one-or-more); a radio group's `required` means "pick one".
    const boxAttrs = kind.multiple ? starterAttributes({ ...field, required: false }, kind) : attrs;
    const boxes = options.map((option) => `  <label><input type="${kind.htmlType}" ${boxAttrs} value="${escapeHtml(option.value)}"${isDefault(field, option.value) ? " checked" : ""}> ${escapeHtml(option.label)}</label>`);
    return `<fieldset>\n  <legend>${label}</legend>\n${boxes.join("\n")}\n</fieldset>`;
  }
  if (kind.control === "select") {
    const empty = kind.multiple ? [] : [`    <option value="">${escapeHtml(field.placeholder ?? "Choose an option")}</option>`];
    const choices = options.map((option) => `    <option value="${escapeHtml(option.value)}"${isDefault(field, option.value) ? " selected" : ""}>${escapeHtml(option.label)}</option>`);
    return `<label>${label}\n  <select ${attrs}${kind.multiple ? " multiple" : ""}>\n${[...empty, ...choices].join("\n")}\n  </select>\n</label>`;
  }
  if (kind.control === "textarea") return `<label>${label}\n  <textarea ${attrs}></textarea>\n</label>`;
  if (kind.htmlType === "hidden") return `<input type="hidden" ${attrs} value="${escapeHtml(String(field.default ?? ""))}" aria-label="${label}">`;
  if (kind.htmlType === "checkbox") {
    const value = field.checkboxValue !== undefined ? ` value="${escapeHtml(field.checkboxValue)}"` : "";
    const checked = field.default === true || (field.checkboxValue !== undefined && field.default === field.checkboxValue) ? " checked" : "";
    return `<label><input type="checkbox"${field.type === "toggle" ? ' role="switch"' : ""} ${attrs}${value}${checked}> ${label}</label>`;
  }
  return `<label>${label}\n  <input type="${kind.htmlType}" ${attrs}>\n</label>`;
}

/**
 * Editable form BODY only: the server supplies the transport and spam-protection wrapper. Each
 * field's markup follows its registry kind (`tel` for phone, a `<select>` with its options, radio
 * and checkbox groups, `role="switch"` for a toggle), so switching to HTML mode keeps every field
 * type; the CMS derives the same types back from this markup on save.
 * @complexity O(f + o) for fields and their options; no I/O.
 */
export function formHtmlStarter(
  { fields }: { fields: readonly AdminFormField[] },
  { submitLabel = "Send" }: { submitLabel?: string } = {},
): string {
  return fields.map(starterField).join("\n\n") + `\n\n<button type="submit">${escapeHtml(submitLabel)}</button>`;
}

export function formHtmlEmbed({ slug }: { slug: string }, _optional = {}): string {
  const config = JSON.stringify({ type: "form", id: slug, mode: "html" }).replace(/'/g, "&#39;");
  return `<div data-embed-config='${config}'></div>`;
}
