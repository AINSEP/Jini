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
 * The enum is SPLIT rather than flat (2026-09-05): a kind is either INDEXABLE — it may carry
 * `queryable: true` and therefore may reach `mapFieldKindToCast` — or STORAGE-ONLY, stored
 * verbatim in `fieldsJson` and never indexed, sorted, or filtered on. The split is what keeps the
 * CAST table's exhaustiveness compiler-enforced without forcing a CAST target to be invented for a
 * kind that has none; see `index-provisioning.ts`'s `KIND_TO_CAST_LITERAL`.
 *
 * Architectural role:
 * `features/content-types` domain vocabulary. No dependencies.
 */

/**
 * CIC U-001-B1 — the closed, 5-entry INDEXABLE SCALAR set. Never extend ad hoc.
 *
 * Unchanged since the original enum: every value that has ever reached a `CAST` literal is still
 * here, in this order. Kept as its own constant so the "these five are the original, untouched
 * scalars" claim is expressible in code rather than only in a comment.
 */
export const CONTENT_TYPE_SCALAR_KINDS = ["text", "integer", "real", "boolean", "datetime"] as const;

/**
 * CIC U-001-B1 — kinds that MAY carry `queryable: true` and therefore MAY reach
 * `mapFieldKindToCast`. Every member MUST have an entry in `index-provisioning.ts`'s
 * `KIND_TO_CAST_LITERAL`; the compiler enforces this via `Record<IndexableFieldKind, string>`, so
 * adding a member here fails the build until a CAST literal is supplied for it.
 *
 * `relation` stores a foreign entity id and shares `text`'s storage class, so its CAST target is
 * the already-present literal `"TEXT"` — it adds a KEY to that table, never a new VALUE to the
 * DDL alphabet.
 */
export const INDEXABLE_FIELD_KINDS = [...CONTENT_TYPE_SCALAR_KINDS, "relation"] as const;

export type IndexableFieldKind = (typeof INDEXABLE_FIELD_KINDS)[number];

/**
 * Kinds stored verbatim inside `fieldsJson` and NEVER indexed, sorted, or filtered on. A
 * storage-only kind has no CAST target — it is not that one is hard to choose, it is that a JSON
 * document has no scalar storage class to cast to — so `write-service.ts` rejects
 * `queryable: true` on one before any index transition can be resolved.
 */
export const STORAGE_ONLY_FIELD_KINDS = ["json"] as const;

export type StorageOnlyFieldKind = (typeof STORAGE_ONLY_FIELD_KINDS)[number];

/**
 * CIC U-001-B1 — the closed field-kind enum. UNCHANGED NAME AND MEANING for every existing
 * consumer: it is still the complete, closed set of legal `kind` values, and
 * {@link isContentTypeFieldKind} is still the gate for it.
 *
 * Member order is load-bearing, not cosmetic: the five scalars must stay first and in their
 * original order because this array's `join("|")` is interpolated into an operator-facing error
 * message. The spread order below preserves that; the published agent-tool schema
 * (`agent-tools.ts`) also spreads this constant, so both widen in lockstep with no hand-copied
 * second list to drift.
 */
export const CONTENT_TYPE_FIELD_KINDS = [
  ...INDEXABLE_FIELD_KINDS,
  ...STORAGE_ONLY_FIELD_KINDS,
] as const;

export type ContentTypeFieldKind = (typeof CONTENT_TYPE_FIELD_KINDS)[number];

/**
 * Type guard for {@link ContentTypeFieldKind}. The single gate every kind value must pass before
 * it is trusted anywhere near DDL construction (`index-provisioning.ts`) or write validation.
 *
 * Note the division of labour with {@link isIndexableFieldKind}: passing THIS gate means the value
 * is a legal kind to DECLARE and STORE. It does NOT license a CAST — `mapFieldKindToCast` applies
 * the narrower gate, because "storable" and "indexable" are no longer the same set.
 *
 * @complexity O(1) — a fixed-size array membership test.
 * @overallScore 100
 */
export function isContentTypeFieldKind(value: unknown): value is ContentTypeFieldKind {
  return typeof value === "string" && (CONTENT_TYPE_FIELD_KINDS as readonly string[]).includes(value);
}

/**
 * Type guard for {@link IndexableFieldKind} — the gate `mapFieldKindToCast` applies instead of
 * {@link isContentTypeFieldKind}, and the gate `write-service.ts` applies to reject
 * `queryable: true` on a storage-only kind.
 *
 * For all five original scalars this predicate and {@link isContentTypeFieldKind} agree exactly,
 * which is what makes narrowing the CAST gate behavior-preserving for every input that could
 * exist before `relation`/`json` were introduced.
 *
 * @complexity O(1) — a fixed-size array membership test.
 * @overallScore 100
 */
export function isIndexableFieldKind(value: unknown): value is IndexableFieldKind {
  return typeof value === "string" && (INDEXABLE_FIELD_KINDS as readonly string[]).includes(value);
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
