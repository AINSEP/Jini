/**
 * MOVE: Event data and recipient authority belong to the originating feature, independently of
 * delivery providers. Hosts bind authorization, templates and persistence; this surface sends nothing.
 */
import type { EmailAddress, MailerSendOptions } from "./types.js";

/** Explicit caller scope, including for background jobs running as a host service principal. */
export interface EmailSenderContext { readonly workspaceId: string; readonly principalId: string; }
/** A concrete event source; the same event name may occur for several sources or senders. */
export interface EmailSourceRef { readonly senderId: string; readonly sourceId: string; }
export interface EmailSourceSummary extends EmailSourceRef { readonly label: string; readonly eventName: string; }
/** Token is the exact placeholder name, without braces. Labels are presentation only. */
export interface EmailSourceField { readonly token: string; readonly label: string; readonly required: boolean; }
/** Recipient ids are source-owned choices, never caller-supplied addresses or expressions. */
export interface EmailRecipientChoice { readonly id: string; readonly label: string; }
export interface EmailReadiness { readonly ready: boolean; readonly blockers: readonly string[]; }
/** Persisted by the sender's existing write owner, never by a template-side relationship. */
export interface EmailBindingInput {
  readonly bindingId: string;
  readonly enabled: boolean;
  readonly templateId: string;
  readonly recipientId: string;
  readonly replyTo: string;
}
export interface EmailBinding extends EmailBindingInput { readonly activatedAt: string | null; }
export interface EmailSourceDescription extends EmailSourceSummary {
  readonly fields: readonly EmailSourceField[];
  readonly permittedRecipients: readonly EmailRecipientChoice[];
  readonly purpose: NonNullable<MailerSendOptions["purpose"]>;
  readonly lane: NonNullable<MailerSendOptions["lane"]>;
  readonly binding: EmailBinding | null;
  readonly readiness: EmailReadiness;
}
/** Only allowlisted event values and recipients cross this boundary; no stored event row. */
export interface ResolvedEmailEvent {
  /** Authoritative ISO event time, compared with the binding's latest activation to prevent backfill. */
  readonly occurredAt: string;
  readonly values: Readonly<Record<string, string>>;
  readonly recipients: readonly { readonly id: string; readonly address: EmailAddress }[];
}
export type EmailSourceRequest = EmailSenderContext & { readonly sourceId: string };
/** Every operation must authorize its own scope. Resolution also verifies event/source ownership.
 * No example-listing API: hosts may offer an authorized latest submission or a labeled sample. */
export interface EmailSender {
  readonly id: string;
  readonly label: string;
  listSources(required: EmailSenderContext, optional?: Record<string, never>): Promise<readonly EmailSourceSummary[]>;
  describeSource(required: EmailSourceRequest, optional?: Record<string, never>): Promise<EmailSourceDescription>;
  resolveEvent(required: EmailSourceRequest & { readonly eventId: string }, optional?: Record<string, never>): Promise<ResolvedEmailEvent>;
  configureEmail(required: EmailSourceRequest & { readonly binding: EmailBindingInput }, optional?: Record<string, never>): Promise<EmailBinding>;
}
/** Describe must report all placeholders, including those absent from the template declarations.
 * Render must use send-safe rendering, supplied values only, and refuse a changed version. */
export interface EmailTemplatePort {
  describe(required: EmailSenderContext & { readonly templateId: string }, optional?: Record<string, never>): Promise<{
    readonly version: string; readonly fields: readonly string[]; readonly placeholders: readonly string[];
  }>;
  render(required: EmailSenderContext & {
    readonly templateId: string; readonly version: string; readonly values: Readonly<Record<string, string>>;
  }, optional?: Record<string, never>): Promise<{
    readonly subject: string; readonly html: string; readonly text: string; readonly missingFields: readonly string[];
  }>;
}
/** Caller-safe failures never include event values, recipients or credentials. */
export class EmailSenderError extends Error {
  readonly code: "forbidden" | "not_found" | "ownership" | "configuration" | "not_ready" | "incompatible" | "missing_value";
  constructor(required: { readonly code: EmailSenderError["code"] }, _optional: Record<string, never> = {}) {
    super(`Email sender: ${required.code}`);
    this.code = required.code;
    this.name = "EmailSenderError";
  }
}
