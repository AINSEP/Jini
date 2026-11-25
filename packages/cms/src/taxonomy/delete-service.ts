import type { MutationActor, TransactionalRepoPort } from "@jini-ai/core/contracts/events";
import { checkedMutationActor } from "../core/mutation-actor.js";
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
// Type-only — `list.ts` imports `Taxonomy`/`Term` back from this file, so a value-level import
// here would be circular. `DeleteTaxonomyRequired.deps.terms` needs `TermListPort.listByTaxonomy`
// to enumerate a taxonomy's member terms for the cascade guard below; erased at compile time, so
// the type-only direction never round-trips at runtime.
import type { TermListPort } from "./list.js";

import type { WriteServiceDeps } from "./write-contracts.js";
import { TaxonomyRecordNotFoundError, TermRecordNotFoundError, authorizeTaxonomyManage } from "./write-validation.js";

/**
 * Additive capabilities beyond the certified `TaxonomyRepoPort`/`TermRepoPort`/`EntryTermRepoPort`
 * — same beyond-the-certified-port precedent `MergeableEntryTermRepoPort` established in this
 * package's consuming host (`gated-hooks.ts`'s `buildMergeTermHooks`) for `mergeTerm`, applied
 * here for the ordinary (non-gated) `deleteTerm`/`deleteTaxonomy` mutations below. Implemented on
 * both `InMemory*Repo` (`repo.memory.ts`) and a host's own SQLite adapters (this package ships no
 * SQLite adapter of its own — see this file's header and `repo.memory.ts`'s header for why).
 */
export interface DeletableTaxonomyRepoPort {
  delete({ id }: { id: string }): Promise<void>;
}

export interface DeletableTermRepoPort {
  delete({ id }: { id: string }): Promise<void>;
  /** Direct-child count for `termId` as a parent. `deleteTerm` refuses to delete a term with
   * children still pointing `parentId` at it — that reference would otherwise dangle the moment
   * the parent row is gone, corrupting the hierarchy `validateHierarchyAssignment` polices on the
   * write side. This dispatch's own finding, not a named requirement — no cascading delete of
   * children is attempted; the caller must clear them first (bottom-up), same as the
   * content-assignment guard below forces "unassign first." */
  countChildren(params: { parentId: string }): Promise<number>;
}

export interface AssignmentCountEntryTermRepoPort {
  /** Count of `entry_terms` rows currently pointing at `termId` — the guard `deleteTerm` (and, by
   * summing across a taxonomy's member terms, `deleteTaxonomy`) uses to refuse destroying an
   * assignment live content still depends on. Deliberately the opposite direction from
   * `onContentDeleted` above: that subscriber cleans up `entry_terms` when CONTENT goes away
   * (content is the thing being removed, so orphaned assignment rows are safe to sweep silently);
   * here the TAXONOMY/TERM is what would be removed while the content stays live, so a silent
   * sweep would delete a real, still-visible link out from under an unrelated content item —
   * refusing the delete instead is the correct direction. */
  countByTerm(params: { termId: string }): Promise<number>;
}

/** `deleteTerm`/`deleteTaxonomy` refuse rather than silently orphan when content is still
 * assigned. Carries `assignedCount` so a caller (route/UI) can render "N items are still
 * assigned" instead of a generic failure. */
export class TermHasAssignedContentError extends Error {
  public readonly assignedCount: number;
  constructor(requiredArgs: { message: string; assignedCount: number }, _optionalArgs: Record<string, never> = {}) {
    const { message, assignedCount } = requiredArgs;
    super(message);
    this.assignedCount = assignedCount;
    this.name = "TermHasAssignedContentError";
  }
}

/** See `DeletableTermRepoPort.countChildren`'s doc comment for why this guard exists. Carries
 * `childCount` for the same reason `TermHasAssignedContentError` carries `assignedCount`. */
export class TermHasChildTermsError extends Error {
  public readonly childCount: number;
  constructor(requiredArgs: { message: string; childCount: number }, _optionalArgs: Record<string, never> = {}) {
    const { message, childCount } = requiredArgs;
    super(message);
    this.childCount = childCount;
    this.name = "TermHasChildTermsError";
  }
}

/** `deleteTaxonomy`'s content-assignment guard — `assignedCount` is the sum across every member
 * term, not a single term's count. */
export class TaxonomyHasAssignedContentError extends Error {
  public readonly assignedCount: number;
  constructor(requiredArgs: { message: string; assignedCount: number }, _optionalArgs: Record<string, never> = {}) {
    const { message, assignedCount } = requiredArgs;
    super(message);
    this.assignedCount = assignedCount;
    this.name = "TaxonomyHasAssignedContentError";
  }
}


export interface DeleteTermRequired {
  deps: WriteServiceDeps & {
    terms: DeletableTermRepoPort;
    entryTerms: AssignmentCountEntryTermRepoPort;
    /** See `TransactionalRepoPort`'s doc comment. Any one repo's `.transaction()` method is a
     * valid source — the route/composition-root wiring picks one (this package stays agnostic to
     * which); every write inside `fn` must land on the SAME underlying connection that opened it,
     * which is a wiring obligation the caller owns, not something this function can verify. */
    transaction: TransactionalRepoPort["transaction"];
  };
  principalId: string;
  /** Trusted attribution from the caller's execution channel (admin route `user`, assistant tool
   *  `agent`, publish/background `system`); its `id` must be `principalId`. Optional for now: omitted, the event records no actor. */
  actor?: MutationActor | undefined;
  termId: string;
}

/**
 * Deletes a single term. Refuses (never cascades) when the term still has children or is still
 * assigned to content — both checks run, and either alone is enough to block, before any write.
 * An unassigned, childless term is destroying nothing recoverable, so this is a direct delete with
 * no plan()/confirmation ceremony (`mergeTerm` earns that ceremony because it migrates data this
 * does not).
 *
 * `authorize()` runs before the transaction opens (a pure permission check, no side effect, so it
 * doesn't need transactional protection); everything from the existence check onward — both
 * guards and the delete itself — runs inside `deps.transaction()` (see that port's doc comment for
 * why). Does NOT cascade-delete the term's `taxonomy_revisions` rows: that table is an append-only
 * audit trail (mirrors `redirect_hits`/`asset_renditions`'s disclosed audit-not-referential-
 * integrity precedent), and erasing a term's history the moment the term itself is deleted would
 * destroy the very "this term existed and was deleted" record this call's own revision insert
 * below creates. Confirmed by grepping `db/schema.ts`: no other table has a `taxonomyId`/`termId`
 * column, so `taxonomy_revisions` is the only thing this decision applies to.
 *
 * @complexity O(1) — one `countChildren` call, one `countByTerm` call, one delete, all inside one
 * transaction.
 * @overallScore 100
 */
export async function deleteTerm(
  required: DeleteTermRequired,
  _optional: Record<string, never> = {}
): Promise<{ deletedTermId: string }> {
  const { deps, principalId, termId } = required;
  // The execution channel supplies attribution, the principal ID still governs authorization, and
  // the two are not interchangeable: refuse an actor naming someone else before any write.
  const actor = checkedMutationActor({ principalId, actor: required.actor });
  await authorizeTaxonomyManage(deps, principalId);

  return deps.transaction({
    fn: async () => {
      const current = await deps.terms.findById({ id: termId });
      if (!current) {
        throw new TermRecordNotFoundError({ message: `term '${termId}' was not found` });
      }

      const childCount = await deps.terms.countChildren({ parentId: termId });
      if (childCount > 0) {
        throw new TermHasChildTermsError({ message: `term '${termId}' has ${childCount} child term(s) and cannot be deleted`, childCount: childCount });
      }

      const assignedCount = await deps.entryTerms.countByTerm({ termId });
      if (assignedCount > 0) {
        throw new TermHasAssignedContentError({ message: `term '${termId}' is assigned to ${assignedCount} content item(s) and cannot be deleted`, assignedCount: assignedCount }
        );
      }

      await deps.terms.delete({ id: termId });

      const now = kernelNowIso({ clock: deps.clock });
      await deps.revisions.insert({
        taxonomyId: current.taxonomyId,
        op: "delete",
        previousState: { termId, name: current.name ?? null },
        actorId: principalId,
        recordedAt: now,
      });
      await deps.stampWatermark({});
      await deps.outbox.enqueue({
        event: {
          name: "taxonomy.term_deleted",
          termId,
          taxonomyId: current.taxonomyId,
          actorId: principalId,
          ...(actor ? { actor } : {}),
          occurredAt: now,
        }
      });

      return { deletedTermId: termId };
    }
  });
}

export interface DeleteTaxonomyRequired {
  deps: WriteServiceDeps & {
    taxonomies: DeletableTaxonomyRepoPort;
    terms: TermListPort & DeletableTermRepoPort;
    entryTerms: AssignmentCountEntryTermRepoPort;
    /** See `TransactionalRepoPort`'s doc comment. */
    transaction: TransactionalRepoPort["transaction"];
  };
  principalId: string;
  /** Trusted attribution from the caller's execution channel (admin route `user`, assistant tool
   *  `agent`, publish/background `system`); its `id` must be `principalId`. Optional for now: omitted, the event records no actor. */
  actor?: MutationActor | undefined;
  taxonomyId: string;
}

/**
 * Deletes a taxonomy together with its member terms, refusing when ANY member term is still
 * assigned to content (the sum across all member terms, reported as one `assignedCount`). Unlike
 * `deleteTerm`, this does cascade — but only over terms this same call has just confirmed, INSIDE
 * the same transaction, are unassigned, so nothing recoverable is lost. `deleteTerm`'s own "has
 * children" guard does not apply here: a member term's children are, by construction, also members
 * of the same taxonomy (hierarchy never crosses taxonomies — `validateHierarchyAssignment`'s
 * `ParentCrossTaxonomyError` enforces that on the write side), so deleting the full member set in
 * one pass never leaves a `parentId` dangling outside the set being deleted.
 *
 * Same transaction-boundary and `taxonomy_revisions`-retention rationale as `deleteTerm` — see its
 * doc comment. The taxonomy-level version of the same TOCTOU risk: `listByTaxonomy` and every
 * per-term `countByTerm` call must see the SAME committed state the delete loop is about to act
 * on, which is only guaranteed inside one transaction, not across N separate queries beforehand.
 *
 * @complexity O(t) in the taxonomy's own term count — one `countByTerm` per member term to total
 * the guard, then one delete per member term plus one taxonomy delete, all inside one transaction.
 * @overallScore 100
 */
export async function deleteTaxonomy(
  required: DeleteTaxonomyRequired,
  _optional: Record<string, never> = {}
): Promise<{ deletedTaxonomyId: string; deletedTermIds: string[] }> {
  const { deps, principalId, taxonomyId } = required;
  // The execution channel supplies attribution, the principal ID still governs authorization, and
  // the two are not interchangeable: refuse an actor naming someone else before any write.
  const actor = checkedMutationActor({ principalId, actor: required.actor });
  await authorizeTaxonomyManage(deps, principalId);

  return deps.transaction({
    fn: async () => {
      const taxonomy = await deps.taxonomies.findById({ id: taxonomyId });
      if (!taxonomy) {
        throw new TaxonomyRecordNotFoundError({ message: `taxonomy '${taxonomyId}' was not found` });
      }

      const memberTerms = await deps.terms.listByTaxonomy({ taxonomyId });

      let totalAssigned = 0;
      for (const term of memberTerms) {
        totalAssigned += await deps.entryTerms.countByTerm({ termId: term.id });
      }
      if (totalAssigned > 0) {
        throw new TaxonomyHasAssignedContentError({ message: `taxonomy '${taxonomyId}' has ${totalAssigned} content assignment(s) across its terms and cannot be deleted`, assignedCount: totalAssigned }
        );
      }

      for (const term of memberTerms) {
        await deps.terms.delete({ id: term.id });
      }
      await deps.taxonomies.delete({ id: taxonomyId });

      const now = kernelNowIso({ clock: deps.clock });
      const deletedTermIds = memberTerms.map((term) => term.id);
      await deps.revisions.insert({
        taxonomyId,
        op: "delete",
        previousState: { deletedTermIds },
        actorId: principalId,
        recordedAt: now,
      });
      await deps.stampWatermark({});
      await deps.outbox.enqueue({
        event: {
          name: "taxonomy.deleted",
          taxonomyId,
          deletedTermIds,
          actorId: principalId,
          ...(actor ? { actor } : {}),
          occurredAt: now,
        }
      });

      return { deletedTaxonomyId: taxonomyId, deletedTermIds };
    }
  });
}
