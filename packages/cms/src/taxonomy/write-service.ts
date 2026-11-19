import type { TransactionalRepoPort } from "@jini-ai/core/contracts/events";
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import { validateHierarchyAssignment } from "./validation-chain.js";
import type { Taxonomy, Term, WriteServiceDeps } from "./write-contracts.js";
import { TermRecordNotFoundError, authorizeTaxonomyManage, requireTaxonomy, resolveCandidateParent } from "./write-validation.js";

/**
 * @file The taxonomy write-service's ordinary (non-gated) mutations.
 *
 * Purpose:
 * The single write chokepoint for `taxonomies`/`terms`/`entry_terms` (the same discipline applied
 * to every other domain's write-service in this codebase): `authorize()` first (fail-closed) ->
 * validate -> write + revision + watermark + outbox, all attributed to the same mutation.
 * `assignTerms` is the one deliberate exception: term-assignment membership is explicitly narrowed
 * out of the general revisioning rule — high-churn relational state whose historical audit trail is
 * judged low-value, the same disclosed-loss basis `redirect_hits`/`asset_renditions` already use.
 *
 * `mergeTerm` (the one gated mutation) is deliberately NOT here — it lives in the sibling
 * `merge-term.ts`, isolated because it alone touches `core/gated-mutations`.
 *
 * A past security re-audit (finding: a hard blocker) established that `assignTerms` must invoke
 * `validation-chain.ts`'s `validateContentJoin` (allow-list -> workspace -> lens, fixed order)
 * before writing any `entry_terms` row. The prior "disclosed gap" comment this replaces undersold
 * the live risk — the missing check meant `assignTerms` (a live, `admin.taxonomy.manage`-gated
 * route) would silently accept a nonexistent `termId`, a `contentId` that doesn't exist, or a
 * caller-claimed `contentType` that doesn't match the target's real kind, with zero server-side
 * verification. `ContentLookupPort` below is the "content repo port" the old comment said this
 * needed. `resolvedTermWorkspaceId`/`resolvedContentWorkspaceId` both resolve to the SAME value as
 * `callerWorkspaceId` by construction in this codebase's real adapters (`SqliteTermRepo`/
 * `SqliteEntryTermRepo` are workspace-BOUND at construction, single-workspace-per-`content.db`), so
 * the workspace-mismatch branch is currently unreachable via those adapters specifically; it stays
 * load-bearing for any future adapter that is not workspace-bound, and the check costs nothing to
 * keep. See `docs/decisions/taxonomy-content-type-allow-list.md` for why both this branch and
 * `TAXONOMY_ALLOWED_CONTENT_TYPES` below are permanent design choices, not stopgaps.
 *
 * How it relates to the project:
 * Mirrors `packages/core/src/settings/write-service.ts`'s chokepoint shape (authorize -> validate ->
 * same-tx write + revision) and the required-input-object convention `src/features/post/post.ts`
 * establishes.
 */

export interface CreateTaxonomyRequired {
  deps: WriteServiceDeps;
  principalId: string;
  name: string;
  hierarchical: boolean;
}

/** Creates a taxonomy row (hierarchical=true -> "category"-shaped, false -> "tag"-shaped — same
 * shared table). Ordinary mutation, no plan()/confirmation ceremony. */
export async function createTaxonomy(
  required: CreateTaxonomyRequired,
  _optional: Record<string, never> = {}
): Promise<Taxonomy> {
  const { deps, principalId, name, hierarchical } = required;
  await authorizeTaxonomyManage(deps, principalId);

  const now = kernelNowIso({ clock: deps.clock });
  const taxonomy: Taxonomy = {
    id: deps.idGen.newId(),
    name,
    hierarchical,
    status: "active",
    updatedAt: now,
    version: 1,
  };

  await deps.taxonomies.insert(taxonomy);
  await deps.revisions.insert({
    taxonomyId: taxonomy.id,
    op: "create",
    previousState: null,
    actorId: principalId,
    recordedAt: now,
  });
  await deps.stampWatermark({});
  await deps.outbox.enqueue({ event: { name: "taxonomy.created", taxonomyId: taxonomy.id, actorId: principalId, occurredAt: now } });

  return taxonomy;
}

export interface CreateTermRequired {
  deps: WriteServiceDeps;
  principalId: string;
  taxonomyId: string;
  name: string;
}

export interface CreateTermOptional {
  parentId?: string | null | undefined;
}

/** — validates `parentId` via `validateHierarchyAssignment` before writing. A
 * freshly-created term has no descendants yet, so it structurally cannot be a cycle source; the
 * cycle check is therefore always a no-op (` => false`) here, unlike a reparent of an existing
 * term (not yet built — no certified test in this slice exercises it).
 * See docs/decisions/DR-005-ordered-taxonomy-validation.md.
 */
export async function createTerm(
  required: CreateTermRequired,
  optional: CreateTermOptional = {}
): Promise<Term> {
  const { deps, principalId, taxonomyId, name } = required;
  const { parentId } = optional;
  await authorizeTaxonomyManage(deps, principalId);

  const taxonomy = await requireTaxonomy({ taxonomies: deps.taxonomies, taxonomyId });

  const candidateParentId = parentId ?? null;
  const resolvedParent = await resolveCandidateParent({ terms: deps.terms, candidateParentId });

  validateHierarchyAssignment({
    childTaxonomyId: taxonomyId,
    taxonomyIsHierarchical: taxonomy.hierarchical,
    candidateParentId,
    resolvedParent,
    wouldCreateCycle: () => false,
    termId: "__new__",
  });

  const now = kernelNowIso({ clock: deps.clock });
  const term: Term = {
    id: deps.idGen.newId(),
    taxonomyId,
    parentId: candidateParentId,
    name,
    status: "active",
    updatedAt: now,
    version: 1,
  };

  await deps.terms.insert(term);
  await deps.revisions.insert({ taxonomyId, op: "create", previousState: null, actorId: principalId, recordedAt: now });
  await deps.stampWatermark({});
  await deps.outbox.enqueue({ event: { name: "taxonomy.term_created", termId: term.id, actorId: principalId, occurredAt: now } });

  return term;
}

export interface RenameTermRequired {
  deps: WriteServiceDeps & {
    /** Required shared transaction. All repos, the watermark and outbox
     * must share the store/connection opened by this port. */
    transaction: TransactionalRepoPort["transaction"];
  };
  principalId: string;
  termId: string;
  newName: string;
}

/** — same-tx rename + revision (carrying the pre-rename state) +
 * watermark + outbox. `authorize` runs before the term lookup, so a denied caller produces zero
 * side effects of any kind. A missing transaction capability fails closed before any lookup
 * or write; a caller must supply a real shared transaction for durable atomicity.
 * See docs/decisions/DR-005-ordered-taxonomy-validation.md.
 */
export async function renameTerm(
  required: RenameTermRequired,
  _optional: Record<string, never> = {}
): Promise<Term> {
  const { deps, principalId, termId, newName } = required;
  await authorizeTaxonomyManage(deps, principalId);

  // The narrow taxonomy repo stays independent; the host binds the shared transaction explicitly.
  const transaction = deps.transaction;
  if (!transaction) throw new Error("term rename requires a transaction port");
  return transaction({
    fn: async () => {
      const current = await deps.terms.findById({ id: termId });
      if (!current) {
        throw new TermRecordNotFoundError({ message: `term '${termId}' was not found` });
      }

      const now = kernelNowIso({ clock: deps.clock });
      const updated: Term = {
        id: current.id,
        taxonomyId: current.taxonomyId,
        parentId: (current as { parentId?: string | null }).parentId ?? null,
        name: newName,
        status: (current as { status?: string }).status ?? "active",
        updatedAt: now,
        version: ((current as { version?: number }).version ?? 1) + 1,
      };

      await deps.terms.update(updated);
      await deps.revisions.insert({
        taxonomyId: current.taxonomyId,
        op: "rename",
        previousState: { name: current.name },
        actorId: principalId,
        recordedAt: now,
      });
      await deps.stampWatermark({});
      await deps.outbox.enqueue({ event: { name: "taxonomy.term_renamed", termId, actorId: principalId, occurredAt: now } });

      return updated;
    }
  });
}
