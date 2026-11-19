import type { FormAnswer, FormFieldDescriptor, FormFileReference, FormSubmissionEvidence } from "@jini-ai/core/contracts/forms";
import type { UUID } from "@jini-ai/core/primitives";

// Keep domain vocabulary independent of activation manifests: a future loader should be able
// to replace registration without forcing domain code to import its configuration.
export type FieldType = keyof typeof import("./field-registry.js").FIELD_TYPE_REGISTRY;

/**
 * Event emitted once per accepted, persisted submission; the notify and delivery subscribers both
 * listen on it. Domain behaviour owns its event contract here rather than reading a host manifest
 * back, which would invert dependency flow.
 */
export const FORM_SUBMISSION_RECEIVED_EVENT = "form.submission.received";

export type FormDefinitionStatus = "active" | "disabled";

/** The authored field shape, narrowed to the field types this domain registers. */
export type FieldDescriptor = FormFieldDescriptor<FieldType>;

export interface NotifyConfig {
  enabled: boolean;
  recipients: string[];
}

export interface FormDefinitionRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  slug: string;
  fields: FieldDescriptor[];
  notify: NotifyConfig;
  status: FormDefinitionStatus;
  createdAt: string;
  updatedAt: string;

  /** Compare-and-set counter for edits and trash transitions; never an admin-editable field.
   * Every record constructor, including fixtures, must supply it. */
  version: number;
}

export interface FormSubmissionRecord {
  id: UUID;
  workspaceId: UUID;
  formDefinitionId: UUID;
  data: Record<string, FormAnswer>;
  /** Captured schema/consent, absent for historical rows whose original context is unavailable. */
  evidence?: FormSubmissionEvidence<FieldType>;
  /** Import-time classification, persisted separately from visitor answers in the JSON envelope. */
  validation?: { status: "invalid"; fieldErrors: import("./forms.js").FieldError[] };
  /** Cleared by metadata retention; answers and the submission itself remain. */
  sourceIp: string | null;
  submittedAt: string;
}

export interface FormSubmissionPage {
  items: FormSubmissionRecord[];
  nextCursor: string | null;
}

/** Byte-bearing input exists only in memory at the submission boundary. Never stored as JSON. */
export interface FormFileInput { filename: string; contentType: string; bytes: Uint8Array; }
/** Hosts sniff bytes and persist accepted originals via their existing media/storage owner. */
export interface FormFileStoragePort {
  detectContentType(required: { bytes: Uint8Array }, optional?: Record<string, never>): string;
  store(required: { workspaceId: string; submissionId: string; fieldId: string; file: FormFileInput }, optional?: Record<string, never>): Promise<FormFileReference>;
  /** Compensates originals created by this attempt if the submission transaction fails. */
  discard(required: { workspaceId: string; reference: FormFileReference }, optional?: Record<string, never>): Promise<void>;
}

export interface SubmitFormInput {
  workspaceId: UUID;
  slug: string;
  body: Record<string, unknown>;
  sourceIp: string;
}

/** One form submission's outcome, carried from `routes/site/forms-submit.ts` (which constructs it
 *  from the real `submitForm`/error-class result) to `routes/site/pages.ts` (which decodes it back
 *  off `req.query`, merges in any flash-cookie `values` via {@link mergeFormFlashIntoResult}, and
 *  passes it to {@link injectFormSubmissionResultIntoHtml}) via a redirect Location's query string.
 *
 * `values` (2026-08-31 field-wipe fix) is deliberately NOT part of the query-string round trip
 * (`encodeFormSubmissionResultQuery`/`decodeFormSubmissionResultFromQuery` never read or write it) —
 * see {@link FormFlashPayload}'s own doc for why submitted field text travels via a cookie instead.
 * It only ever appears here as something `mergeFormFlashIntoResult` attaches after the query-string
 * decode already ran. */
export type FormSubmissionRedirectResult =
  | { kind: "success"; slug: string }
  | {
      kind: "validation";
      slug: string;
      fieldErrors: ReadonlyArray<{ field: string; reason: string }>;
      values?: Readonly<Record<string, string>>;
    }
  | { kind: "rate-limited"; slug: string; retryAfterSeconds: number }
  | { kind: "too-fast"; slug: string; values?: Readonly<Record<string, string>> }
  | { kind: "error"; slug: string };
