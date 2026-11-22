import type { Response } from "express";
import { ToolInputError } from "@jini-ai/core";
import { RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";

import {
  FormDefinitionNotFoundError,
  FormFieldValidationError,
  FormSlugConflictError,
  FormSubmissionNotFoundError,
  type HtmlFormDefinitionRecord as FormDefinitionRecord,
  type FormSubmissionRecord,
} from "../../forms/index.js";
import { ForbiddenError as CommandForbiddenError } from "../../core/index.js";

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

export function toAdminFormDefinitionDto(definition: FormDefinitionRecord): AdminFormDefinitionDto {
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

export function toAdminFormDefinitionResponse(definition: FormDefinitionRecord): { data: AdminFormDefinitionDto } {
  return { data: toAdminFormDefinitionDto(definition) };
}

export function toAdminFormDefinitionListResponse({ definitions }: { definitions: FormDefinitionRecord[] }, _optional = {}): { data: AdminFormDefinitionDto[] } {
  return { data: definitions.map(toAdminFormDefinitionDto) };
}

export function toAdminFormSubmissionDto(submission: FormSubmissionRecord): AdminFormSubmissionDto {
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

export function toAdminFormSubmissionResponse(submission: FormSubmissionRecord): { data: AdminFormSubmissionDto } {
  return { data: { ...toAdminFormSubmissionDto(submission), ...(submission.evidence ? { evidence: structuredClone(submission.evidence) } : {}) } };
}

export function toAdminFormSubmissionListResponse(page: {
  items: FormSubmissionRecord[];
  nextCursor: string | null;
}): { data: AdminFormSubmissionDto[]; nextCursor: string | null } {
  return { data: page.items.map(toAdminFormSubmissionDto), nextCursor: page.nextCursor };
}

/**
 * Shared error -> HTTP mapping for every admin `forms` route (errors.spec.md §2/§6). Returns
 * `true` once it has written a response (caller should stop); `false` for an unrecognized error
 * (caller falls through to its own generic 500).
 */
export function mapFormsWriteError({ err, res }: { err: unknown; res: Response }, _optional = {}): boolean {
  if (err instanceof ToolInputError) {
    res.status(400).json({ error: err.message, code: "VALIDATION_ERROR" });
    return true;
  }
  if (err instanceof RecordVersionConflictError) {
    res.status(409).json(versionConflictBody({ error: err }));
    return true;
  }
  if (err instanceof CommandForbiddenError) {
    res.status(403).json({
      error: err.message,
      code: "FORBIDDEN",
      details: { permission: err.permission, reason: err.reason },
    });
    return true;
  }
  if (err instanceof FormFieldValidationError) {
    res.status(400).json({
      error: err.message,
      code: "FORMS_FIELD_VALIDATION_ERROR",
      details: { fieldErrors: err.fieldErrors },
    });
    return true;
  }
  if (err instanceof FormSlugConflictError) {
    res.status(409).json({ error: err.message, code: "FORMS_SLUG_CONFLICT", details: { slug: err.slug } });
    return true;
  }
  if (err instanceof FormDefinitionNotFoundError) {
    res.status(404).json({ error: err.message, code: "FORMS_DEFINITION_NOT_FOUND" });
    return true;
  }
  if (err instanceof FormSubmissionNotFoundError) {
    res.status(404).json({ error: err.message, code: "FORMS_SUBMISSION_NOT_FOUND" });
    return true;
  }
  return false;
}
