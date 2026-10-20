import { FIELD_TYPE_REGISTRY, isBrowserSafeFieldPattern, MAX_FORM_FILE_BYTES, SAFE_FORM_FILE_TYPES, type FieldType } from "@jini-ai/cms/forms";
import type { AdminFormField } from "./models.js";

/**
 * @file Builder settings for every registered field type, derived from the CMS field registry.
 *
 * The registry (`@jini-ai/cms/forms` `FIELD_TYPE_REGISTRY`) already says how each type renders and
 * validates: its control, native input type, and whether it is textual, a choice list or multiple.
 * Which settings the builder offers follows from those flags, never from a per-type switch, so a
 * type added to the registry gets a working editor. Only the human type name is per type, and
 * `FIELD_TYPE_LABELS` is a `Record<FieldType, …>`: a new registry key without a name fails typecheck.
 *
 * Everything here is pure. The settings dialog keeps a string draft ({@link FieldSettingsForm}) so
 * half-typed numbers survive; {@link buildFieldSettingsPatch} parses it once on Save. That check is
 * a fast pre-save rejection only: the CMS write service's descriptor rules stay authoritative.
 */

type RegistryKind = { control: string; htmlType: string; textual?: boolean; choices?: boolean; multiple?: boolean };
const kindOf = (type: string): RegistryKind | undefined =>
  Object.hasOwn(FIELD_TYPE_REGISTRY, type) ? FIELD_TYPE_REGISTRY[type as FieldType] as RegistryKind : undefined;

/** Plain-language type names (translation keys). Exhaustive over the registry by type. */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text", textarea: "Paragraph", email: "Email", phone: "Phone", url: "Website address",
  number: "Number", range: "Slider", date: "Date", time: "Time", datetime: "Date and time",
  select: "Dropdown", "multi-select": "Multi-select list", radio: "Radio buttons", checkbox: "Checkbox",
  "checkbox-group": "Checkboxes", toggle: "Toggle switch", file: "File upload", hidden: "Hidden value",
};

export type FieldBounds = "number" | "date" | "time" | "datetime-local";
export type FieldDefaultKind = "text" | "textarea" | "number" | "temporal" | "boolean" | "choice" | "choices";

/** Which builder settings apply to one field type. */
export interface FieldSettings {
  placeholder: boolean;
  helpText: boolean;
  length: boolean;
  pattern: boolean;
  /** Native input type for min/max, or `null` when the type has no bounds. */
  bounds: FieldBounds | null;
  step: boolean;
  options: boolean;
  multiple: boolean;
  defaultKind: FieldDefaultKind | null;
  upload: boolean;
}

const NO_SETTINGS: FieldSettings = { placeholder: false, helpText: true, length: false, pattern: false, bounds: null, step: false, options: false, multiple: false, defaultKind: null, upload: false };
const BOUNDS: ReadonlySet<string> = new Set(["number", "range", "date", "time", "datetime-local"]);

/** The default value a control can carry, read from its registry kind. */
function defaultKindOf(kind: RegistryKind): FieldDefaultKind | null {
  if (kind.choices) return kind.multiple ? "choices" : "choice";
  if (kind.htmlType === "file") return null;
  if (kind.htmlType === "checkbox") return "boolean";
  if (kind.htmlType === "number" || kind.htmlType === "range") return "number";
  if (BOUNDS.has(kind.htmlType)) return "temporal";
  return kind.control === "textarea" ? "textarea" : "text";
}

const isNumeric = ({ kind }: { kind: RegistryKind }): boolean => kind.htmlType === "number" || kind.htmlType === "range";

/** Native input type for a kind's min/max; number and range share numeric bounds. */
function boundsOf({ kind }: { kind: RegistryKind }): FieldBounds | null {
  if (!BOUNDS.has(kind.htmlType)) return null;
  return isNumeric({ kind }) ? "number" : kind.htmlType as FieldBounds;
}

/** Whether a (non-hidden) kind shows a placeholder. */
function takesPlaceholder({ kind }: { kind: RegistryKind }): boolean {
  // A single-choice select shows its placeholder as the empty first option.
  if (kind.control === "select") return !kind.multiple;
  return kind.textual === true || kind.htmlType === "number";
}

/**
 * Settings for one type, from its registry kind. Unknown (legacy or host-added) types get help
 * text only, so the editor never offers a setting the server would refuse.
 * @complexity O(1).
 */
export function fieldSettingsFor({ type }: { type: string }, _optional: Record<string, never> = {}): FieldSettings {
  const kind = kindOf(type);
  if (!kind) return NO_SETTINGS;
  const hidden = kind.htmlType === "hidden";
  const numeric = isNumeric({ kind });
  return {
    placeholder: !hidden && takesPlaceholder({ kind }),
    helpText: !hidden,
    length: kind.textual === true,
    pattern: kind.textual === true && !hidden,
    bounds: boundsOf({ kind }),
    step: numeric,
    options: kind.choices === true,
    multiple: kind.multiple === true,
    defaultKind: defaultKindOf(kind),
    upload: kind.htmlType === "file",
  };
}

export type FieldTypeGroup = "Text" | "Numbers and dates" | "Choices" | "Other";
const GROUP_ORDER: FieldTypeGroup[] = ["Text", "Choices", "Numbers and dates", "Other"];

function groupOf(type: string): FieldTypeGroup {
  const settings = fieldSettingsFor({ type });
  if (settings.options || settings.defaultKind === "boolean") return "Choices";
  if (settings.bounds) return "Numbers and dates";
  if (settings.length && settings.helpText) return "Text";
  return "Other";
}

/**
 * The type picker's `<optgroup>`s, in registry order within each group. A stored type the
 * registry does not know is kept as its own trailing option so loading never changes it.
 * @complexity O(t) in registered types.
 */
export function fieldTypeGroups({ current }: { current?: string }, _optional: Record<string, never> = {}): Array<{ group: FieldTypeGroup; types: Array<{ type: string; label: string }> }> {
  const types = Object.keys(FIELD_TYPE_REGISTRY) as FieldType[];
  const groups = GROUP_ORDER.map((group) => ({ group, types: types.filter((type) => groupOf(type) === group).map((type): { type: AdminFormField["type"]; label: string } => ({ type, label: FIELD_TYPE_LABELS[type] })) }));
  if (current && !kindOf(current)) groups[groups.length - 1]!.types.push({ type: current, label: current });
  return groups.filter((entry) => entry.types.length > 0);
}

/** Lowercase letters, digits and `_`, starting with a letter: the CMS `FIELD_ID_PATTERN`. */
export function fieldIdFromLabel({ label }: { label: string }, _optional: Record<string, never> = {}): string {
  const slug = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return slug === "" ? "" : /^[a-z]/.test(slug) ? slug : `field_${slug}`;
}

/**
 * A label edit on an unsaved field also renames its id while the id still follows the label (empty
 * or equal to the old label's slug). A hand-typed id, or any saved id, is never touched.
 * @complexity O(n) in label length.
 */
export function labelChangePatch(
  { field, label, isExisting }: { field: AdminFormField; label: string; isExisting: boolean },
  _optional: Record<string, never> = {},
): Partial<AdminFormField> {
  const followsLabel = field.id === "" || field.id === fieldIdFromLabel({ label: field.label });
  return !isExisting && followsLabel ? { label, id: fieldIdFromLabel({ label }) } : { label };
}

const SEED_OPTIONS = [{ value: "Option 1", label: "Option 1" }, { value: "Option 2", label: "Option 2" }];

/**
 * Change a field's type, dropping every setting the new type does not support (the CMS refuses
 * them) and seeding two options for a new choice field, which needs at least one.
 * Identity, label, help text and styling always survive.
 * @complexity O(1) apart from copying the option list.
 */
export function retypeField({ field, type }: { field: AdminFormField; type: AdminFormField["type"] }, _optional: Record<string, never> = {}): AdminFormField {
  const before = fieldSettingsFor({ type: field.type });
  const after = fieldSettingsFor({ type });
  return {
    id: field.id, label: field.label, type, required: after.helpText ? field.required : false,
    ...setKeys({ field, keys: retainedKeys({ field, before, after }) }),
    ...(after.options ? { options: (field.options?.length ? field.options : SEED_OPTIONS).map((option) => ({ ...option })) } : {}),
    ...setKeys({ field, keys: after.upload ? ["accept", "maxFileSize"] : [] }),
    // A default only survives when its shape is unchanged (text to text, one choice to one choice).
    ...(keepsDefault({ before, after }) && field.default !== undefined ? { default: field.default } : {}),
  };
}

type RetainedKey = "helpText" | "className" | "attributes" | "placeholder" | "maxLength" | "minLength" | "pattern" | "min" | "max" | "step" | "accept" | "maxFileSize";
const when = (applies: boolean, keys: RetainedKey[]): RetainedKey[] => (applies ? keys : []);

/** The settings before the options that a retype keeps, in the field's key order. */
function retainedKeys({ field, before, after }: { field: AdminFormField; before: FieldSettings; after: FieldSettings }): RetainedKey[] {
  return [
    ...when(after.helpText, ["helpText"]), "className", "attributes", ...when(after.placeholder, ["placeholder"]),
    // A null max length (the wire's "cleared") is dropped rather than carried.
    ...when(after.length && field.maxLength != null, ["maxLength"]), ...when(after.length, ["minLength"]),
    ...when(after.pattern, ["pattern"]),
    ...when(after.bounds !== null && after.bounds === before.bounds, ["min", "max"]),
    ...when(after.step, ["step"]),
  ];
}

const keepsDefault = ({ before, after }: { before: FieldSettings; after: FieldSettings }): boolean =>
  after.defaultKind !== null && after.defaultKind === before.defaultKind && after.bounds === before.bounds;

/** The listed keys the field has set, in order; attribute maps and accept lists are copied, not shared. */
function setKeys({ field, keys }: { field: AdminFormField; keys: RetainedKey[] }): Partial<AdminFormField> {
  const kept: Partial<AdminFormField> = {};
  for (const key of keys) {
    const value = field[key];
    if (value === undefined) continue;
    Object.assign(kept, { [key]: Array.isArray(value) ? [...value] : typeof value === "object" && value !== null ? { ...value } : value });
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Settings dialog draft
// ---------------------------------------------------------------------------

/** Local React keys for option rows; identity is scoped to the editor's own row list. */
export interface OptionRow { _rowId: number; value: string; label: string }

/** String draft of every builder setting; numbers stay text until Save. */
export interface FieldSettingsForm {
  placeholder: string;
  helpText: string;
  defaultText: string;
  defaultChecked: boolean;
  defaultChoices: string[];
  minLength: string;
  maxLength: string;
  pattern: string;
  min: string;
  max: string;
  step: string;
  options: OptionRow[];
  accept: string[];
  maxFileSizeMb: string;
}

const text = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

/** Seed the draft from a stored field. @complexity O(o) in options. */
export function settingsFormFromField({ field }: { field: AdminFormField }, _optional: Record<string, never> = {}): FieldSettingsForm {
  return {
    placeholder: text(field.placeholder), helpText: text(field.helpText),
    ...defaultDraft({ field }),
    minLength: text(field.minLength), maxLength: text(field.maxLength), pattern: text(field.pattern),
    min: text(field.min), max: text(field.max), step: text(field.step),
    options: (field.options ?? []).map((option, index) => ({ _rowId: index, value: option.value, label: option.label })),
    accept: [...(field.accept ?? [])],
    maxFileSizeMb: field.maxFileSize === undefined ? "" : String(Math.round((field.maxFileSize / 1024 / 1024) * 100) / 100),
  };
}

/** The stored default as the dialog's three default controls. */
function defaultDraft({ field }: { field: AdminFormField }): Pick<FieldSettingsForm, "defaultText" | "defaultChecked" | "defaultChoices"> {
  const defaults = field.default;
  return {
    defaultText: typeof defaults === "boolean" || Array.isArray(defaults) ? "" : text(defaults),
    defaultChecked: defaults === true || (field.checkboxValue !== undefined && defaults === field.checkboxValue),
    defaultChoices: defaultChoicesOf({ field }),
  };
}

function defaultChoicesOf({ field }: { field: AdminFormField }): string[] {
  const defaults = field.default;
  if (Array.isArray(defaults)) return [...defaults];
  return typeof defaults === "string" && fieldSettingsFor({ type: field.type }).options ? [defaults] : [];
}

/**
 * Edit one option row. A value that still mirrors its label follows label edits, so typing labels
 * is enough for most forms; an edited value stays put.
 * @complexity O(o).
 */
export function updateOptionRow({ rows, rowId, patch }: { rows: OptionRow[]; rowId: number; patch: Partial<Pick<OptionRow, "value" | "label">> }, _optional: Record<string, never> = {}): OptionRow[] {
  return rows.map((row) => {
    if (row._rowId !== rowId) return row;
    const followsLabel = patch.label !== undefined && patch.value === undefined && row.value === row.label;
    return { ...row, ...patch, ...(followsLabel ? { value: patch.label } : {}) };
  });
}

/** @complexity O(o). */
export function addOptionRow({ rows }: { rows: OptionRow[] }, _optional: Record<string, never> = {}): OptionRow[] {
  // Use the highest current key so deleting or reordering rows cannot create a duplicate.
  const rowId = rows.reduce((max, row) => Math.max(max, row._rowId), -1) + 1;
  return [...rows, { _rowId: rowId, value: "", label: "" }];
}

/** @complexity O(o). */
export function removeOptionRow({ rows, rowId }: { rows: OptionRow[]; rowId: number }, _optional: Record<string, never> = {}): OptionRow[] {
  return rows.filter((row) => row._rowId !== rowId);
}

/** Swap a row with its neighbour; moving past either end is a no-op. @complexity O(o). */
export function moveOptionRow({ rows, rowId, offset }: { rows: OptionRow[]; rowId: number; offset: -1 | 1 }, _optional: Record<string, never> = {}): OptionRow[] {
  const from = rows.findIndex((row) => row._rowId === rowId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Upload groups offered as checkboxes; values are accept entries the CMS recognizes. */
// The CMS widens `image/*`/`video/*` to its safe formats only; PDF is its one safe document type.
export const UPLOAD_CHOICES = [
  { value: "image/*", label: "Images" },
  { value: "video/*", label: "Videos" },
  ...(Object.hasOwn(SAFE_FORM_FILE_TYPES, "application/pdf") ? [{ value: "application/pdf", label: "PDF" }] : []),
];
export const MAX_UPLOAD_MB = MAX_FORM_FILE_BYTES / 1024 / 1024;

export type FieldSettingsPatchResult = { ok: true; patch: Partial<AdminFormField> } | { ok: false; error: string };
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isBlank = (value: string): boolean => value.trim() === "";
function optionalNumber(value: string, error: string, { integer = false } = {}): Parsed<number | undefined> {
  if (isBlank(value)) return { ok: true, value: undefined };
  const number = Number(value);
  return Number.isFinite(number) && (!integer || (Number.isInteger(number) && number >= 0)) ? { ok: true, value: number } : { ok: false, error };
}

/** Text length, pattern and placeholder settings. */
function textPatch({ form, settings }: { form: FieldSettingsForm; settings: FieldSettings }): Parsed<Partial<AdminFormField>> {
  const length = settings.length ? lengthPatch({ form }) : { ok: true as const, value: {} };
  if (!length.ok) return length;
  const pattern = settings.pattern ? patternOf({ form }) : { ok: true as const, value: undefined };
  if (!pattern.ok) return pattern;
  return { ok: true, value: {
    placeholder: settings.placeholder && !isBlank(form.placeholder) ? form.placeholder : undefined,
    pattern: pattern.value, minLength: undefined, ...length.value,
  } };
}

const MIN_ABOVE_MAX = { ok: false, error: "Minimum must not be above maximum." } as const;
const isAbove = (min: number | string | undefined, max: number | string | undefined): boolean => min !== undefined && max !== undefined && min > max;

function lengthPatch({ form }: { form: FieldSettingsForm }): Parsed<Pick<AdminFormField, "minLength" | "maxLength">> {
  const min = optionalNumber(form.minLength, "Length must be a whole number.", { integer: true });
  const max = optionalNumber(form.maxLength, "Length must be a whole number.", { integer: true });
  if (!min.ok) return min;
  if (!max.ok) return max;
  if (isAbove(min.value, max.value)) return MIN_ABOVE_MAX;
  // The wire contract clears a text length with null; unsupported types omit the key entirely.
  return { ok: true, value: { minLength: min.value, maxLength: max.value ?? null } };
}

function patternOf({ form }: { form: FieldSettingsForm }): Parsed<string | undefined> {
  if (isBlank(form.pattern)) return { ok: true, value: undefined };
  // Browser-safe too: a `v`-flag-invalid pattern is silently ignored by browsers (2026-10-11).
  if (!isBrowserSafeFieldPattern({ pattern: form.pattern })) return { ok: false, error: "That pattern isn't supported." };
  return { ok: true, value: form.pattern };
}

/** Numeric or date/time bounds, plus a numeric step. Native date/time strings compare as text. */
function boundsPatch({ form, settings }: { form: FieldSettingsForm; settings: FieldSettings }): Parsed<Partial<AdminFormField>> {
  if (settings.bounds === "number") return numberBoundsPatch({ form });
  if (settings.bounds) return textBoundsPatch({ form });
  return { ok: true, value: { min: undefined, max: undefined, step: undefined } };
}

function numberBoundsPatch({ form }: { form: FieldSettingsForm }): Parsed<Partial<AdminFormField>> {
  const error = "Enter numbers for min, max and step.";
  const min = optionalNumber(form.min, error);
  const max = optionalNumber(form.max, error);
  const step = optionalNumber(form.step, error);
  if (!min.ok) return min;
  if (!max.ok) return max;
  if (!step.ok) return step;
  if (step.value !== undefined && step.value <= 0) return { ok: false, error: "Step must be above 0." };
  if (isAbove(min.value, max.value)) return MIN_ABOVE_MAX;
  return { ok: true, value: { min: min.value, max: max.value, step: step.value } };
}

function textBoundsPatch({ form }: { form: FieldSettingsForm }): Parsed<Partial<AdminFormField>> {
  const min = isBlank(form.min) ? undefined : form.min;
  const max = isBlank(form.max) ? undefined : form.max;
  if (isAbove(min, max)) return MIN_ABOVE_MAX;
  return { ok: true, value: { min, max } };
}

/** Choice options: blank rows are skipped; the rest need a label and a unique value. */
function optionsPatch({ form, settings }: { form: FieldSettingsForm; settings: FieldSettings }): Parsed<Array<{ value: string; label: string }> | undefined> {
  if (!settings.options) return { ok: true, value: undefined };
  const options = form.options.filter((row) => !(isBlank(row.value) && isBlank(row.label))).map((row) => ({ value: row.value.trim(), label: row.label.trim() }));
  if (options.length === 0) return { ok: false, error: "Add at least one option." };
  if (options.some((option) => !option.value || !option.label) || new Set(options.map((option) => option.value)).size !== options.length) {
    return { ok: false, error: "Each option needs a label and a unique value." };
  }
  return { ok: true, value: options };
}

type DefaultInput = { form: FieldSettingsForm; offered: ReadonlySet<string>; checkboxValue: string | undefined };
const typedDefault = ({ form }: DefaultInput): Parsed<AdminFormField["default"]> => ({ ok: true, value: isBlank(form.defaultText) ? undefined : form.defaultText });
const DEFAULT_READERS: Record<FieldDefaultKind, (input: DefaultInput) => Parsed<AdminFormField["default"]>> = {
  // A box with an authored value submits that value, so its "checked" default is that value too.
  boolean: ({ form, checkboxValue }) => ({ ok: true, value: form.defaultChecked ? checkboxValue ?? true : undefined }),
  choice: ({ form, offered }) => ({ ok: true, value: form.defaultChoices.find((value) => offered.has(value)) }),
  choices: ({ form, offered }) => {
    const chosen = form.defaultChoices.filter((value) => offered.has(value));
    return { ok: true, value: chosen.length ? chosen : undefined };
  },
  number: ({ form }) => optionalNumber(form.defaultText, "Default must be a number."),
  text: typedDefault, textarea: typedDefault, temporal: typedDefault,
};

/** The default in the stored shape for its kind; choices drop values no longer offered. */
function defaultValue(
  { form, settings }: { form: FieldSettingsForm; settings: FieldSettings },
  { options, checkboxValue }: { options?: Array<{ value: string }> | undefined; checkboxValue?: string | undefined },
): Parsed<AdminFormField["default"]> {
  if (settings.defaultKind === null) return { ok: true, value: undefined };
  const offered = new Set((options ?? []).map((option) => option.value));
  return DEFAULT_READERS[settings.defaultKind]({ form, offered, checkboxValue });
}

/** Upload limits: no boxes ticked means every safe type; size is whole megabytes up to the cap. */
function uploadPatch({ form, settings }: { form: FieldSettingsForm; settings: FieldSettings }): Parsed<Partial<AdminFormField>> {
  if (!settings.upload) return { ok: true, value: {} };
  const size = optionalNumber(form.maxFileSizeMb, "Max size must be up to 10 MB.");
  if (!size.ok) return size;
  if (size.value !== undefined && (size.value <= 0 || size.value > MAX_UPLOAD_MB)) return { ok: false, error: "Max size must be up to 10 MB." };
  return { ok: true, value: {
    accept: form.accept.length ? [...form.accept] : undefined,
    maxFileSize: size.value === undefined ? undefined : Math.min(MAX_FORM_FILE_BYTES, Math.max(1, Math.round(size.value * 1024 * 1024))),
  } };
}

/**
 * Parse and check the dialog draft into a field patch. Settings the type does not support come out
 * `undefined`, so Save also clears anything stale. Max length instead uses `null` when blank and
 * is omitted for unsupported types; `retypeField` already drops it on a type change. First failure wins.
 * @complexity O(o) in options.
 */
export function buildFieldSettingsPatch(
  { form, field }: { form: FieldSettingsForm; field: Pick<AdminFormField, "type" | "checkboxValue"> },
  _optional: Record<string, never> = {},
): FieldSettingsPatchResult {
  const settings = fieldSettingsFor({ type: field.type });
  const textual = textPatch({ form, settings });
  if (!textual.ok) return textual;
  const bounds = boundsPatch({ form, settings });
  if (!bounds.ok) return bounds;
  const options = optionsPatch({ form, settings });
  if (!options.ok) return options;
  const fallback = defaultValue({ form, settings }, { options: options.value, checkboxValue: field.checkboxValue });
  if (!fallback.ok) return fallback;
  const upload = uploadPatch({ form, settings });
  if (!upload.ok) return upload;
  return { ok: true, patch: {
    ...textual.value, ...bounds.value, ...upload.value,
    helpText: settings.helpText && !isBlank(form.helpText) ? form.helpText : undefined,
    options: options.value,
    default: fallback.value,
  } };
}
