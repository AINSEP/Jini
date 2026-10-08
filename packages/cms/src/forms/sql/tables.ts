import type { Generated } from "kysely";

/** Names belong to the host; both repositories borrow their narrow view of its kernel. */
export interface FormsTables { definitions: string; submissions: string; }

export interface FormDefinitionTable {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  fields_json: string;
  notify_json: string;
  status: Generated<string>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: Generated<number>;
}

export interface FormSubmissionTable {
  id: string;
  workspace_id: string;
  form_definition_id: string;
  data_json: string;
  source_ip: string | null;
  submitted_at: string;
  deleted_at: string | null;
  version: Generated<number>;
}

export type FormDefinitionDatabase = Record<string, FormDefinitionTable>;
export type FormSubmissionDatabase = Record<string, FormSubmissionTable>;
