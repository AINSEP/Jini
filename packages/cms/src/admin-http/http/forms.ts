import type {
  HtmlFormDefinitionRecord as FormDefinitionRecord,
  FormSubmissionRecord,
} from "../../forms/index.js";

/**
 * @file Response DTOs for the admin `forms` HTTP surface (SPEC-010 api.spec.md §5).
 *
 * Purpose:
 * Serializes `forms` library read models into the exact `{ data: ... }` envelopes api.spec.md §5
 * defines (Forms' contract shape, unlike `menus`/`integrations`' `{ menu: ... }`-style envelopes —
 * Article VII: the spec is ground truth here, not this codebase's older per-section convention).
 */

/** The domain owns the field contract, including choices/defaults/upload constraints. */
export type AdminFormFieldDto = FormDefinitionRecord["fields"][number];

export interface AdminFormNotifyDto {
  enabled: boolean;
  recipients: string[];
}

export interface AdminFormDefinitionDto {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  fields: AdminFormFieldDto[];
  provider?: FormDefinitionRecord["provider"];
  mode?: "builder" | "html";
  html?: string | undefined;
  notify: AdminFormNotifyDto;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AdminFormSubmissionDto {
  evidence?: FormSubmissionRecord["evidence"];
  schemaHash?: string;
  notificationDelivery?: { failed: number; pending: number };
  validation?: FormSubmissionRecord["validation"];
  id: string;
  formDefinitionId: string;
  workspaceId: string;
  data: FormSubmissionRecord["data"];
  sourceIp: string;
  submittedAt: string;
}

export function toAdminFormDefinitionDto({ definition }: { definition: FormDefinitionRecord }, _optional = {}): AdminFormDefinitionDto {
  return {
    id: definition.id,
    workspaceId: definition.workspaceId,
    name: definition.name,
    slug: definition.slug,
    fields: definition.fields.map((f) => ({ ...f })),
    ...(definition.provider ? { provider: definition.provider } : {}),
    mode: (definition as { mode?: "builder" | "html" }).mode ?? "builder",
    html: (definition as { html?: string }).html,
    notify: { enabled: definition.notify.enabled, recipients: [...definition.notify.recipients] },
    status: definition.status,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    version: definition.version,
  };
}

export function toAdminFormDefinitionResponse({ definition }: { definition: FormDefinitionRecord }, _optional = {}): { data: AdminFormDefinitionDto } {
  return { data: toAdminFormDefinitionDto({ definition }) };
}

export function toAdminFormDefinitionListResponse({ definitions }: { definitions: FormDefinitionRecord[] }, _optional = {}): { data: AdminFormDefinitionDto[] } {
  return { data: definitions.map((definition) => toAdminFormDefinitionDto({ definition })) };
}

export function toAdminFormSubmissionDto({ submission }: { submission: FormSubmissionRecord }, _optional = {}): AdminFormSubmissionDto {
  return {
    id: submission.id,
    formDefinitionId: submission.formDefinitionId,
    workspaceId: submission.workspaceId,
    data: { ...submission.data },
    ...(submission.evidence ? { schemaHash: submission.evidence.schemaHash } : {}),
    ...(submission.validation ? { validation: submission.validation } : {}),
    // cms-forms 0.2.2 types an expired IP as null; the wire DTO keeps repo.rows.ts's empty string.
    sourceIp: submission.sourceIp ?? "",
    submittedAt: submission.submittedAt,
  };
}

export function toAdminFormSubmissionResponse({ submission }: { submission: FormSubmissionRecord }, _optional = {}): { data: AdminFormSubmissionDto } {
  return { data: { ...toAdminFormSubmissionDto({ submission }), ...(submission.evidence ? { evidence: structuredClone(submission.evidence) } : {}) } };
}

export function toAdminFormSubmissionListResponse({ items, nextCursor }: {
  items: FormSubmissionRecord[];
  nextCursor: string | null;
}, _optional = {}): { data: AdminFormSubmissionDto[]; nextCursor: string | null } {
  return { data: items.map((submission) => toAdminFormSubmissionDto({ submission })), nextCursor };
}
