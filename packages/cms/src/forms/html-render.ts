/** Framework-free HTML renderer, kept separate for extraction into @jini-ai/cms/forms.
 * Local prototype authorized 2026-10-04; that original dispatch kept Jini read-only.
 * The host owns the endpoint and the form's styling hook; author markup and CSS refine it. */
import type { FieldDescriptor } from "./types.js";

/** Attribute names are trusted host constants, not visitor input. Values are always escaped. */
export interface FormHtmlHooks { field: string; form: string; success: string; error: string; }

export function escapeFormHtml({ value }: { value: string }, _optional = {}): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function renderHtmlFormBody(
  { fields, hooks }: { fields: readonly FieldDescriptor[]; hooks: Pick<FormHtmlHooks, "field"> },
  { submitLabel = "Send" }: { submitLabel?: string } = {},
): string {
  return fields.map((field) => {
    const name = escapeFormHtml({ value: field.id });
    const label = escapeFormHtml({ value: field.label });
    const required = field.required ? " required" : "";
    const maxLength = field.maxLength != null ? ` maxlength="${field.maxLength}"` : "";
    const attributes = `name="${name}" ${hooks.field}="${name}" toolparamtitle="${label}" toolparamdescription="${label}"${required}${maxLength}`;
    const control = field.type === "textarea"
      ? `<textarea ${attributes}></textarea>`
      : `<input type="${field.type}" ${attributes}>`;
    return `<label>${label}${control}</label>`;
  }).join("\n") + `\n<button type="submit">${escapeFormHtml({ value: submitLabel })}</button>`;
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
    `<form ${classAttr}${hooks.form}="${escapedSlug}" ${slugHook} toolname="form_${escapeFormHtml({ value: slug.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 123) })}" tooldescription="${escapedSlug}" method="post" action="${escapeFormHtml({ value: action })}">` +
    `<div ${hooks.error} ${slugHook} role="alert" hidden></div>` +
    (html ?? renderHtmlFormBody({ fields, hooks })) +
    // Hidden container requires neither a theme class nor inline CSS; bots still see the input.
    `<div hidden aria-hidden="true"><input type="text" name="_hp" tabindex="-1" autocomplete="off"></div></form>`;
}
