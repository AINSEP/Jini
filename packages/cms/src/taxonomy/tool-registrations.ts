/**
 * @file Taxonomy's agent-tool wiring: the authored risk map and the id -> handler table over the
 * catalog the host passes in. The handlers live in `tool-handlers.ts`; the ports they are written
 * against in `tool-handlers.types.ts`. The host's search vocabulary and approval policy are applied
 * by the host, around the result.
 */
import { buildDomainRegistrations, indexCatalogById, ToolPermissionDeniedError, type AgentToolDefinition, type AgentToolSideEffect, type ToolHandler, type ToolRegistration, type HostReadVocabulary } from "@jini-ai/core";
import { forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import {
  MERGE_TOOL_ID,
  taxonomyAssignTermsHandler,
  taxonomyCreateTaxonomyHandler,
  taxonomyCreateTermHandler,
  taxonomyExecuteMergeTermHandler,
  taxonomyGetAssignedTermsHandler,
  taxonomyGetTermHandler,
  taxonomyListHandler,
  taxonomyPlanMergeTermHandler,
  taxonomyRenameTermHandler,
  taxonomyUnassignTermsHandler,
} from "./tool-handlers.js";
import type { TaxonomyHandlerArgs, TaxonomyPackageToolDeps, TaxonomyToolSurfaces } from "./tool-handlers.types.js";

const MUTATES_DURABLE_STATE = "mutates-durable-state";

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const taxonomyDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> listTaxonomiesWithTerms (list.ts): taxonomies.list() + terms.listByTaxonomy() reads only.
  ["taxonomy_list", "none"],
  // Full live term read, no assignment or revision writes.
  ["taxonomy_get_term", "none"],
  // -> entryTermRepo.listForContent + taxonomyRepo.list + termRepo.listByTaxonomy,
  //    with contentTypeRepo.findByKey for collection validation; reads only.
  ["taxonomy_get_assigned_terms", "none"],
  // -> createTaxonomy (write-service.ts): taxonomies.insert + revisions.insert in effect.
  ["taxonomy_create_taxonomy", MUTATES_DURABLE_STATE],
  // -> createTerm (write-service.ts): terms.insert + revisions.insert.
  ["taxonomy_create_term", MUTATES_DURABLE_STATE],
  // -> renameTerm (write-service.ts): terms.update + revisions.insert.
  ["taxonomy_rename_term", MUTATES_DURABLE_STATE],
  // -> assignTerms (write-service.ts): entryTerms.upsert per termId (INV-05: no revision row, see
  //    that function's own doc comment for the disclosed narrowing this implements).
  ["taxonomy_assign_terms", MUTATES_DURABLE_STATE],
  // -> unassignTerms (write-service.ts): entryTerms.remove per termId — same INV-05 no-revision-row
  //    narrowing as assignTerms (that function's own doc comment discloses it applies equally here).
  ["taxonomy_unassign_terms", MUTATES_DURABLE_STATE],
  // -> gateway.ts's plan() via buildMergeTermHooks: authorizes, then recomputes a plan and returns
  //    it — verified directly against plan()'s own body, which persists nothing (AC-10).
  ["taxonomy_plan_merge_term", "none"],
  // -> gateway confirm() (as the human, after their click) + execute() via buildMergeTermHooks:
  //    entryTerms.repointTerm (re-points, then deletes the source rows) + terms.update (deprecate)
  //    + revisions.insert.
  ["taxonomy_execute_merge_term", MUTATES_DURABLE_STATE],
]);


/**
 * Builds the Taxonomy tool registrations from the package-side deps: the id -> handler table over
 * `catalog` (the host's catalog, which extends the shared one with two read tools). Host metadata
 * (search vocabulary, approval policy) is NOT applied here; the host binding wraps the result.
 */
export function buildTaxonomyToolRegistrations(
  { deps, surfaces, catalog }: { deps: TaxonomyPackageToolDeps; surfaces: TaxonomyToolSurfaces; catalog: readonly AgentToolDefinition[] },
  { hostReads }: { hostReads?: HostReadVocabulary | undefined } = {},
): ToolRegistration[] {
  const args: TaxonomyHandlerArgs = { deps, surfaces, hostReads };
  const rules = [forbiddenRule({ domainPrefix: "TAXONOMY", error: ToolPermissionDeniedError })];
  const handlers: Record<string, ToolHandler> = {
    ...withModelFacingErrors({ handlers: { taxonomy_get_term: taxonomyGetTermHandler(args) }, rules }),
    taxonomy_list: taxonomyListHandler(args),
    ...withModelFacingErrors({ handlers: { taxonomy_get_assigned_terms: taxonomyGetAssignedTermsHandler(args) }, rules }),
    taxonomy_create_taxonomy: taxonomyCreateTaxonomyHandler(args),
    taxonomy_create_term: taxonomyCreateTermHandler(args),
    taxonomy_rename_term: taxonomyRenameTermHandler(args),
    taxonomy_assign_terms: taxonomyAssignTermsHandler(args),
    taxonomy_unassign_terms: taxonomyUnassignTermsHandler(args),
    taxonomy_plan_merge_term: taxonomyPlanMergeTermHandler(args),
    [MERGE_TOOL_ID]: taxonomyExecuteMergeTermHandler(args),
  };

  return buildDomainRegistrations({
    domain: "taxonomy",
    catalogModule: "the taxonomy agent-tool catalog",
    catalog: indexCatalogById({ catalog }),
    handlers,
    derivedRisk: taxonomyDerivedRisk,
  });
}
