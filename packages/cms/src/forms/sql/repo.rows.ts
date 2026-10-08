import { decodeFormFields, encodeFormFields } from "../fields-json.js";
import type { Insertable, Selectable } from "kysely";

import type { FormDefinitionTable, FormSubmissionTable } from "./tables.js";
import type {
  FormDefinitionRecord,
  FormDefinitionStatus,
  FormSubmissionRecord,
  NotifyConfig,
} from "../types.js";

/**
 * @file Row mapping for `form_definitions` / `form_submissions`, shared by every dialect: the columns
 * are the generated `ContentDatabase` types (snake_case, JSON as compact text). Neutral on purpose —
 * no repo, no driver.
 */

export type FormDefinitionRow = Selectable<FormDefinitionTable>;
export type FormSubmissionRow = Selectable<FormSubmissionTable>;

/** One `form_definitions` row as a {@link FormDefinitionRecord}. */
export function toDefinitionRecord(row: FormDefinitionRow, _optional: Record<string, never> = {}): FormDefinitionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    ...decodeFormFields({ json: row.fields_json }),
    notify: JSON.parse(row.notify_json) as NotifyConfig,
    status: row.status as FormDefinitionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/**
 * The `form_definitions` row an INSERT writes. `version` is included for `create`; `update()` strips
 * it (see {@link updatableDefinitionColumns}) because only the Trash's compare-and-set may move it.
 */
export function toDefinitionRow(record: FormDefinitionRecord, _optional: Record<string, never> = {}): Insertable<FormDefinitionTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    name: record.name,
    slug: record.slug,
    fields_json: encodeFormFields({ definition: record }),
    notify_json: JSON.stringify(record.notify),
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

/** The columns `update()` writes: everything but the key and `version`. */
export function updatableDefinitionColumns(row: ReturnType<typeof toDefinitionRow>, _optional: Record<string, never> = {}) {
  const { id: _id, workspace_id: _workspaceId, version: _version, ...rest } = row;
  return rest;
}

/** One `form_submissions` row as a {@link FormSubmissionRecord}. */
export function toSubmissionRecord(row: FormSubmissionRow, _optional: Record<string, never> = {}): FormSubmissionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    formDefinitionId: row.form_definition_id,
    data: JSON.parse(row.data_json) as Record<string, string | boolean>,
    // cms-forms <0.2.2 required a string (0.2.2 allows null). Since nullable migration 0006, an
    // expired IP has an empty display value until the host adopts the nullable package DTO.
    sourceIp: row.source_ip ?? "",
    submittedAt: row.submitted_at,
  };
}

/** The `form_submissions` row a submit writes (compact JSON data). */
export function toSubmissionRow(record: FormSubmissionRecord, _optional: Record<string, never> = {}): Insertable<FormSubmissionTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    form_definition_id: record.formDefinitionId,
    data_json: JSON.stringify(record.data),
    source_ip: record.sourceIp,
    submitted_at: record.submittedAt,
  };
}
