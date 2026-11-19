/**
 * @file Deleting a term or a taxonomy = moving it to the Trash (T6, trash parallel plan §2, owner
 * decision 5). Same shape as `features/forms/delete-submission.ts`'s `deleteFormSubmission`: the
 * Trash itself is injected as `remove` (bound to `"term"`/`"taxonomy"` at the composition root),
 * so this file never imports `features/trash` (binding rule 2 — domains never import from trash).
 *
 * This REPLACES the route's use of `@jini-ai/cms/taxonomy`'s `deleteTerm`/`deleteTaxonomy` (a hard
 * delete, guarded by "has children" / "has assigned content"). Those two functions still exist and
 * are still exported from the package — `repo.sqlite.integration.test.ts` still exercises them
 * directly to prove the guarded-hard-delete behavior itself; these trash flows leave that guard
 * ladder intact, and a host route can choose the trash flow instead. An assigned term or taxonomy IS trashable: decision 5 removes
 * the "has assigned content" refusal entirely, so only `term`'s child-term blocker survives, as the
 * Trash's own generic `TERM_HAS_CHILDREN` (`registry.ts`'s `blocker`).
 */

/** The function a term's trash path receives to move it into the Trash — a structural type
 *  declared in this domain folder (binding rule 2), matching `features/trash/ports.ts`'s
 *  `RemoveEntity` result shape without importing it. WIDE (carries `"blocked"`): the `term`
 *  registry entry declares a blocker (`TERM_HAS_CHILDREN`), unlike every `RemoveEntity` binding
 *  before it in this codebase. */
export type RemoveTermFn = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}) => Promise<
  | { ok: true; version: number | null }
  | { ok: false; reason: "not-found" | "version-changed" }
  | { ok: false; reason: "blocked"; code: string; count: number }
>;

/** Same shape, NARROWED: the `taxonomy` registry entry declares no blocker, so this can never see
 *  `"blocked"` — mirrors `features/trash`'s `removeEntityWithoutBlocker`
 *  narrowing for `redirect`/`comment`/`form_submission`. */
export type RemoveTaxonomyFn = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }>;

/** The read `trashTerm` needs before it can call `remove` — `SqliteTermRepo.findForTrash`'s exact
 *  shape (`repo.sqlite.ts`), declared here rather than imported from there, so a future in-memory
 *  adapter can satisfy this without depending on the SQLite class. */
export interface TermTrashReadPort {
  findForTrash(id: string): Promise<{ id: string; name: string; taxonomyName: string; version: number } | null>;
}

/** `SqliteTaxonomyRepo.findForTrash`'s exact shape — see {@link TermTrashReadPort}'s doc. */
export interface TaxonomyTrashReadPort {
  findForTrash(id: string): Promise<{ id: string; name: string; version: number } | null>;
}

export type TrashTermOutcome =
  | { ok: true; version: number | null }
  | { ok: false; reason: "not-found" | "version-changed" }
  | { ok: false; reason: "blocked"; code: string; count: number };

export type TrashTaxonomyOutcome = { ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" };

/**
 * Moves a term to the Trash. A missing or already-trashed term (own marker OR its taxonomy's,
 * `findForTrash` already filters both — `hiddenWithParent`) reads as `not-found` — the caller
 * cannot delete what it cannot see, same precedent `deleteFormSubmission` established.
 *
 * The Trash row's display is `{title: term.name, subtitle: taxonomy.name}` — the exact columns
 * `registry.ts`'s `term` entry joins for the generic Trash, kept identical here (binding rule
 * "same permission and same Trash row").
 *
 * @complexity O(1): one read, one `remove` call.
 */
export async function trashTerm(
  required: { workspaceId: string; termId: string; actor: { principalId: string; pluginId?: string | null };
    termRepo: TermTrashReadPort; remove: RemoveTermFn; clock: { nowIso(): string } },
  _optional = {}
): Promise<TrashTermOutcome> {
  const term = await required.termRepo.findForTrash(required.termId);
  if (!term) return { ok: false, reason: "not-found" };

  return required.remove({
    workspaceId: required.workspaceId,
    id: term.id,
    display: { title: term.name, subtitle: term.taxonomyName },
    at: required.clock.nowIso(),
    expectedVersion: term.version,
    actor: required.actor,
  });
}

/**
 * Moves a taxonomy to the Trash. Trashing does not cascade a second write onto its member terms —
 * they read as trashed the instant their taxonomy does (`hiddenWithParent`, `not-trashed.ts`'s own
 * doc) — so this is exactly as thin as {@link trashTerm}.
 *
 * @complexity O(1): one read, one `remove` call.
 */
export async function trashTaxonomy(
  required: { workspaceId: string; taxonomyId: string; actor: { principalId: string; pluginId?: string | null };
    taxonomyRepo: TaxonomyTrashReadPort; remove: RemoveTaxonomyFn; clock: { nowIso(): string } },
  _optional = {}
): Promise<TrashTaxonomyOutcome> {
  const taxonomy = await required.taxonomyRepo.findForTrash(required.taxonomyId);
  if (!taxonomy) return { ok: false, reason: "not-found" };

  return required.remove({
    workspaceId: required.workspaceId,
    id: taxonomy.id,
    display: { title: taxonomy.name },
    at: required.clock.nowIso(),
    expectedVersion: taxonomy.version,
    actor: required.actor,
  });
}
