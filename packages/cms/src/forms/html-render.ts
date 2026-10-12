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
/** One registry control rendered with label/legend, help/error associations and escaped defaults. */
function renderField(field: FieldDescriptor, hooks: Pick<FormHtmlHooks, "field">, options: FormBodyOptions): string {
  if (!field || typeof field.id !== "string" || typeof field.label !== "string" || !Object.hasOwn(FIELD_TYPE_REGISTRY, field.type)) return "";
  const kind = FIELD_TYPE_REGISTRY[field.type] as { control: string; htmlType: string; multiple?: boolean };
  const id = `${options.idPrefix ?? "form"}-${field.id}`;
  const helpId = `${id}-help`; const errorId = `${id}-error`;
  const label = escapeFormHtml({ value: field.label });
  const describedBy = [field.helpText ? helpId : "", errorId, field.attributes?.["aria-describedby"] ?? ""].filter(Boolean).join(" ");
  const required = field.required ? " required" : "";
  const base = attr("name", field.name ?? field.id) + attr(hooks.field, field.id) + attr("toolparamtitle", field.label) + attr("toolparamdescription", field.helpText ?? field.label) + attr("aria-describedby", describedBy);
  const constraints = [
    ["placeholder", field.placeholder], ["minlength", field.minLength], ["maxlength", field.maxLength], ["pattern", field.pattern],
    ["min", field.min], ["max", field.max], ["step", field.step],
  ] as const;
  const claimed = new Set(["aria-describedby"]);
  let extra = field.className ? attr("class", field.className) : "";
  for (const [name, value] of constraints) {
    if (value == null) continue;
    if (name === "maxlength" && (!Number.isInteger(value) || Number(value) <= 0)) continue;
    if (name === "minlength" && (!Number.isInteger(value) || Number(value) < 0)) continue;
    if (name === "pattern" && !isSafeFieldPattern({ pattern: String(value) })) continue;
    extra += attr(name, value); claimed.add(name);
  }
  extra += extraAttributes(field, claimed);
  const help = field.helpText ? `<div${attr("id", helpId)} class="widget-form-field-help">${escapeFormHtml({ value: field.helpText })}</div>` : "";
  const error = `<div${attr("class", options.errorClass ?? "widget-form-field-error")}${attr("data-field", field.id)}${attr("id", errorId)} hidden></div>`;
  const defaultValues = Array.isArray(field.default) ? field.default : [field.default];
  let control: string;
  if (kind.control === "group") {
    const inputs = (field.options ?? []).map((option, index) => {
      const optionId = `${id}-${index}`;
      const checked = defaultValues.includes(option.value) ? " checked" : "";
      // Native checkbox-group required on each box means ALL, so server enforces one-or-more;
      // aria-required communicates the group's requirement without changing that invariant.
      const optionRequired = kind.multiple ? "" : required;
      return `<label${attr("for", optionId)}><input${attr("id", optionId)}${attr("type", kind.htmlType)}${base}${attr("value", option.value)}${checked}${optionRequired}${extra}>${escapeFormHtml({ value: option.label })}</label>`;
    }).join("");
    return `<fieldset${attr("id", id)}${attr("class", options.fieldClass ?? "widget-form-field")}${attr("aria-describedby", describedBy)}${field.required ? ' aria-required="true"' : ""}><legend>${label}${field.required ? " *" : ""}</legend>${inputs}${help}${error}</fieldset>`;
  }
  if (kind.control === "select") {
    const placeholder = kind.multiple ? "" : `<option value="">${escapeFormHtml({ value: field.placeholder ?? "Choose an option" })}</option>`;
    const choices = (field.options ?? []).map((option) => `<option${attr("value", option.value)}${defaultValues.includes(option.value) ? " selected" : ""}>${escapeFormHtml({ value: option.label })}</option>`).join("");
    control = `<select${attr("id", id)}${base}${kind.multiple ? " multiple" : ""}${required}${extra}>${placeholder}${choices}</select>`;
  } else if (kind.control === "textarea") {
    control = `<textarea${attr("id", id)}${base}${required}${extra}>${escapeFormHtml({ value: String(field.default ?? "") })}</textarea>`;
  } else {
    let value = field.default !== undefined ? attr("value", String(field.default)) : "";
    if (kind.htmlType === "checkbox") value = (field.checkboxValue !== undefined ? attr("value", field.checkboxValue) : "") + (field.default === true || field.default === field.checkboxValue && field.default !== undefined ? " checked" : "");
    if (field.type === "file") value = field.accept ? attr("accept", field.accept.join(",")) : "";
    control = `<input${attr("type", kind.htmlType)}${attr("id", id)}${base}${field.type === "toggle" ? ' role="switch"' : ""}${required}${value}${extra}>`;
  }
  if (field.type === "hidden") return control;
  // The checkbox modifier lets the baseline put the box before its label on one line (owner report
  // 2026-10-05: stacked and stretched like a text input, its glyph drew centred under the label).
  const fieldClass = (options.fieldClass ?? "widget-form-field") + (kind.htmlType === "checkbox" ? " widget-form-field-checkbox" : "");
  return `<div${attr("class", fieldClass)}><label${attr("for", id)}>${label}${field.required ? " *" : ""}</label>${control}${help}${error}</div>`;
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
