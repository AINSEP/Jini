/** Framework-free HTML renderer, kept separate for extraction into @jini-ai/cms/forms.
 * Local prototype authorized 2026-10-04; that original dispatch kept Jini read-only.
 * The host owns the endpoint and the form's styling hook; author markup and CSS refine it. */
import type { FieldDescriptor } from "./types.js";
import { FIELD_TYPE_REGISTRY, isSafeFieldPattern } from "./field-registry.js";
import { ATTRIBUTE_NAME_PATTERN } from "./forms.js";

/** Attribute names are trusted host constants, not visitor input. Values are always escaped. */
export interface FormHtmlHooks { field: string; form: string; success: string; error: string; }

export function escapeFormHtml({ value }: { value: string }, _optional = {}): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Renderer hooks retain the CMS's established styling/error anchors without defining a theme. */
export interface FormBodyOptions {
  submitLabel?: string;
  idPrefix?: string;
  fieldClass?: string;
  errorClass?: string;
}
const attr = (name: string, value: string | number): string => ` ${name}="${escapeFormHtml({ value: String(value) })}"`;

/** Extra attributes cannot override structural or server-backed constraints. Values are escaped at this sink. */
function extraAttributes(field: FieldDescriptor, claimed: ReadonlySet<string>): string {
  return Object.entries(field.attributes ?? {}).filter(([name, value]) => ATTRIBUTE_NAME_PATTERN.test(name) && !claimed.has(name) && typeof value === "string" && (name !== "pattern" || isSafeFieldPattern({ pattern: value }))).map(([name, value]) => attr(name, value)).join("");
}
type RenderKind = { control: string; htmlType: string; multiple?: boolean; attributes?: Readonly<Record<string, string>> };
/** What every control shape of one field shares, computed once per field. */
interface FieldMarkup { field: FieldDescriptor; kind: RenderKind; id: string; label: string; describedBy: string; required: string; base: string; extra: string; help: string; error: string; fieldClass: string; defaultValues: unknown[] }

const isRenderableField = (field: FieldDescriptor): boolean =>
  Boolean(field) && typeof field.id === "string" && typeof field.label === "string" && Object.hasOwn(FIELD_TYPE_REGISTRY, field.type);
const requiredMark = (field: FieldDescriptor): string => (field.required ? " *" : "");
const constraintEntries = (field: FieldDescriptor) => [
  ["placeholder", field.placeholder], ["minlength", field.minLength], ["maxlength", field.maxLength], ["pattern", field.pattern],
  ["min", field.min], ["max", field.max], ["step", field.step],
] as const;
/** Lengths must be integers (maxlength positive) and patterns safe, or the attribute is dropped. */
function isRenderableConstraint(name: string, value: string | number): boolean {
  if (name === "maxlength") return Number.isInteger(value) && Number(value) > 0;
  if (name === "minlength") return Number.isInteger(value) && Number(value) >= 0;
  return name !== "pattern" || isSafeFieldPattern({ pattern: String(value) });
}
/** Class, validated constraints, then registry attributes, then any unclaimed authored extras. */
function controlAttributes(field: FieldDescriptor, kind: RenderKind): string {
  const claimed = new Set(["aria-describedby"]);
  let extra = field.className ? attr("class", field.className) : "";
  for (const [name, value] of constraintEntries(field)) {
    if (value == null || !isRenderableConstraint(name, value)) continue;
    extra += attr(name, value); claimed.add(name);
  }
  // Registry-owned control semantics take precedence over authored extra attributes.
  for (const [name, value] of Object.entries(kind.attributes ?? {})) {
    extra += attr(name, value); claimed.add(name);
  }
  return extra + extraAttributes(field, claimed);
}
function fieldIds(field: FieldDescriptor, options: FormBodyOptions): { id: string; helpId: string; errorId: string; describedBy: string } {
  const id = `${options.idPrefix ?? "form"}-${field.id}`;
  const helpId = `${id}-help`; const errorId = `${id}-error`;
  const describedBy = [field.helpText ? helpId : "", errorId, field.attributes?.["aria-describedby"] ?? ""].filter(Boolean).join(" ");
  return { id, helpId, errorId, describedBy };
}
function fieldSlots(field: FieldDescriptor, { helpId, errorId, options }: { helpId: string; errorId: string; options: FormBodyOptions }): { help: string; error: string } {
  const help = field.helpText ? `<div${attr("id", helpId)} class="widget-form-field-help">${escapeFormHtml({ value: field.helpText })}</div>` : "";
  const error = `<div${attr("class", options.errorClass ?? "widget-form-field-error")}${attr("data-field", field.id)}${attr("id", errorId)} hidden></div>`;
  return { help, error };
}
function fieldMarkup(field: FieldDescriptor, { hooks, options }: { hooks: Pick<FormHtmlHooks, "field">; options: FormBodyOptions }): FieldMarkup {
  const kind = FIELD_TYPE_REGISTRY[field.type] as RenderKind;
  const { id, helpId, errorId, describedBy } = fieldIds(field, options);
  return {
    field, kind, id, describedBy,
    label: escapeFormHtml({ value: field.label }),
    required: field.required ? " required" : "",
    base: attr("name", field.name ?? field.id) + attr(hooks.field, field.id) + attr("toolparamtitle", field.label) + attr("toolparamdescription", field.helpText ?? field.label) + attr("aria-describedby", describedBy),
    extra: controlAttributes(field, kind),
    ...fieldSlots(field, { helpId, errorId, options }),
    fieldClass: options.fieldClass ?? "widget-form-field",
    defaultValues: Array.isArray(field.default) ? field.default : [field.default],
  };
}
function renderGroupOption(markup: FieldMarkup, { option, index }: { option: { value: string; label: string }; index: number }): string {
  const { id, kind, base, extra, required, defaultValues } = markup;
  const optionId = `${id}-${index}`;
  const checked = defaultValues.includes(option.value) ? " checked" : "";
  // Native checkbox-group required on each box means ALL, so server enforces one-or-more;
  // aria-required communicates the group's requirement without changing that invariant.
  const optionRequired = kind.multiple ? "" : required;
  return `<label${attr("for", optionId)}><input${attr("id", optionId)}${attr("type", kind.htmlType)}${base}${attr("value", option.value)}${checked}${optionRequired}${extra}>${escapeFormHtml({ value: option.label })}</label>`;
}
function renderGroup(markup: FieldMarkup): string {
  const { field, id, describedBy, label, help, error } = markup;
  const inputs = (field.options ?? []).map((option, index) => renderGroupOption(markup, { option, index })).join("");
  return `<fieldset${attr("id", id)}${attr("class", markup.fieldClass)}${attr("aria-describedby", describedBy)}${field.required ? ' aria-required="true"' : ""}><legend>${label}${requiredMark(field)}</legend>${inputs}${help}${error}</fieldset>`;
}
function renderSelect({ field, kind, id, base, required, extra, defaultValues }: FieldMarkup): string {
  const placeholder = kind.multiple ? "" : `<option value="">${escapeFormHtml({ value: field.placeholder ?? "Choose an option" })}</option>`;
  const choices = (field.options ?? []).map((option) => `<option${attr("value", option.value)}${defaultValues.includes(option.value) ? " selected" : ""}>${escapeFormHtml({ value: option.label })}</option>`).join("");
  return `<select${attr("id", id)}${base}${kind.multiple ? " multiple" : ""}${required}${extra}>${placeholder}${choices}</select>`;
}
function checkboxValueAttributes(field: FieldDescriptor): string {
  const value = field.checkboxValue !== undefined ? attr("value", field.checkboxValue) : "";
  return value + (field.default === true || field.default === field.checkboxValue && field.default !== undefined ? " checked" : "");
}
function inputValueAttributes(field: FieldDescriptor, kind: RenderKind): string {
  if (field.type === "file") return field.accept ? attr("accept", field.accept.join(",")) : "";
  if (kind.htmlType === "checkbox") return checkboxValueAttributes(field);
  return field.default !== undefined ? attr("value", String(field.default)) : "";
}
function renderControl(markup: FieldMarkup): string {
  const { field, kind, id, base, required, extra } = markup;
  if (kind.control === "select") return renderSelect(markup);
  if (kind.control === "textarea") return `<textarea${attr("id", id)}${base}${required}${extra}>${escapeFormHtml({ value: String(field.default ?? "") })}</textarea>`;
  return `<input${attr("type", kind.htmlType)}${attr("id", id)}${base}${field.type === "toggle" ? ' role="switch"' : ""}${required}${inputValueAttributes(field, kind)}${extra}>`;
}
/** One registry control rendered with label/legend, help/error associations and escaped defaults. */
function renderField(field: FieldDescriptor, hooks: Pick<FormHtmlHooks, "field">, options: FormBodyOptions): string {
  if (!isRenderableField(field)) return "";
  const markup = fieldMarkup(field, { hooks, options });
  if (markup.kind.control === "group") return renderGroup(markup);
  const control = renderControl(markup);
  if (field.type === "hidden") return control;
  // The checkbox modifier lets the baseline put the box before its label on one line (owner report
  // 2026-10-05: stacked and stretched like a text input, its glyph drew centred under the label).
  const fieldClass = markup.fieldClass + (markup.kind.htmlType === "checkbox" ? " widget-form-field-checkbox" : "");
  return `<div${attr("class", fieldClass)}><label${attr("for", markup.id)}>${markup.label}${requiredMark(field)}</label>${control}${markup.help}${markup.error}</div>`;
}

/** Shared body for authored and builder forms; every field's HTML semantics come from the registry.
 * @complexity O(f + o) for fields and their bounded option lists, no I/O. */
export function renderHtmlFormBody(
  { fields, hooks }: { fields: readonly FieldDescriptor[]; hooks: Pick<FormHtmlHooks, "field"> },
  options: FormBodyOptions = {},
): string {
  return fields.map((field) => renderField(field, hooks, options)).join("\n") + `\n<button type="submit">${escapeFormHtml({ value: options.submitLabel ?? "Send" })}</button>`;
}

/** `className` is the host's styling hook (the host passes its form CSS class so the active theme's form rules
 * apply); author CSS stays free to override it. Whitespace-separated, de-duplicated, never replaced. */
export function renderHtmlForm(
  { slug, fields, action, hooks }: { slug: string; fields: readonly FieldDescriptor[]; action: string; hooks: FormHtmlHooks },
  { html, successMessage = "Thanks — your message has been sent.", className }: { html?: string; successMessage?: string; className?: string } = {},
): string {
  const escapedSlug = escapeFormHtml({ value: slug });
  const slugHook = `data-form-slug="${escapedSlug}"`;
  const classes = [...new Set((className ?? "").split(/\s+/).filter(Boolean))].join(" ");
  const classAttr = classes ? `class="${escapeFormHtml({ value: classes })}" ` : "";
  return `<div ${hooks.success} ${slugHook} role="status" hidden>${escapeFormHtml({ value: successMessage })}</div>` +
    `<form ${classAttr}${hooks.form}="${escapedSlug}" ${slugHook} toolname="form_${escapeFormHtml({ value: slug.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 123) })}" tooldescription="${escapedSlug}" method="post"${fields.some((field) => field.type === "file") ? ' enctype="multipart/form-data"' : ""} action="${escapeFormHtml({ value: action })}">` +
    `<div ${hooks.error} ${slugHook} role="alert" hidden></div>` +
    (html ?? renderHtmlFormBody({ fields, hooks }, { idPrefix: `form-${slug}` })) +
    // Hidden container requires neither a theme class nor inline CSS; bots still see the input.
    `<div hidden aria-hidden="true"><input type="text" name="_hp" tabindex="-1" autocomplete="off"></div></form>`;
}

/* Migration rationale retained from the host renderer:

 * Renders one field descriptor's `class`/extra-attribute string, both attached to the SAME
 * rendered input element the field's own `id`/`name`/`required`/`type` already get. Re-checks
 * `ATTRIBUTE_NAME_PATTERN` here rather than trusting that every stored field passed through
 * `forms.ts`'s `validateFieldDescriptors` (this is the public render path, REQ-37/ADR-047) —
 * defense in depth, since an attribute NAME is not something `escapeHtml` can make safe the way it
 * can a value (`onclick` is structurally dangerous regardless of how its own text is escaped).
 * `className` carries no such risk once escaped, so it is not re-validated, only escaped.

 One `<textarea>`/checkbox/text-or-email `<input>` for a contact-form field descriptor — pulled out
 *  of {@link renderField}'s old three-way nested ternary so each shape is a flat, separately
 *  readable branch rather than one expression whose nesting depth drove the field-renderer's cognitive
 *  complexity. `requiredAttr` is computed once and reused across all three shapes, same value the old
 *  nested ternary recomputed per-branch. `describedByAttr` wires the field to its own (initially empty
 *  and hidden) error slot for assistive tech — see {@link renderField}'s own doc for why
 *  that slot exists even though nothing fills it in on the very first render.
 The field's own `maxLength` as a `maxlength` attribute, so the browser stops input at the same
 *  limit `forms.ts`'s `validateSubmissionPayload` enforces (`too_long`) instead of letting a visitor
 *  type past it and lose the submission to a server rejection. Only a positive integer renders —
 *  the value comes from stored JSON, so anything else is dropped rather than interpolated.
 *  @complexity O(1).
 One contact-form field descriptor -> its `<div class="widget-form-field">` markup — extracted from
 *  {@link renderWidgetContactForm}'s old inline `.map()` callback so the field's own render logic is a
 *  named, independently measured function rather than an anonymous closure.
 *
 *  Carries its own `<div class="widget-form-field-error" data-field="ID" hidden></div>` slot, hidden
 *  and empty on every ordinary render — `renderWidgetContactForm` has no request in scope (this is a
 *  pure prop-to-HTML function, no I/O), so it cannot know at render time whether THIS submission
 *  failed validation on THIS field. The slot exists purely as a stable, pre-built anchor
 *  {@link injectFormSubmissionResultIntoHtml} fills in and un-hides after the fact, on the
 *  Post/Redirect/Get reload that follows a failed submission (see that function's own doc for the
 *  full mechanism).
 */
