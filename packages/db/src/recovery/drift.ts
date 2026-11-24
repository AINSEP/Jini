/**
 * @file SPEC-017 C-102 / CIC U-002 / REQ-03 / AC-03 — drift classification between a site's
 * persisted schema snapshot and the runtime's current schema.
 *
 * Purpose:
 * Compares `.site-meta.json {schemaVersion, schemaTag}` against `__drizzle_migrations`'s current
 * tag (ADR-041 §3). Feeds the Timeline's drift banner and the preflight gate that refuses
 * forward-migrate when the site has diverged onto a different migration lineage.
 *
 * How it relates to the project:
 * Pure classification only — no I/O. Callers (the migrate-forward plan step, boot-time
 * SERVE_SITE policy) read the two `SchemaSnapshot`s from their own adapters and pass them in.
 *
 * Architectural role:
 * RELOCATED FROM `features/database/drift.ts` (2026-08-17, architecture SCC cut — see the
 * database-cycle-investigation report). `db/sqlite/database-introspection-adapter.sqlite.ts` was
 * the only VALUE importer of this file outside `features/database` itself, and that one edge
 * (`db -> features/database`) was what closed a cycle once `features/database` got its own
 * `registerToolContributor` edge back into `assistant` (see `features/database/tool-registrations.ts`'s
 * `contributeDatabaseTools()`). Moving this pure, dependency-free module into `db/` — where its one
 * real value-importing caller already lives — removes that edge entirely rather than narrowing it.
 * `features/database/adapter.sqlite.ts` (the port-owning file) still imports `DriftStatus`/
 * `SchemaSnapshot` from here, but only as `import type`, which is erased from the runtime-only graph
 * `check:architecture` gates on. Depends on nothing outside this module.
 *
 * Moved again (w4-db lane): out of the host's `platform/db/drift.ts` into `@jini-ai/db/recovery/drift`,
 * beside the recovery modules that consume the classification. Still pure and dependency-free.
 */

/** A schema's version index plus its migration-lineage tag (ADR-015 §5/RT-005). */
export interface SchemaSnapshot {
  version: number;
  tag: string;
}

export type DriftStatus = "in-sync" | "ahead" | "diverged" | "behind";

/**
 * Classifies drift between a site's persisted schema snapshot and the runtime's current schema.
 *
 * CIC U-002-B1/ORD1 (binding): tag-identity comparison is evaluated first and is unconditionally
 * decisive — a tag mismatch is always `"diverged"`, regardless of the version-index relationship.
 * Version-index comparison is used only to disambiguate `"ahead"` vs `"behind"` once the tags
 * already match. This ordering exists because a naive version-index-first shortcut would
 * misclassify an equal-index, different-lineage pair as `"in-sync"`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function getDriftStatus(required: { siteMeta: SchemaSnapshot; runtime: SchemaSnapshot }, _optional: Record<string, never> = {}): DriftStatus {
  const { siteMeta, runtime } = required;

  if (siteMeta.tag !== runtime.tag) {
    return "diverged";
  }
  if (siteMeta.version === runtime.version) {
    return "in-sync";
  }
  return siteMeta.version > runtime.version ? "ahead" : "behind";
}
