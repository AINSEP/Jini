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

export interface FieldDescriptor {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Optional HTML name; must equal the stable id so historic submission keys remain valid. */
  name?: string;
  placeholder?: string;
  helpText?: string;
  default?: string | number | boolean | string[];
  options?: Array<{ value: string; label: string }>;
  minLength?: number;
  maxLength?: number | null;
  /** Full-match, bounded safe regular expression; groups/alternation/backreferences are refused. */
  pattern?: string;
  min?: number | string;
  max?: number | string;
  step?: number;
  /** Omitted accept means every recognized safe type, never executable/markup/archive formats. */
  accept?: string[];
  maxFileSize?: number;
  /** Presence distinguishes an authored checkbox value (even "") from the native boolean default. */
  checkboxValue?: string;

  /** Length-bounded and HTML-escaped at rendering; class names are inert after escaping. */
  className?: string;

  /** Attribute names require a closed allowlist: escaping a name cannot make it safe.
   * Values remain plain strings and must be HTML-escaped by the renderer. */
  attributes?: Record<string, string>;
}

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

  /** Compare-and-set counter for trash transitions; never an admin-editable field.
   * Every record constructor, including fixtures, must supply it. */
  version: number;
}

export interface FormSubmissionRecord {
  id: UUID;
  workspaceId: UUID;
  formDefinitionId: UUID;
  data: Record<string, FormAnswer>;
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
export interface FormFileReference { mediaId: string; filename: string; contentType: string; byteSize: number; }
export type FormAnswer = string | boolean | number | string[] | FormFileReference;
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
