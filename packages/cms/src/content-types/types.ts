/**
 * @file Shared vocabulary for the `content-types` package.
 *
 * Purpose:
 * The closed field-kind enum, the content-type record shape, and the generic `Result<T,E>`
 * envelope every write-service/lifecycle/cleanup export in this package returns. Kept as plain
 * data types with no I/O so every other module in this package (and `features/entries`, which
 * consumes a content type's `fields` to validate an entry's `fieldsJson`) can depend on it
 * without pulling in any adapter.
 *
 * How it relates to the project:
 * The expression-index query surface requires the field-kind enum to be closed and
 * mapped through a fixed lookup table (`index-provisioning.ts`), never interpolated — this file
 * is that enum's single source of truth so the write-service's validation and the index
 * provisioner's CAST-mapping can never drift apart.
 *
 * Architectural role:
 * `features/content-types` domain vocabulary. No dependencies.
 */

/** CIC U-001-B1 — the closed, 5-entry field-kind enum. Never extend ad hoc. */
export const CONTENT_TYPE_FIELD_KINDS = ["text", "integer", "real", "boolean", "datetime"] as const;

export type ContentTypeFieldKind = (typeof CONTENT_TYPE_FIELD_KINDS)[number];

/**
 * Type guard for {@link ContentTypeFieldKind}. The single gate every kind value must pass before
 * it is trusted anywhere near DDL construction (`index-provisioning.ts`) or write validation.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function isContentTypeFieldKind(value: unknown): value is ContentTypeFieldKind {
  return typeof value === "string" && (CONTENT_TYPE_FIELD_KINDS as readonly string[]).includes(value);
}

export interface ContentTypeFieldDef {
  name: string;
  kind: ContentTypeFieldKind;
  required: boolean;
  queryable: boolean;
}

export type ContentTypeStatus = "active" | "deprecated" | "tombstone";

/** Sample schema, expressed as the package's in-memory record shape (repo-agnostic). */
export interface ContentTypeRecord {
  workspaceId: string;
  key: string;
  label: string;
  fields: ContentTypeFieldDef[];
  status: ContentTypeStatus;
  version: number;
  tombstonedAt?: string | null;
}

/**
 * Actor classes a chokepoint write can be attributed to. Structurally identical to
 * `identity.PrincipalKind`, deliberately redeclared here rather than imported so this package
 * stays dependency-free (the same "no shared import, kept decoupled" convention `write-service.ts`
 * applies to `AuthorizeFn`). `identity.PrincipalRecord.kind` assigns to it directly.
 */
export type ActorPrincipalKind = "user" | "agent" | "api_key" | "system";

/** The actor-identity envelope every chokepoint write in this package accepts (REQ-01/02/16). */
export interface ActorIdentityInput {
  actorId: string;
  /**
   * Provenance for the audit trail: WHICH CLASS of actor performed this write. `actorId` alone
   * cannot answer "was this the human admin, or the AI assistant acting for them?" — the assistant
   * typically runs under that same human's principal id (a host's assistant proxy stamps it into
   * the run's `contextRef`), so both paths record an identical `actorId`. Recorded onto
   * the revision row by the write chokepoint; optional so pre-existing call sites are unaffected
   * (they persist `NULL`, honestly meaning "not recorded" rather than a fabricated default).
   */
  principalKind?: ActorPrincipalKind;
  delegatedByWorkspaceId?: string | null;
  delegatedById?: string | null;
}

/** Generic success/failure envelope used across this package instead of throwing for expected rejections. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
