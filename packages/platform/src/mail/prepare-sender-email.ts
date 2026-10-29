import { EmailSenderError, type EmailSender, type EmailSourceDescription, type EmailSourceField,
  type EmailSourceRequest, type EmailTemplatePort, type ResolvedEmailEvent } from "./email-sender.js";
import type { EmailAddress } from "./types.js";

/** Refuses unsupported declarations and undeclared placeholders before activation or rendering.
 * @complexity O(f + d + p) source fields, declarations and placeholders; no I/O. */
export function validateEmailSourceTemplate(
  required: { readonly fields: readonly EmailSourceField[]; readonly template: { readonly fields: readonly string[]; readonly placeholders: readonly string[] } },
  _optional: Record<string, never> = {},
): void {
  const available = new Set(required.fields.map(field => field.token));
  const declared = new Set(required.template.fields);
  if (required.template.fields.some(token => !available.has(token))) throw new EmailSenderError({ code: "incompatible" });
  if (required.template.placeholders.some(token => !declared.has(token))) throw new EmailSenderError({ code: "incompatible" });
}

/** A preparation result is suitable for freezing in the sender's existing job, never a new queue. */
export interface PreparedSenderEmail {
  readonly bindingId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly to: EmailAddress;
  readonly replyTo: EmailAddress;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly purpose: EmailSourceDescription["purpose"];
  readonly lane: EmailSourceDescription["lane"];
  readonly warnings: readonly string[];
}

/** Selects declared values, refusing missing required answers and warning on absent optional ones. */
function templateValues(required: {
  fields: readonly EmailSourceField[]; tokens: readonly string[]; values: Readonly<Record<string, string>>;
}, _optional: Record<string, never> = {}): { values: Record<string, string>; warnings: string[] } {
  const fields = new Map(required.fields.map(field => [field.token, field]));
  const warnings: string[] = [];
  const values = Object.fromEntries(required.tokens.map(token => {
    const value = Object.hasOwn(required.values, token) ? required.values[token] : undefined;
    if (typeof value === "string" && value !== "") return [token, value];
    if (fields.get(token)?.required) throw new EmailSenderError({ code: "missing_value" });
    warnings.push(token);
    return [token, ""];
  }));
  return { values, warnings };
}

/** Resolves only a source-permitted recipient; configuration and missing answers fail separately.
 * @complexity O(permitted choices + resolved recipients); no I/O. */
function recipientAddress(
  { source, resolved, recipientId }: { source: EmailSourceDescription; resolved: ResolvedEmailEvent; recipientId: string },
  _optional: Record<string, never> = {},
): EmailAddress {
  if (!source.permittedRecipients.some(choice => choice.id === recipientId)) throw new EmailSenderError({ code: "configuration" });
  const recipient = resolved.recipients.find(choice => choice.id === recipientId);
  if (!recipient) throw new EmailSenderError({ code: "missing_value" });
  return recipient.address;
}

/** Resolves authoritative event data and the saved binding, then calls the existing renderer.
 * No preview samples, envelope overrides or delivery effects enter this operation.
 * @throws EmailSenderError for ownership, inactive/pre-activation events, readiness, compatibility or missing data; port errors propagate.
 * @complexity O(fields + declarations + placeholders); one describe, resolve and render per event. */
export async function prepareSenderEmail(
  required: EmailSourceRequest & { readonly sender: EmailSender; readonly templates: EmailTemplatePort; readonly eventId: string },
  _optional: Record<string, never> = {},
): Promise<PreparedSenderEmail> {
  const { sender, templates, workspaceId, principalId, sourceId, eventId } = required;
  const context = { workspaceId, principalId, sourceId };
  const source = await sender.describeSource(context);
  if (source.senderId !== sender.id || source.sourceId !== sourceId) throw new EmailSenderError({ code: "ownership" });
  const binding = source.binding;
  if (!binding?.enabled) throw new EmailSenderError({ code: "configuration" });
  if (!source.readiness.ready) throw new EmailSenderError({ code: "not_ready" });
  const templateContext = { workspaceId, principalId, templateId: binding.templateId };
  const template = await templates.describe(templateContext);
  validateEmailSourceTemplate({ fields: source.fields, template });
  const resolved = await sender.resolveEvent({ ...context, eventId });
  // MOVE: Compare against the latest activation so re-enabling cannot revive a backlog.
  if (!occurredSinceActivation({ occurredAt: resolved.occurredAt, activatedAt: binding.activatedAt })) throw new EmailSenderError({ code: "configuration" });
  const to = recipientAddress({ source, resolved, recipientId: binding.recipientId });
  const { values, warnings } = templateValues({ fields: source.fields, tokens: template.fields, values: resolved.values });
  const rendered = await templates.render({ ...templateContext, version: template.version, values });
  if (rendered.missingFields.length > 0) throw new EmailSenderError({ code: "missing_value" });
  return { bindingId: binding.bindingId, templateId: binding.templateId, templateVersion: template.version, to,
    replyTo: { email: binding.replyTo }, subject: rendered.subject, html: rendered.html, text: rendered.text,
    purpose: source.purpose, lane: source.lane, warnings };
}

/** True only for an event at or after the binding's activation; an unparsable time is never current. */
function occurredSinceActivation({ occurredAt, activatedAt }: { occurredAt: string; activatedAt: string | null | undefined }): boolean {
  if (!activatedAt) return false;
  return Date.parse(occurredAt) >= Date.parse(activatedAt);
}
