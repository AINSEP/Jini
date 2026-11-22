import type { AdminTaxonomyWithTerms, AdminTerm } from "../api/taxonomy-api.types.js";

/**
 * @file What `useTaxonomy` and `useTermDetailPanel` need from the outside world, as an interface
 * rather than a direct import of the host's API client.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on the host's assistant-chats port
 * (the canonical reference in the host workspace) and already applied to its redirects and
 * pages screens: this file declares, the host's taxonomy dependencies hook binds the real API
 * client, and nothing else in this hooks folder imports the host's API client for these four routes.
 *
 * Shared between exactly these two hooks — the top-level list screen and the per-term rename
 * form — the "genuinely matches" list/detail pairing named for this feature. `use-merge-term-
 * section.hooks.ts` (a self-contained plan/confirm/execute wizard), `use-new-taxonomy-form.hooks.ts`,
 * and `use-new-term-form.hooks.ts` (single-purpose create forms) each get their own narrow port
 * instead — none of their routes overlap with these four or with each other, and forcing them into
 * this port would be exactly the dishonest shared contract the host's page-editor port's own doc
 * comment warns against.
 *
 * `trashTerm`/`trashTaxonomy` (T8b, 2026-09-21) use the generic single-item Trash route
 * (`api.trash({ type: "term" | "taxonomy", id })`,
 * bound by the host's taxonomy dependencies hook), the same route every other admin delete button uses — see
 * this package's `widgets/ports.ts` `trashWidget` for the identical precedent. Object-argument shape (`{
 * id }`) rather than a bare string, matching this workspace's exported/boundary-function convention.
 */
export interface TaxonomyPort {
  listTaxonomies(): Promise<{ items: AdminTaxonomyWithTerms[] }>;
  trashTerm(target: { id: string }): Promise<{ ok: true; version: number | null }>;
  trashTaxonomy(target: { id: string }): Promise<{ ok: true; version: number | null }>;
  renameTerm(target: { termId: string; newName: string }): Promise<{ term: AdminTerm }>;
}
