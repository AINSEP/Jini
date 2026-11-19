import { escapeHtml } from "@jini-ai/core/text";
import { FORM_ATTEMPT_FIELD } from "./submission-attempts.js";
import type { FieldDescriptor } from "./types.js";

/** Shared shape for {@link renderFormSuccessSlot}/{@link renderFormErrorSlot}. `slug` in the required input must already be
 *  HTML-escaped by the caller (this module never re-escapes a value it did not itself produce, same
 *  rule the other rendering helpers follow). `extraClasses`/`extraAttrs` let a widget with a
 *  pre-existing, widget-specific hook (e.g. `contact-form`'s `.widget-contact-form-success`/
 *  `data-contact-form-slug`) keep emitting it alongside the generic one for theme back-compat,
 *  without this module needing to know that widget's name. */
export interface FormSlotOptions {
  extraClasses?: string;
  extraAttrs?: string;
}

/** Renders a form's hidden success-message slot — revealed later, in place, by
 *  {@link injectFormSubmissionResultIntoHtml} once a same-slug `"success"` result is spliced in.
 *  `message` must already be HTML-escaped by the caller. @complexity O(1). */
export function renderFormSuccessSlot(
  required: { slug: string; className: string; message: string }, options: FormSlotOptions = {},
): string {
  const classAttr = options.extraClasses ? `${required.className} ${options.extraClasses}` : required.className;
  const attrs = options.extraAttrs ? ` ${options.extraAttrs}` : "";
  return `<div class="${classAttr}" data-form-slug="${required.slug}"${attrs} hidden>${required.message}</div>`;
}

/** Renders a form's hidden error-summary slot — revealed later, in place, by
 *  {@link injectFormSubmissionResultIntoHtml} for a same-slug `"validation"`/`"rate-limited"`/
 *  `"error"` result. Starts empty; the message text is always attacker-influenced-or-fixed content
 *  spliced in after the fact, never rendered here. @complexity O(1). */
export function renderFormErrorSlot(
  required: { slug: string; className: string }, options: FormSlotOptions = {},
): string {
  const classAttr = options.extraClasses ? `${required.className} ${options.extraClasses}` : required.className;
  const attrs = options.extraAttrs ? ` ${options.extraAttrs}` : "";
  return `<div class="${classAttr}" data-form-slug="${required.slug}"${attrs} hidden></div>`;
}

/** Every public form's opening tag: both renderers (Builder and HTML mode) stamp `data-form-slug`. */
const FORM_OPENING_TAG = new RegExp(`<form\\b[^>]*\\bdata-form-slug="([^"]*)"[^>]*>`, "gi");

/**
 * Puts a fresh hidden `_attempt` token first inside every public form on a page being served, so the
 * submit route can tell a double-clicked Send (one token, twice) from two real submissions (two
 * page loads). See the sibling submission-attempts module for the dedupe it feeds and its fallback.
 *
 * Applied per response, after rendering, because neither form renderer has a request in scope and
 * a rendered body must stay identical for every visitor up to this point. A page a shared cache
 * replays repeats its token; that only falls back to the old same-IP-and-body comparison.
 * `newToken` receives the form slug so composition can register server issuance while generating
 * the token. Generation errors propagate; no client timestamp or extra control is introduced.
 * @complexity O(html.length) — one regex pass; one `newToken()` call per form.
 */
export function injectFormAttemptTokens(
  { html, newToken }: { html: string; newToken: (required: { slug: string }, optional?: Record<string, never>) => string },
  _optional: Record<string, never> = {},
): string {
  return html.replace(
    FORM_OPENING_TAG,
    (openTag, slug: string) => `${openTag}<input type="hidden" name="${FORM_ATTEMPT_FIELD}" value="${escapeHtml({ text: newToken({ slug }, {}) })}">`,
  );
}

/** One visible text control's `maxlength`: an author's own attribute stays; otherwise the cap the
 *  submit route enforces (provided by the host). Hidden inputs have nothing to show. */
function stampControlMaxLength({ tag, caps }: { tag: string; caps: ReadonlyMap<string, number> }, _optional = {}): string {
  const max = caps.get(/\sname="([^"]*)"/i.exec(tag)?.[1] ?? "");
  if (max === undefined || /\smaxlength\s*=/i.test(tag) || /\stype="hidden"/i.test(tag)) return tag;
  const selfClosing = /\/>$/.test(tag);
  return `${tag.slice(0, tag.length - (selfClosing ? 2 : 1)).trimEnd()} maxlength="${max}"${selfClosing ? "/>" : ">"}`;
}

/** Adds `maxlength` to every text input/textarea of a rendered public form (Builder or HTML mode) so
 *  the browser stops typing at the same cap the server refuses past. Browsers count UTF-16 units here
 *  while the server counts code points, so the browser is never the looser of the two.
 *  @complexity O(html.length + fields). */
export function stampFormFieldMaxLengths({ html, fields, fieldMaxChars }: { html: string; fields: readonly FieldDescriptor[]; fieldMaxChars: (required: { field: FieldDescriptor }, optional?: Record<string, never>) => number | undefined }, _optional = {}): string {
  const caps = new Map<string, number>();
  for (const field of fields) {
    const max = typeof field === "object" && field !== null ? fieldMaxChars({ field }) : undefined;
    if (max !== undefined) caps.set(field.id, max);
  }
  return html.replace(/<(?:input|textarea)\b[^>]*>/gi, (tag) => stampControlMaxLength({ tag, caps }));
}
