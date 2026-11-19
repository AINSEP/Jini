import type {} from "@jini-ai/core";
import { escapeHtml } from "@jini-ai/core/text";
import type { FormHtmlHooks } from "./html-render.js";
import type { FormSubmissionRedirectResult } from "./types.js";

// Renderers pre-build stable hidden slots without request state. The host splices the outcome
// after the full document exists, so native POST/redirect feedback works with JavaScript disabled.
// Request, cookie and query parsing remain with the host; this module only decorates resolved HTML.

/** Un-hides the success-message sibling {@link renderFormSuccessSlot} pre-rendered for `slugPattern`
 *  (already both HTML- and regex-escaped by the caller). Matches on the GENERIC `${markup.successClass}`
 *  class + `data-form-slug` attribute — never a widget-specific legacy class/attribute — so this
 *  splice works for any form-rendering widget, not just `contact-form` (2026-08-31 generalization).
 *  A replacer FUNCTION, not a replacement string — the spliced-in text can itself contain
 *  `$`-prefixed sequences (`$&`, `$1`, ...) that `String.prototype.replace` would otherwise
 *  reinterpret as its own replacement-pattern syntax, corrupting or duplicating unrelated output; a
 *  function return value is always inserted literally. */
function showFormSuccessMessage({ html, slugPattern, markup }: { html: string; slugPattern: string; markup: Parameters<typeof injectFormSubmissionResultIntoHtml>[0]["markup"] }, _optional = {}): string {
  const successRegex = new RegExp(`(<div class="[^"]*\\b${markup.successClass}\\b[^"]*" data-form-slug="${slugPattern}"[^>]*) hidden>`, "i");
  const plainRegex = new RegExp(`(<div ${markup.hooks.success} data-form-slug="${slugPattern}"[^>]*) hidden>`, "i");
  return html.replace(successRegex, (_match, openTag: string) => `${openTag}>`)
    .replace(plainRegex, (_match, openTag: string) => `${openTag}>`);
}

/** Adds `hidden` to the matched `<form ...>` block's own opening tag — used on success, once the
 *  message above is shown, so the visitor sees the confirmation in place of the (now pointless) form
 *  rather than both at once. */
function hideFormElement({ formHtml }: { formHtml: string }, _optional = {}): string {
  return formHtml.replace(/^<form /, "<form hidden ");
}

/** Un-hides the form-level error-summary slot with `message` (a fixed string the host supplies — never attacker-controlled — for the `rate-limited`/`error` cases and the validation
 *  banner; see {@link showFieldErrors} for the one case where the text IS attacker-controlled).
 *  Matches on the generic class/attribute, same reasoning as {@link showFormSuccessMessage}. */
function showFormErrorSummary({ formHtml, slugPattern, message, markup }: { formHtml: string; slugPattern: string; message: string; markup: Parameters<typeof injectFormSubmissionResultIntoHtml>[0]["markup"] }, _optional = {}): string {
  const errorRegex = new RegExp(`(<div class="[^"]*\\b${markup.errorClass}\\b[^"]*" data-form-slug="${slugPattern}"[^>]*) hidden><\\/div>`, "i");
  const plainRegex = new RegExp(`(<div ${markup.hooks.error} data-form-slug="${slugPattern}"[^>]*) hidden><\\/div>`, "i");
  return formHtml.replace(errorRegex, (_match, openTag: string) => `${openTag}>${message}</div>`)
    .replace(plainRegex, (_match, openTag: string) => `${openTag}>${message}</div>`);
}

/** Un-hides each per-field error slot named in `fieldErrors` with its localized, HTML-escaped
 *  instruction. `field` came off `readFieldErrorsFromQuery` — a visitor-controlled query string —
 *  and messages include server-rendered labels, so both get `escapeHtml`; a slot naming a field the form
 *  doesn't actually have (stale/forged) simply never matches and is a no-op for that one entry, not
 *  a partial-corruption risk. The field wrapper/error classes are already
 *  form-generic hooks (not widget-specific), so no change was needed here for the
 *  2026-08-31 generalization beyond moving the function. */
function showFieldErrors({ formHtml, fieldErrors, markup }: { formHtml: string; fieldErrors: ReadonlyArray<{ field: string; message: string }>; markup: Parameters<typeof injectFormSubmissionResultIntoHtml>[0]["markup"] }, _optional = {}): string {
  return fieldErrors.reduce((updated, { field, message }) => {
    const fieldPattern = RegExp.escape(escapeHtml({ text: field }));
    const fieldErrorRegex = new RegExp(`(<div class="${markup.fieldErrorClass}" data-field="${fieldPattern}"[^>]*) hidden></div>`, "i");
    return updated.replace(fieldErrorRegex, (_match, openTag: string) => `${openTag}>${escapeHtml({ text: message })}</div>`);
  }, formHtml);
}

/** Sets `<input ...>` tag's `value` attribute to `escapedValue`, given the FULL matched tag text
 *  (open through close). Two shapes, both handled without disturbing anything else the tag carries:
 *  1. The tag already has a `value="..."` attribute (including `value=""`) — REPLACE it in place.
 *     Appending a second `value=` instead (the pre-fix behavior) is a silent no-op in every browser:
 *     the DOM/HTML spec honors only the FIRST `value` attribute on an element, so the stale one
 *     (e.g. `value="old"`) would keep winning over the freshly-flashed one.
 *  2. No existing `value` attribute — insert one just before the tag's own closing `>`, preserving
 *     whichever closing form the source used (bare `<input ...>` stays bare; XHTML-style
 *     `<input .../>` keeps its `/>`) rather than normalizing one into the other.
 *  A replacer FUNCTION at both call sites for the same `$&`/`$1` corruption reason documented on
 *  {@link showFormSuccessMessage} — `escapedValue` is spliced in via template literal, never handed
 *  to `String.prototype.replace` as a replacement-string argument. @complexity O(tag.length).
 *
 *  BUG FIX (2026-09-05, Gemini audit finding #5): the existing-attribute check used to be
 *  `/\bvalue="[^"]*"/i` — `\b` is a boundary between a word char and a non-word char, not "start of
 *  attribute name," so it also matched mid-attribute-name (`data-default-value="x"` has a `\b` right
 *  before "value" because `-` precedes it), silently corrupting a theme author's own custom
 *  `data-*-value` attribute in place instead of adding a real `value=`. It also required double
 *  quotes, so a hand-authored `value='old'` (single-quoted) was invisible to this check and got a
 *  SECOND, double-quoted `value=` appended below — regressing the exact stale-value-wins bug already
 *  fixed once for double quotes (browsers only honor the first same-named attribute). Requiring a
 *  literal preceding whitespace character (the actual attribute-name boundary in HTML) rather than
 *  `\b`, and matching either quote character via a backreference, fixed both without touching the
 *  "no existing attribute" branch below.
 *
 *  BUG FIX (2026-09-06): that same-day fix's own value-body class, `[^"']*`, excluded BOTH quote
 *  characters instead of just the one delimiting THIS attribute — so `value="Don't know"` (a
 *  double-quoted value containing a legitimate apostrophe) could not be spanned by `[^"']*` at all: it
 *  stops at the embedded `'`, backtracking never finds a `"` there, and the whole match fails. That
 *  re-creates the exact append-a-second-`value=` bug this function's own doc already describes as
 *  fixed, just gated on "value contains the OTHER quote character" instead of "value uses the OTHER
 *  quote style." Fixed by matching each quote style as its own alternative — `"[^"]*"` or `'[^']*'` —
 *  so the body only ever excludes the ONE character that would end that particular alternative, not
 *  both, letting a double-quoted value safely contain an apostrophe (and a single-quoted value safely
 *  contain a double quote). No backreference is needed anymore since each alternative already commits
 *  to a specific delimiter pair. Unquoted `value=old` attributes are a separate, pre-existing gap (not
 *  introduced or widened by this fix) — the existing theme corpus
 *  had no such attributes, so this preserves the existing supported shapes. */
function setInputValueAttr({ tag, escapedValue }: { tag: string; escapedValue: string }, _optional = {}): string {
  const existingValueAttr = /(\s)value=("[^"]*"|'[^']*')/i;
  if (existingValueAttr.test(tag)) {
    return tag.replace(existingValueAttr, (_match, leadingSpace: string) => `${leadingSpace}value="${escapedValue}"`);
  }
  const selfClosing = /\/>$/.test(tag);
  const beforeClose = tag.slice(0, tag.length - (selfClosing ? 2 : 1)).trimEnd();
  return `${beforeClose} value="${escapedValue}"${selfClosing ? "/>" : ">"}`;
}

/** Re-populates ONE field's rendered value from the validation flash (2026-08-31 field-wipe fix) —
 *  tries the field's `<textarea name="FIELD">` shape first, then its `<input name="FIELD">` shape;
 *  exactly one ever matches (a field renders as one element kind), so trying both and keeping
 *  whichever changed the string is cheaper than threading the field's own type through this
 *  string-splice layer, which otherwise has no reason to know it. A field id naming an element this
 *  form doesn't have (stale/forged flash) is a silent no-op, same discipline as {@link showFieldErrors}.
 *  The `<input>` match is bounded to `[^>]*>` — a single `>` closes it, same bounding discipline every
 *  other regex in this file uses — so it can never swallow a neighboring tag; {@link setInputValueAttr}
 *  then decides whether that closing `>` was itself `/>` (2026-09-03 fix: previously REQUIRED `/>`, so
 *  a standard HTML5 `<input name="x">` — no XHTML self-close — never matched at all and silently kept
 *  its wiped value). A replacer FUNCTION for the same `$&`/`$1` corruption reason documented on
 *  {@link showFormSuccessMessage}. @complexity O(html.length) per call — two regex passes, the
 *  second only executed when the first did not match. */
function showOneFieldValue({ html, field, value }: { html: string; field: string; value: string }, _optional = {}): string {
  const fieldPattern = RegExp.escape(escapeHtml({ text: field }));
  const escapedValue = escapeHtml({ text: value });
  const textareaRegex = new RegExp(`(<textarea\\b[^>]*\\bname="${fieldPattern}"[^>]*>)[\\s\\S]*?(<\\/textarea>)`, "i");
  const withTextarea = html.replace(textareaRegex, (_match, openTag: string, closeTag: string) => `${openTag}${escapedValue}${closeTag}`);
  if (withTextarea !== html) return withTextarea;
  const inputRegex = new RegExp(`<input\\b[^>]*\\bname="${fieldPattern}"[^>]*>`, "i");
  return html.replace(inputRegex, (matchedTag: string) => setInputValueAttr({ tag: matchedTag, escapedValue }));
}

/** Re-populates every field named in `values` (already filtered to repopulatable, non-sensitive
 *  field types and HTML-escaped-safe raw strings by the caller — see the host's flash-value
 *  builder) into `formHtml`. `undefined` (no flash present, or a plain success/
 *  rate-limited/error result) is a byte-identical no-op. @complexity O(n) reduce over `values`'
 *  entries, each doing {@link showOneFieldValue}'s own bounded work. */
function showFieldValues({ formHtml, values }: { formHtml: string; values: Readonly<Record<string, string>> | undefined }, _optional = {}): string {
  if (!values) return formHtml;
  return Object.entries(values).reduce((updated, [field, value]) => showOneFieldValue({ html: updated, field, value }), formHtml);
}

/** The `"validation"` outcome for one matched `<form>` block: per-field messages (labels read from
 *  the form's own markup, copy in the document's language), re-populated values, and the summary.
 *  An HTML-mode form (the host form hook) lists every message in its summary; a Builder form shows the
 *  generic line because its per-field messages already sit beside each field. A result with no field
 *  errors still produces one generic "check this field" message. @complexity O(formHtml.length) per
 *  field error. */
function showValidationResult(
  { html, originalForm, slugPattern, result, markup, feedback }: { html: string; originalForm: string; slugPattern: string; result: Extract<FormSubmissionRedirectResult, { kind: "validation" }>; markup: Parameters<typeof injectFormSubmissionResultIntoHtml>[0]["markup"]; feedback: Parameters<typeof injectFormSubmissionResultIntoHtml>[0]["feedback"] },
  _optional = {},
): string {
  const authored = originalForm.includes(`${markup.hooks.form}=`);
  const messages = feedback.validationMessages({
    html,
    formHtml: originalForm,
    errors: result.fieldErrors.length ? result.fieldErrors : [{ field: "", reason: "invalid" }],
  });
  return showFormErrorSummary({ formHtml: showFieldValues({ formHtml: showFieldErrors({ formHtml: originalForm, fieldErrors: messages, markup }), values: result.values }), slugPattern, message: authored ? messages.map(({ message }) => escapeHtml({ text: message })).join(" ") : feedback.validationSummary, markup });
}

/** Rebuilds the one matched `<form>` block for `result`'s outcome (success hides it; every other
 *  outcome reveals its error summary). The success MESSAGE slot sits outside the form and is shown
 *  separately by the caller. @complexity O(formHtml.length), plus {@link showValidationResult}'s own
 *  work for `"validation"`. */
function updateFormForResult(
  { html, originalForm, slugPattern, result, markup, feedback }: { html: string; originalForm: string; slugPattern: string; result: FormSubmissionRedirectResult; markup: Parameters<typeof injectFormSubmissionResultIntoHtml>[0]["markup"]; feedback: Parameters<typeof injectFormSubmissionResultIntoHtml>[0]["feedback"] },
  _optional = {},
): string {
  if (result.kind === "success") return hideFormElement({ formHtml: originalForm });
  if (result.kind === "validation") return showValidationResult({ html, originalForm, slugPattern, result, markup, feedback });
  if (result.kind === "too-fast") return showFormErrorSummary({ formHtml: showFieldValues({ formHtml: originalForm, values: result.values }), slugPattern, message: feedback.tooFast, markup });
  if (result.kind === "rate-limited") {
    return showFormErrorSummary({ formHtml: originalForm, slugPattern, message: feedback.rateLimited({ retryAfterSeconds: result.retryAfterSeconds }), markup });
  }
  return showFormErrorSummary({ formHtml: originalForm, slugPattern, message: feedback.error, markup });
}

/**
 * Splices a {@link FormSubmissionRedirectResult} into an already-fully-rendered page's HTML,
 * targeting the ONE form widget instance whose `data-form-slug` matches `result.slug` — every
 * other form on the page (a different widget instance, a different form-rendering widget type, or
 * none at all) is left byte-for-byte unchanged. Called once per response, AFTER every render path
 * has already produced its final HTML string.
 *
 * Keys the match on the GENERIC `data-form-slug` attribute, not a widget-specific one
 * (2026-08-31 generalization) — any widget built on {@link renderFormSuccessSlot}/
 * {@link renderFormErrorSlot}/a `<form>` carrying the host's form class gets this splice for free, without
 * this function knowing that widget's name.
 *
 * A `result` for a slug that never appears in `html` (a stale or forged query string pointing at a
 * widget this particular page doesn't have) is a silent no-op: `html` comes back byte-identical,
 * never a crash or a misapplied result on the wrong form.
 * @complexity O(html.length) for the initial `<form>` scan, then O(formHtml.length) for the chosen
 * outcome's own splice (bounded by `result.fieldErrors.length`/`values` size for `"validation"`,
 * themselves already capped upstream).
 */
export function injectFormSubmissionResultIntoHtml(
  { html, result, markup, feedback }: {
    html: string; result: FormSubmissionRedirectResult | undefined;
    markup: { successClass: string; errorClass: string; fieldErrorClass: string; hooks: Pick<FormHtmlHooks, "form" | "success" | "error"> };
    feedback: {
      validationMessages: (required: { html: string; formHtml: string; errors: ReadonlyArray<{ field: string; reason: string }> }, optional?: Record<string, never>) => Array<{ field: string; message: string }>;
      validationSummary: string; tooFast: string;
      rateLimited: (required: { retryAfterSeconds: number }, optional?: Record<string, never>) => string;
      error: string;
    };
  }, _optional = {},
): string {
  if (!result) return html;
  const slugPattern = RegExp.escape(escapeHtml({ text: result.slug }));
  const formRegex = new RegExp(`<form\\b[^>]*data-form-slug="${slugPattern}"[^>]*>[\\s\\S]*?<\\/form>`, "i");
  const formMatch = formRegex.exec(html);
  if (!formMatch) return html;
  const originalForm = formMatch[0];

  const updatedForm = updateFormForResult({ html, originalForm, slugPattern, result, markup, feedback });

  // The success slot sits BEFORE the `<form>` in document order, so it must be revealed as a
  // SEPARATE regex pass over the already-rebuilt string, never by combining offsets from two
  // different splices into one manual slice — `formMatch.index` was measured against the ORIGINAL
  // `html`, and no longer lines up with anything once an earlier edit shifts every byte after it.
  const withUpdatedForm = html.slice(0, formMatch.index) + updatedForm + html.slice(formMatch.index + originalForm.length);
  return result.kind === "success" ? showFormSuccessMessage({ html: withUpdatedForm, slugPattern, markup }) : withUpdatedForm;
}

