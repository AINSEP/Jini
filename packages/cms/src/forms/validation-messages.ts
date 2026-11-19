/** [required, select, too long, invalid, "this field", too long with the field's {max} characters]. */
export type FormValidationCopy = readonly [string, string, string, string, string, string];

/** A too-long answer names the control's own numeric maxlength (the cap the server enforced). */
function tooLongTemplate(
  { copy, control }: { copy: FormValidationCopy; control: { maxLength?: string } | undefined }, _optional = {},
): string {
  const max = control?.maxLength;
  return max && /^\d+$/.test(max) ? copy[5].replace("{max}", () => max) : copy[2];
}

function messageTemplate(
  { copy, reason, control }: { copy: FormValidationCopy; reason: string; control: { type?: string; maxLength?: string } | undefined }, _optional = {},
): string {
  if (reason === "too_long") return tooLongTemplate({ copy, control });
  if (reason !== "required") return copy[3];
  const checkbox = control !== undefined && control.type?.toLowerCase() === "checkbox";
  return checkbox ? copy[1] : copy[0];
}

function fieldMessage(
  { field, reason, control, copy, normalizeLabel }: {
    field: string; reason: string; control: { label?: string; type?: string; maxLength?: string } | undefined;
    copy: FormValidationCopy; normalizeLabel: ((required: { label: string }, optional?: Record<string, never>) => string) | undefined;
  }, _optional = {},
): { field: string; message: string } {
  const authored = control?.label?.trim();
  const trimmed = (authored?.endsWith("*") ? authored.slice(0, -1).trimEnd() : authored) || copy[4];
  const label = normalizeLabel ? normalizeLabel({ label: trimmed }) : trimmed;
  return { field, message: messageTemplate({ copy, reason, control }).replace("{label}", () => label) };
}

/** Labels come from the actual server-rendered form, never visitor-controlled result params.
 * The host inspector handles entities and label/control associations, skipping inert subtrees.
 * Inspect once, select copy with form-locale precedence, and retain error order and literal text. */
export function formValidationMessages(
  { formHtml, errors, locale, inspect, resolveCopy }: {
    formHtml: string; errors: ReadonlyArray<{ field: string; reason: string }>; locale: string;
    inspect: (required: { formHtml: string; fields: readonly string[] }, optional?: Record<string, never>) => {
      formLocale?: string;
      controls: ReadonlyMap<string, { label?: string; type?: string; maxLength?: string }>;
    };
    resolveCopy: (required: { locale: string }, optional?: Record<string, never>) => {
      copy: FormValidationCopy;
      normalizeLabel?: (required: { label: string }, optional?: Record<string, never>) => string;
    };
  }, _optional = {},
): Array<{ field: string; message: string }> {
  const { formLocale, controls } = inspect({ formHtml, fields: errors.map(({ field }) => field) });
  const { copy, normalizeLabel } = resolveCopy({ locale: formLocale || locale });
  return errors.map(({ field, reason }) => fieldMessage({ field, reason, control: controls.get(field), copy, normalizeLabel }));
}

export function formDocumentLocale({ html }: { html: string }, _optional = {}): string {
  return /<html\b[^>]*\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html)?.slice(1).find((value) => value !== undefined) || "en";
}
