import type { UUID } from "@jini-ai/core/primitives";

// Keep domain vocabulary independent of activation manifests: a future loader should be able
// to replace registration without forcing domain code to import its configuration.
export type FieldType = "text" | "email" | "textarea" | "checkbox";

export type FormDefinitionStatus = "active" | "disabled";

export interface FieldDescriptor {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  maxLength?: number | null;

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
  data: Record<string, string | boolean>;
  sourceIp: string;
  submittedAt: string;
}

export interface FormSubmissionPage {
  items: FormSubmissionRecord[];
  nextCursor: string | null;
}
