import type { ProviderDomainVerification } from "./api/mail-status-api.types.js";
import type { MailFeedbackSetupReport } from "@jini-ai/core/contracts/site/platform-mail";
import type { MailCaptureClearAnswer } from "@jini-ai/core/contracts/mail";

/**
 * @file The wire shapes of the host admin's Email page client (the round-2 mail routes,
 * 2026-10-22). Each shape mirrors its server DTO; the server file is named on each group so a
 * drift is one grep away. Type-only: the host's client implements `EmailApi` with its own
 * transport.
 */

// --- providers (`platform/mail/mail-status.ts`) ---------------------------------------------

export type MailLane = "transactional" | "bulk";

/** One credential field a provider's setup form shows — declared by the provider, never by a vendor branch here. */
export interface MailProviderField {
  key: string;
  label: string;
  type: "secret" | "text" | "url" | "email";
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
  help?: string;
  helpUrl?: string;
}

export interface MailProviderConfiguration {
  pluginId?: string;
  id: string;
  label: string;
  origin: "core" | "plugin";
  hosted: boolean;
  lanes: readonly MailLane[];
  capabilities: { feedback: boolean; domainVerification: boolean };
  credential: { required: boolean; saved: boolean; label?: string; credentialId?: string; updatedAt?: string };
  selectable: boolean;
  refusal?: string;
  setup: { fields: readonly MailProviderField[]; helpUrl?: string };
}

export interface MailProviderConfigurationReport {
  setting: { transactional: string | null; bulk: string | null };
  providers: readonly MailProviderConfiguration[];
  refusals: readonly string[];
}

export interface MailProviderCredentialInput {
  token?: string;
  username?: string;
  baseUrl?: string;
}

// --- DNS (`features/domain-dns/mail-dns-status.ts`) -----------------------------------------

export type MailDnsRecordStatus = "Checking" | "Matches" | "Missing" | "Mismatch" | "Pending" | "Unknown" | "TimedOut";

export interface MailDnsRecordView {
  type: string;
  host: string;
  name: string;
  expected: string;
  observed: string[];
  status: MailDnsRecordStatus;
  purpose: "mail" | "other";
  priority?: number;
  note?: string;
}


export interface MailDnsStatus {
  state: "checked" | "no_sender" | "no_provider" | "verification_unavailable" | "requirements_unavailable" | "requirements_failed" | "check_failed";
  message?: string;
  senderDomain: string | null;
  providerId: string | null;
  providerVerification: ProviderDomainVerification | null;
  dns?: { overall: MailDnsRecordStatus; records: MailDnsRecordView[]; reason?: string; checkedAt: string };
}

// --- test send (`@jini-ai/platform/mail/test-send`) ----------------------------------------

interface TestCommon { to: string; from: string; driver: string; at: string }
export type MailTestSendResult =
  | (TestCommon & { outcome: "accepted"; providerMessageId: string })
  | (TestCommon & { outcome: "captured"; where: "capture" | "console"; providerMessageId: string })
  | (TestCommon & { outcome: "redirected"; redirectedTo: string; providerMessageId: string })
  | (TestCommon & { outcome: "failed" | "unknown"; errorCode: string; message: string; retryable: boolean });

// --- uses, activity, suppressions, feedback (`features/mail-status/*.ts`) -------------------

export type MailUseState = "ready" | "blocked" | "disabled" | "not_configured" | "unknown";

export interface MailUseRow {
  use: "sign_in" | "newsletter_confirmation" | "form_notifications" | "newsletter";
  label: string;
  mailLane: MailLane;
  state: MailUseState;
  reasons: string[];
  sender: string | null;
  formsConfigured?: number;
  evidence: { outcome: string; at: string } | null;
}

export interface MailActivityItem {
  id?: string;
  recipient: string;
  originalRecipient?: string;
  deliveryMode?: "redirect" | "capture";
  use: string;
  outcome: string;
  lane: MailLane;
  providerId: string;
  providerMessageId?: string | null;
  errorCode: string | null;
  message?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailActivityPage {
  access: "full" | "masked";
  items: MailActivityItem[];
  nextCursor: string | null;
  empty: "none_recorded" | "no_matches" | null;
}

export interface MailActivityDetail {
  activity: MailActivityItem;
  feedback: { kind: string; occurredAt: string; receivedAt: string }[];
}

export interface MailActivityFilter {
  outcome?: string | undefined;
  recipient?: string | undefined;
}

export type MailSuppressionScope = "all" | "bulk";

export interface MailSuppressionEntry {
  address: string;
  scope: MailSuppressionScope;
  reason: "bounced" | "complained" | "manual";
  createdAt: string;
  revision: string;
}

export interface MailSuppressionPage {
  items: MailSuppressionEntry[];
  nextCursor: string | null;
  empty: "none_recorded" | "no_matches" | null;
}

export interface MailSuppressionRemovalPlan {
  address: string;
  scope: MailSuppressionScope;
  reason: string;
  suppressionReason: MailSuppressionEntry["reason"];
  suppressedAt: string;
  revision: string;
  warnings: string[];
}

// --- templates (`@jini-ai/platform/mail/email-template-operations`) ------------------------

export interface EmailTemplateField {
  name: string;
  sample?: string;
}

export interface EmailTemplateSummary {
  id: string;
  name: string;
  subject: string;
  fields: EmailTemplateField[];
  version: number;
  updatedAt: string;
}

export interface EmailTemplateDetail extends EmailTemplateSummary {
  html: string;
  undeclaredFields: string[];
}

export interface EmailTemplatePreview {
  subject: string;
  html: string;
  missingFields: string[];
  undeclaredFields: string[];
  mode: "admin" | "sent";
  scriptsStripped: boolean;
  text?: string;
}

// --- the port ----------------------------------------------------------------------------

/** The Email page's API port: one object a test replaces wholesale. The host binds its HTTP client. */
export interface EmailApi {
  listProviders: () => Promise<MailProviderConfigurationReport>;
  saveProviderKey: (required: { providerId: string; input: MailProviderCredentialInput }) => Promise<{ provider: MailProviderConfiguration }>;
  activateProvider: (required: { providerId: string }) => Promise<{ set: true; providerId: string; label: string }>;
  readDns: () => Promise<MailDnsStatus>;
  verifyDns: () => Promise<MailDnsStatus>;
  sendTest: (required: { to?: string | undefined; requestId: string }) => Promise<{ sent: boolean; result: MailTestSendResult }>;
  readUses: () => Promise<{ checkedAt: string; uses: MailUseRow[] }>;
  listActivity: (required: { filter: MailActivityFilter; cursor?: string }) => Promise<MailActivityPage>;
  getActivity: (required: { id: string }) => Promise<MailActivityDetail>;
  listSuppressions: (required: { search?: string | undefined; cursor?: string }) => Promise<MailSuppressionPage>;
  /** Without `confirm` this only previews (`plan`); with it, `revision` must be the previewed one. */
  removeSuppression: (
    required: { address: string; scope: MailSuppressionScope; reason: string },
    options?: { confirm?: { revision: string } },
  ) => Promise<{ removed: boolean; confirmationRequired?: true; plan?: MailSuppressionRemovalPlan }>;
  /**
   * Clear every captured test email (owner only, `mail.capture.clear`). Without `confirm` it only
   * previews (`plan` + `revision`); with it, `revision` must be the previewed one. Optional so a host
   * that has no capture store simply never offers the action.
   */
  clearCaptured?: (options?: { confirm?: { revision: string } }) => Promise<MailCaptureClearAnswer>;
  readFeedback: () => Promise<MailFeedbackSetupReport>;
  listTemplates: () => Promise<{ templates: EmailTemplateSummary[]; nextCursor?: string }>;
  createTemplate: (required: { name: string }) => Promise<EmailTemplateDetail>;
  getTemplate: (required: { id: string }) => Promise<EmailTemplateDetail>;
  saveTemplateHtml: (required: { id: string; html: string; expectedVersion: number }) => Promise<EmailTemplateDetail>;
  renameTemplate: (required: { id: string; name: string; expectedVersion: number }) => Promise<EmailTemplateDetail>;
  previewTemplate: (required: { html: string; values: Record<string, string>; mode: "admin" | "sent" }) => Promise<EmailTemplatePreview>;
  /** Move through the scoped template registration; Trash owns marker, index and restore. */
  trashTemplate: (required: { id: string }, _options?: Record<string, never>) => Promise<{ ok: true }>;
  readSender: () => Promise<{ data: { key: string; value: unknown }[] }>;
  saveSender: (required: { key: "senderEmail" | "senderName"; value: string }) => Promise<unknown>;
}
