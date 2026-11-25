import { toBool } from "@jini-ai/core/contracts/storage";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Generated, Insertable, Kysely, Selectable } from "kysely";
import type { Taxonomy, TaxonomyRevisionRow, Term } from "../write-contracts.js";

/**
 * @file Row types and mapping for the host's taxonomy tables, shared by every dialect: the columns are
 * stored snake_case, JSON as text, booleans as 0/1 integers. Neutral on purpose: no repo, no driver.
 * The column sets are copied from the host's generated schema in the same key order; the host's own
 * type-level pin fails if a later copy drifts from it. The table NAMES are host-owned ({@link TaxonomyTables}).
 */

export interface TaxonomyRow {
  id: string;
  workspace_id: string;
  name: string;
  hierarchical: number;
  status: string;
  updated_at: string;
  version: number;
}

export interface TermRow {
  id: string;
  workspace_id: string;
  taxonomy_id: string;
  parent_id: string | null;
  name: string;
  status: string;
  updated_at: string;
  version: number;
}

export interface EntryTermRow {
  id: Generated<number>;
  workspace_id: string;
  content_type: string;
  content_id: string;
  term_id: string;
  added_at: string;
}

export interface TaxonomyRevisionTableRow {
  seq: Generated<number>;
  workspace_id: string;
  taxonomy_id: string;
  op: string;
  previous_state_json: string | null;
  actor_id: string;
  recorded_at: string;
  actor_kind: string | null;
}

/**
 * Host-owned table names. No schema or product table defaults live in the adapter. Type aliases of
 * `Record<string, Row>`, not interfaces: Kysely's `withTables` needs the implicit index signature.
 */
export interface TaxonomyTables { taxonomies: string; terms: string; entryTerms: string; taxonomyRevisions: string }
export type TaxonomyTableViews = Record<string, TaxonomyRow>;
export type TermTableViews = Record<string, TermRow>;
export type EntryTermTableViews = Record<string, EntryTermRow>;
export type RevisionTableViews = Record<string, TaxonomyRevisionTableRow>;
/**
 * The view of the three tables a liveness check joins or correlates (a term, its taxonomy, and an
 * assignment of the term). Every name resolves to the union of their columns, which is exact here:
 * the columns they share (`id`, `workspace_id`, `name`, `status`, `taxonomy_id`) have one type each.
 * `entry_terms.id` is omitted (a generated number that would clash with the text ids).
 */
export type LiveJoinTableViews = Record<string, TaxonomyRow & TermRow & Omit<EntryTermRow, "id">>;

/** Constructor requirement shared by every class here: the kernel, the table names, and the workspace they are scoped to. */
export interface TaxonomySqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: TaxonomyTables;
  workspaceId: string;
}

/** One `taxonomies` row as a {@link Taxonomy}. */
export function toTaxonomy(row: Selectable<TaxonomyRow>): Taxonomy {
  return {
    id: row.id,
    name: row.name,
    hierarchical: toBool({ value: row.hierarchical }) === true,
    status: row.status,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/** The `taxonomies` row one insert writes for `workspaceId`. */
export function toTaxonomyRow({ workspaceId, row }: { workspaceId: string; row: Taxonomy }, _optional: Record<string, never> = {}): Insertable<TaxonomyRow> {
  return {
    id: row.id,
    workspace_id: workspaceId,
    name: row.name,
    hierarchical: row.hierarchical ? 1 : 0,
    status: row.status,
    updated_at: row.updatedAt,
    version: row.version,
  };
}

/** One `terms` row as a {@link Term}. */
export function toTerm(row: Selectable<TermRow>): Term {
  return {
    id: row.id,
    taxonomyId: row.taxonomy_id,
    parentId: row.parent_id,
    name: row.name,
    status: row.status,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/** The `terms` row one insert writes for `workspaceId`. */
export function toTermRow({ workspaceId, row }: { workspaceId: string; row: Term }, _optional: Record<string, never> = {}): Insertable<TermRow> {
  return {
    id: row.id,
    workspace_id: workspaceId,
    taxonomy_id: row.taxonomyId,
    parent_id: row.parentId,
    name: row.name,
    status: row.status,
    updated_at: row.updatedAt,
    version: row.version,
  };
}

/** The `taxonomy_revisions` row an append writes (compact JSON state; `seq` is database-assigned). */
export function toTaxonomyRevisionRow(
  { workspaceId, row }: { workspaceId: string; row: TaxonomyRevisionRow },
  _optional: Record<string, never> = {},
): Insertable<TaxonomyRevisionTableRow> {
  return {
    workspace_id: workspaceId,
    taxonomy_id: row.taxonomyId,
    op: row.op,
    previous_state_json: row.previousState == null ? null : JSON.stringify(row.previousState),
    actor_id: row.actorId,
    recorded_at: row.recordedAt,
    // Omitted without a typed kind: the column stays NULL (unknown) and an older host schema keeps working.
    ...(row.actorKind ? { actor_kind: row.actorKind } : {}),
  };
}
