import type { JsonObject } from "@jini-ai/core/primitives";
import type { FormCollectionPlan } from "@jini-ai/core/contracts/forms";
import { escapeHtml } from "@jini-ai/core/text";
import type { FieldDescriptor } from "../../../../forms/index.js";
import { FORM_SUCCESS_CLASS } from "../form-presentation-assets.js";
import { str, arr } from "./value-readers.js";
import { renderWidgetPlaceholder } from "./widgets/placeholder.js";
import type { ContactFormWidgetHost } from "./widgets/widget-render-contract.js";

const DEFAULT_CONTACT_FORM_SUCCESS_MESSAGE = "Thanks — your message has been sent.";

/** Everything one render pass threads between the mode helpers below: the resolved props, the
 *  host, this occurrence's id prefix and the field descriptors (read once). */
interface ContactFormPass {
  readonly props: JsonObject;
  readonly host: ContactFormWidgetHost;
  readonly slug: string;
  readonly idPrefix: string;
  readonly fieldDescriptors: FieldDescriptor[];
  readonly rangeReadout: string;
}

/** Renders a `contact-form` widget: Forms' own declared field vocabulary (REQ-37 — never a
 * hardcoded field-type list), posting to Forms' existing public route unmodified (`POST
 * /forms/:slug/submit`, `routes/site/forms-submit.ts`) — this widget type introduces no new
 * submission endpoint (REQ-39).
 *
 * Carries three things beyond the original bare `<form>` (2026-08-31 fix, generalized the same day —
 * see `form-render.ts`'s module doc for why the baseline style/slots/splice live there now):
 * 1. `form-render.ts`'s `FORM_BASELINE_STYLE` — see that constant's own doc for why a `<style>`
 *    tag lives here instead of a theme stylesheet or `pageShell`'s `<head>`.
 * 2. The GENERIC `data-form-slug` anchor (plus `.widget-contact-form-success`/`-error`/
 *    `data-contact-form-slug` kept alongside it for theme back-compat — no theme has ever targeted
 *    them, per the audit `form-render.ts` cites, but they were always a documented override surface)
 *    on both the form and its (initially hidden) success-message sibling — the stable anchor
 *    `injectFormSubmissionResultIntoHtml` matches against.
 * 3. `props.successMessage` (previously accepted by the resolver, `contact-form.ts`, but never read
 *    here) rendered into that hidden success slot up front, so the post-submission splice only has to
 *    reveal it, never invent or fetch it — this render function is the only place `successMessage` is
 *    naturally in scope.
 */
/** Preserve authored HTML only in HTML mode for a native collection plan.
 * @complexity O(1) time/space; strings are reused, no I/O.
 * @overallScore 97 — Recommended: HTML sanitization remains the authoring write boundary's responsibility. */

function formSchemaOptions({ props }: { props: JsonObject }): { schemaHash?: string } {
  return typeof props.schemaHash === "string" ? { schemaHash: props.schemaHash } : {};
}

function collectionHtmlOptions({ props, formClass }: { props: JsonObject; formClass: string }): { html?: string; className: string } {
  return { ...(props.mode === "html" && typeof props.html === "string" ? { html: props.html } : {}), className: formClass };
}

/** A native collection plan: the registry renderer's collection form, in the host's presentation names.
 * @complexity O(fields + HTML bytes) time/space, no I/O. */
function renderCollectionMode({ props, host, slug, idPrefix, fieldDescriptors, rangeReadout }: ContactFormPass, _optional = {}): string {
  const { presentation } = host;
  return presentation.baselineStyle + host.forms.renderFormCollection({
    slug, fields: fieldDescriptors, plan: props.collectionPlan as unknown as FormCollectionPlan,
    hooks: presentation.hooks,
  }, { ...collectionHtmlOptions({ props, formClass: presentation.formClass }), idPrefix, consentOff: props.collectionConsentOff === true, ...presentation.fieldClasses }) + rangeReadout;
}

/** HTML mode: Builder's look plus author refinements, with the length caps the submit route enforces.
 * @complexity O(fields + HTML bytes) time/space, no I/O. */
function renderHtmlMode({ props, host, slug, idPrefix, fieldDescriptors, rangeReadout }: ContactFormPass, _optional = {}): string {
  const { presentation, forms } = host;
  return presentation.baselineStyle + forms.stampFormFieldMaxLengths({ html: forms.renderHtmlForm({
    slug, action: `/forms/${encodeURIComponent(slug)}/submit`,
    hooks: presentation.hooks,
    fields: fieldDescriptors,
  }, {
    ...(typeof props.html === "string" ? { html: props.html } : {}),
    ...formSchemaOptions({ props }),
    idPrefix,
    successMessage: str({ value: props.successMessage }) || DEFAULT_CONTACT_FORM_SUCCESS_MESSAGE,
    className: presentation.formClass,
    ...presentation.fieldClasses,
  }), fields: fieldDescriptors, fieldMaxChars: forms.fieldMaxChars }) + rangeReadout;
}

/** The existing built-in form shell (legacy built-in Builder shell, kept separate for compatibility).
 * @complexity O(fields) time/space, no I/O. @overallScore 95 — Low. */
function renderBuiltinMode({ props, host, slug, idPrefix, fieldDescriptors, rangeReadout }: ContactFormPass, _optional = {}): string {
  const { presentation, forms } = host;
  const escapedSlug = escapeHtml({ text: slug });
  const fieldOptions = { submitLabel: "Send", idPrefix, ...presentation.fieldClasses };
  const fields = forms.stampFormFieldMaxLengths({ html: forms.renderHtmlFormBody({ fields: fieldDescriptors, hooks: { field: presentation.hooks.field } }, fieldOptions), fields: fieldDescriptors, fieldMaxChars: forms.fieldMaxChars });
  const successMessage = escapeHtml({ text: str({ value: props.successMessage }) || DEFAULT_CONTACT_FORM_SUCCESS_MESSAGE });
  const legacyAttrs = `data-contact-form-slug="${escapedSlug}"`;
  const successSlot = forms.renderFormSuccessSlot({ slug: escapedSlug, message: successMessage, className: FORM_SUCCESS_CLASS }, { extraClasses: "widget-contact-form-success", extraAttrs: legacyAttrs });
  const errorSlot = forms.renderFormErrorSlot({ slug: escapedSlug, className: presentation.errorClass }, { extraClasses: "widget-contact-form-error", extraAttrs: legacyAttrs });
  return (
    presentation.baselineStyle +
    successSlot +
    `<form class="widget ${presentation.formClass} widget-contact-form" toolname="form_${escapeHtml({ text: slug.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 123) })}" tooldescription="${escapedSlug}" method="post"${fieldDescriptors.some(field => field && String(field.type) === "file") ? ' enctype="multipart/form-data"' : ""} action="/forms/${escapedSlug}/submit" data-form-slug="${escapedSlug}" ${legacyAttrs}>` +
    errorSlot +
    fields + forms.renderFormSchemaHash(formSchemaOptions({ props })) +
    `<div hidden aria-hidden="true"><input type="text" name="_hp" tabindex="-1" autocomplete="off"></div>` +
    `</form>` +
    rangeReadout
  );
}

export function renderWidgetContactForm({ props, host }: { props: JsonObject; host: ContactFormWidgetHost }, _optional = {}): string {
  const slug = str({ value: props.slug });
  if (!slug) return renderWidgetPlaceholder();
  // Allocate at the occurrence boundary: the same resolved IR can appear in several embeds or
  // regions, even repeatedly in one region. No answer data or process-wide counter is retained.
  const idPrefix = `widget-contact-${host.newOccurrenceId()}`;
  // HTML mode is Builder's look plus author refinements, not "unstyled": the same baseline and
  // host form-class hook let the active theme's form rules apply, and author CSS still wins over both.
  // The slider value readout ships only with forms that have a range field.
  const rangeReadout = arr({ value: props.fields }).some(field => typeof field === "object" && field !== null && !Array.isArray(field) && field.type === "range") ? host.presentation.rangeReadoutScript : "";
  const fieldDescriptors = arr({ value: props.fields }) as unknown as FieldDescriptor[];
  const pass: ContactFormPass = { props, host, slug, idPrefix, fieldDescriptors, rangeReadout };
  if (props.collectionPlan) return renderCollectionMode(pass);
  // Both modes show the length caps the submit route enforces (owner 2026-10-25, spam protection).
  if (props.mode === "html") return renderHtmlMode(pass);
  return renderBuiltinMode(pass);
}
