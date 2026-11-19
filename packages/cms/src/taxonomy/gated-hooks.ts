import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort } from "@jini-ai/core/primitives";
import type { GatedMutationHooks } from "@jini-ai/core/gated-mutations";
import type { ImportableTermRepoPort } from "./import-service.js";
import type { TermRepoPort, TaxonomyRevisionRepoPort } from "./write-contracts.js";
import type { MergeTermPlanDetails } from "./merge-term.js";

/**
 * @file Taxonomy's `GatedMutationHooks` factory for the `mergeTerm` ceremony (SPEC-018 C-207) —
 * the domain-specific quarter of what used to be `server/gated-mutations-composition.ts`, split
 * out so Taxonomy no longer needs a back-edge into `server/` for its own hook builder. The generic
 * pieces every ceremony shares (`buildGatewayDeps`, `planHashOf`, `resolveActorClassIdentity`,
 * `buildConfirmOnlyHooks`) stay host-owned: hashing, actor identity and ceremony permissions are
 * injected, so this domain depends only on core's universal hook contract, never a host server.
 */

/** Additive capability beyond the certified `EntryTermRepoPort` (which has no by-term enumeration
 * method at all) — implemented on both `InMemoryEntryTermRepo` and `SqliteEntryTermRepo`. */
export interface MergeableEntryTermRepoPort {
  countOverlap(params: { fromTermId: string; intoTermId: string }): Promise<number>;
  repointTerm(params: { fromTermId: string; intoTermId: string }): Promise<{ repointedCount: number }>;
}

export interface BuildMergeTermHooksInput {
  workspaceId: string;
  fromTermId: string;
  intoTermId: string;
  actorId: string;
  clock: ClockPort;
  /** `findByIdFull` because the deprecation write must advance the source term's stored `version`,
   * which the narrow `findById` row doesn't carry. */
  termRepo: Pick<TermRepoPort, "update"> & Pick<ImportableTermRepoPort, "findByIdFull">;
  entryTermRepo: MergeableEntryTermRepoPort;
  taxonomyRevisionRepo: Pick<TaxonomyRevisionRepoPort, "insert">;
  planHashOf: (details: MergeTermPlanDetails) => string;
  resolveActorClassIdentity: GatedMutationHooks<MergeTermPlanDetails, { mergedCount: number }>["resolveActorClassIdentity"];
  domain: string;
  readPermission: string;
  mutatePermission: string;
}

/**
 * SPEC-018 C-207 — the taxonomy `mergeTerm` ceremony's `GatedMutationHooks`. `computePlan()` is
 * re-invoked by both `gateway.plan()` and `gateway.execute()` (CIC U-001-B3): it live-recomputes
 * the overlap count every call, so a change in `entry_terms` between confirm and execute correctly
 * produces a different plan hash and a `PLAN_STALE` rejection at execute time — never a cached,
 * possibly-stale count.
 *
 * The original extraction recorded `executeMutation()` as new production logic without certified
 * merge-SQL tests — Session 4's own disclosure: "confirmMergeTerm/executeMergeTerm
 * were implemented anyway as thin delegating wrappers... the other two were added for a coherent,
 * real, composable chokepoint". Re-points every `entry_terms` row from `fromTermId` to
 * `intoTermId` (dedup via `entry_terms_unique`, the disclosed overlap-loss mode `merge-term.ts`'s
 * own header names), flips the source term to `status: "deprecated"` (a term merge is
 * semantically a "this term no longer exists standalone" transition — the closest fit in
 * `TaxonomyRevisionRow`'s certified, closed `op` union is `"deprecate"`; there is no `"merge"`
 * variant to reuse, and widening that union is out of this dispatch's scope, so `"deprecate"` is
 * used with a `previousState` payload that names the merge explicitly, disclosed here rather than
 * silently picked).
 *
 * @complexity O(f) in the number of `entry_terms` rows assigned to `fromTermId`.
 */
export function buildMergeTermHooks(input: BuildMergeTermHooksInput, _optional = {}): GatedMutationHooks<MergeTermPlanDetails, { mergedCount: number }> {
  return {
    domain: input.domain,
    readPermission: input.readPermission,
    mutatePermission: input.mutatePermission,
    scopeId: input.workspaceId,
    computePlan: async () => {
      const overlappingContentCount = await input.entryTermRepo.countOverlap({ fromTermId: input.fromTermId, intoTermId: input.intoTermId });
      const details: MergeTermPlanDetails = {
        fromTermId: input.fromTermId,
        intoTermId: input.intoTermId,
        overlapLossDisclosed: overlappingContentCount > 0,
        overlappingContentCount,
      };
      return { planHash: input.planHashOf(details), details };
    },
    executeMutation: async () => {
      const { repointedCount } = await input.entryTermRepo.repointTerm({ fromTermId: input.fromTermId, intoTermId: input.intoTermId });

      const fromTerm = await input.termRepo.findByIdFull({ id: input.fromTermId });
      if (fromTerm) {
        await input.termRepo.update({
          id: fromTerm.id, taxonomyId: fromTerm.taxonomyId, parentId: null, name: fromTerm.name,
          status: "deprecated", updatedAt: clockNowIso({ clock: input.clock }),
          // Advance, never reset: a stale editor holding the pre-merge version must lose its CAS.
          version: fromTerm.version + 1,
        });
        await input.taxonomyRevisionRepo.insert({
          taxonomyId: fromTerm.taxonomyId,
          op: "deprecate",
          previousState: { mergedInto: input.intoTermId, fromTermId: input.fromTermId, repointedCount },
          actorId: input.actorId,
          recordedAt: clockNowIso({ clock: input.clock }),
        });
      }

      return { mergedCount: repointedCount };
    },
    resolveActorClassIdentity: input.resolveActorClassIdentity,
  };
}
