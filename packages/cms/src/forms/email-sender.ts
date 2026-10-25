/** MOVE: Forms owns submission identity, exported answers and recipient selection. This adapter
 * extends that ownership; it never creates a settings store, queue, renderer or notification path. */
import { EmailSenderError, validateEmailSourceTemplate, type EmailBinding, type EmailReadiness,
  type EmailSender, type EmailSenderContext, type EmailSourceRequest, type EmailSourceSummary,
  type EmailTemplatePort } from "@jini-ai/platform/mail/senders";
import { describeFormEmailFields, emailAnswerFields, formEmailFieldToken, resolveFormEmailValues } from "./email-sender-fields.js";
import { isValidFormEmail } from "./email-format.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "./ports.js";
import { FORM_SUBMISSION_RECEIVED_EVENT, type FormDefinitionRecord } from "./types.js";

/** Additive tagged action for core.forms.deliveryBindings. Existing destination bindings and their
 * planner keep their contract; phase 2 admits this action into that same guarded write/plan owner. */
export interface FormEmailAction {
  readonly kind: "email";
  readonly bindingId: string;
  readonly formId: string;
  readonly enabled: boolean;
  readonly activatedAt: string | null;
  readonly templateId: string;
  readonly submitterEmailFieldId: string;
  readonly replyTo: string;
}
/** The guarded writer owns activation time, revision checks, approval, validation and persistence. */
export type FormEmailActionInput = Omit<FormEmailAction, "activatedAt">;
/** Localhost/unverified-origin send holds are host send-time policy, never readiness blockers. */
export interface FormsEmailSenderDeps {
  definitions: Pick<FormDefinitionRepoPort, "list" | "findById">;
  submissions: Pick<FormSubmissionRepoPort, "findById">;
  /** Map resolve to submission-read authority, and configure to the existing guarded settings write.
   * A list/describe grant alone must never authorize reading stored submission data. */
  authorize(required: EmailSenderContext & { readonly operation: "list" | "describe" | "resolve" | "configure"; readonly sourceId?: string }, optional?: Record<string, never>): Promise<boolean>;
  readEmailBinding(required: { readonly workspaceId: string; readonly formId: string }, optional?: Record<string, never>): Promise<FormEmailAction | null>;
  /** Merge one email action into core.forms.deliveryBindings through its existing write owner.
   * Must atomically recheck approval, source/template versions, readiness and settings revision;
   * set activation time on enable, preserve binding identity, and never backfill old events. */
  writeEmailBinding(required: EmailSenderContext & { readonly binding: FormEmailActionInput }, optional?: Record<string, never>): Promise<FormEmailAction>;
  /** Canonical site name and origin from the host's existing site/origin registry. */
  site(required: { readonly workspaceId: string }, optional?: Record<string, never>): Promise<{ readonly name: string; readonly url: string }>;
  /** Host capability-specific background readiness; never infer this from an interactive test. */
  readiness(required: EmailSourceRequest, optional?: Record<string, never>): Promise<EmailReadiness>;
  templates: EmailTemplatePort;
}

function summary({ definition }: { definition: FormDefinitionRecord }, _optional: Record<string, never> = {}): EmailSourceSummary {
  return { senderId: "forms", sourceId: definition.id, eventName: FORM_SUBMISSION_RECEIVED_EVENT, label: definition.name };
}
function bindingView({ binding }: { binding: FormEmailAction }, _optional: Record<string, never> = {}): EmailBinding {
  return { bindingId: binding.bindingId, enabled: binding.enabled, activatedAt: binding.activatedAt,
    templateId: binding.templateId, recipientId: binding.submitterEmailFieldId, replyTo: binding.replyTo };
}
function recipientFields({ definition }: { definition: FormDefinitionRecord }, _optional: Record<string, never> = {}) {
  return emailAnswerFields({ definition }).filter(field => field.type === "email");
}

/** Forms implementation of the vendor-neutral sender contract. All data reads are workspace
 * scoped and checked again before export, even if a host repository violates its scope contract.
 * @throws EmailSenderError on denied access, ownership mismatch or invalid configuration.
 * @complexity O(forms) listing authorization calls; other methods O(fields), plus bounded port I/O. */
export function createFormsEmailSender(
  { deps }: { readonly deps: FormsEmailSenderDeps }, _optional: Record<string, never> = {},
): EmailSender {
  /** MOVE: Repository lookups own id matching; this boundary enforces authorization and workspace scope. */
  async function definitionFor({ request, operation }: { request: EmailSourceRequest; operation: "describe" | "resolve" | "configure" }, _optional: Record<string, never> = {}) {
    if (!await deps.authorize({ workspaceId: request.workspaceId, principalId: request.principalId, sourceId: request.sourceId, operation })) throw new EmailSenderError({ code: "forbidden" });
    const definition = await deps.definitions.findById({ workspaceId: request.workspaceId, id: request.sourceId });
    if (!definition) throw new EmailSenderError({ code: "not_found" });
    if (definition.workspaceId !== request.workspaceId) throw new EmailSenderError({ code: "ownership" });
    return definition;
  }
  /** Describes an authorized source using the existing binding and capability-readiness ports. */
  async function describe({ request, definition }: { request: EmailSourceRequest; definition: FormDefinitionRecord }, _optional: Record<string, never> = {}) {
    const binding = await deps.readEmailBinding({ workspaceId: request.workspaceId, formId: definition.id });
    if (binding && binding.formId !== definition.id) throw new EmailSenderError({ code: "ownership" });
    const permittedRecipients = recipientFields({ definition }).map(field => ({ id: field.id, label: field.label }));
    const readiness = await deps.readiness({ workspaceId: request.workspaceId, principalId: request.principalId, sourceId: request.sourceId });
    const blockers = [...readiness.blockers];
    if (definition.status !== "active") blockers.push("form_disabled");
    if (permittedRecipients.length === 0) blockers.push("email_field_required");
    return { ...summary({ definition }), fields: describeFormEmailFields({ definition }), permittedRecipients,
      purpose: "transactional" as const, lane: "notification" as const, binding: binding ? bindingView({ binding }) : null,
      readiness: { ready: readiness.ready && blockers.length === 0, blockers } };
  }
  return {
    id: "forms", label: "Forms",
    async listSources(request, _options = {}) {
      if (!await deps.authorize({ workspaceId: request.workspaceId, principalId: request.principalId, operation: "list" })) return [];
      const definitions = await deps.definitions.list({ workspaceId: request.workspaceId });
      const sources: EmailSourceSummary[] = [];
      for (const definition of definitions) {
        if (definition.workspaceId !== request.workspaceId) continue;
        if (await deps.authorize({ workspaceId: request.workspaceId, principalId: request.principalId, sourceId: definition.id, operation: "configure" })) sources.push(summary({ definition }));
      }
      return sources;
    },
    async describeSource(request, _options = {}) {
      return describe({ request, definition: await definitionFor({ request, operation: "describe" }) });
    },
    async resolveEvent(request, _options = {}) {
      const definition = await definitionFor({ request, operation: "resolve" });
      const submission = await deps.submissions.findById({ workspaceId: request.workspaceId, id: request.eventId });
      if (!submission) throw new EmailSenderError({ code: "not_found" });
      if (submission.workspaceId !== request.workspaceId || submission.formDefinitionId !== definition.id) throw new EmailSenderError({ code: "ownership" });
      const values = resolveFormEmailValues({ definition, submission, site: await deps.site({ workspaceId: request.workspaceId }) });
      return { occurredAt: submission.submittedAt, values, recipients: recipientFields({ definition }).flatMap(field => {
        const address = values[formEmailFieldToken({ field })];
        return typeof address === "string" && isValidFormEmail({ value: address }) ? [{ id: field.id, address: { email: address } }] : [];
      }) };
    },
    async configureEmail(request, _options = {}) {
      const definition = await definitionFor({ request, operation: "configure" });
      const source = await describe({ request, definition });
      const { binding } = request;
      if (source.binding && source.binding.bindingId !== binding.bindingId) throw new EmailSenderError({ code: "configuration" });
      if (!isValidFormEmail({ value: binding.replyTo })) throw new EmailSenderError({ code: "configuration" });
      if (binding.enabled) {
        if (!source.permittedRecipients.some(choice => choice.id === binding.recipientId)) throw new EmailSenderError({ code: "configuration" });
        if (!source.readiness.ready) throw new EmailSenderError({ code: "not_ready" });
        const template = await deps.templates.describe({ workspaceId: request.workspaceId, principalId: request.principalId, templateId: binding.templateId });
        validateEmailSourceTemplate({ fields: source.fields, template });
      }
      const saved = await deps.writeEmailBinding({ workspaceId: request.workspaceId, principalId: request.principalId, binding: {
        kind: "email", bindingId: binding.bindingId, formId: definition.id, templateId: binding.templateId,
        submitterEmailFieldId: binding.recipientId, replyTo: binding.replyTo, enabled: binding.enabled,
      } });
      return bindingView({ binding: saved });
    },
  };
}
