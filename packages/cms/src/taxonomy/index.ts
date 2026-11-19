/**
 * @file Public surface (barrel) for the `taxonomy` library — categories, tags, and term assignment.
 *
 * A module's public contract is its `index.ts`; deep imports from outside this directory should go
 * through here.
 *
 * ## What is deliberately NOT here
 *
 * **No SQLite adapter and no wiring.** A concrete taxonomy repository names a host's own database
 * schema, so composing one here would put that host's persistence choice on this library's public
 * contract and drag its schema into every consumer's dependency closure. Hosts compose their own
 * against the ports exported below.
 *
 * **No host mutation-gateway composition.** The merge hook builder uses core's universal hook
 * contract and injected hashing, actor identity and permissions. Hosts bind the gateway's
 * plan/confirm/execute steps, token TTL and authorization policy; `merge-term.ts` receives those
 * steps as closures and owns the self-merge guard and overlap-loss disclosure.
 */

export {
  TaxonomyNotApplicableError,
  WorkspaceMismatchError,
  ContentTypeMismatchError,
  TaxonomyNotHierarchicalError,
  ParentCrossTaxonomyError,
  TermNotFoundError,
  HierarchyCycleDetectedError,
  wouldCreateCycle,
  validateContentJoin,
  validateHierarchyAssignment,
  type TermTreeLookup,
} from "./validation-chain.js";

export {
  TAXONOMY_ALLOWED_CONTENT_TYPES,
  isContentTypeOnAllowList,
  TaxonomyRecordNotFoundError,
  TermRecordNotFoundError,
  ContentRecordNotFoundError,
  TermHasAssignedContentError,
  TermHasChildTermsError,
  TaxonomyHasAssignedContentError,
  TaxonomyVersionConflictError,
  createTaxonomy,
  createTerm,
  renameTerm,
  assignTerms,
  unassignTerms,
  deleteTerm,
  deleteTaxonomy,
  onContentDeleted,
  importTaxonomy,
  importTerm,
  type AuthorizeFn,
  type Taxonomy,
  type Term,
  type TaxonomyRepoPort,
  type TermRepoPort,
  type EntryTermRepoPort,
  type ContentLookupPort,
  type ContentTypeTaxonomyPolicyPort,
  type UnassignableEntryTermRepoPort,
  type TaxonomyRevisionRow,
  type TaxonomyRevisionRepoPort,
  type WriteServiceDeps,
  type CreateTaxonomyRequired,
  type CreateTermRequired,
  type CreateTermOptional,
  type RenameTermRequired,
  type AssignTermsRequired,
  type UnassignTermsRequired,
  type DeleteTermRequired,
  type DeleteTaxonomyRequired,
  type DeletableTaxonomyRepoPort,
  type DeletableTermRepoPort,
  type AssignmentCountEntryTermRepoPort,
  type EntryTermsCleanupPort,
  type OnContentDeletedRequired,
  type ImportableTaxonomyRepoPort,
  type ImportableTermRepoPort,
  type ImportTaxonomyRequired,
  type ImportTermRequired,
  type ImportTermOptional,
} from "./write-service.js";

export type {
  AssignedTermView,
  EntryTermReadPort,
  TaxonomyPublishReadPort,
  TermPublishReadPort,
} from "./read-ports.js";

export {
  listTaxonomiesWithTerms,
  type TaxonomyListPort,
  type TermListPort,
  type TaxonomyWithTerms,
} from "./list.js";

/**
 * The domain half of the `mergeTerm` ceremony — see this file's header for why the gateway itself
 * is injected rather than imported.
 */
export {
  SameTermMergeError,
  planMergeTerm,
  confirmMergeTerm,
  executeMergeTerm,
  type MergeTermPlanDetails,
  type PlanMergeTermRequired,
  type ConfirmMergeTermRequired,
  type ExecuteMergeTermRequired,
} from "./merge-term.js";

export {
  InMemoryTaxonomyRepo,
  InMemoryTermRepo,
  InMemoryEntryTermRepo,
  InMemoryTaxonomyRevisionRepo,
  InMemoryContentLookup,
  noopStampWatermark,
  toTaxonomyOutbox,
} from "./repo.memory.js";

/**
 * `ContentRecordLookupPort` is the narrow structural shape a host's post/page repository must
 * satisfy — see `content-lookup.ts` for why it is declared here rather than imported from a
 * content feature.
 */
export {
  createPostBackedContentLookup,
  createEntryBackedContentLookup,
  createContentLookup,
  type ContentRecordLookupPort,
  type EntryRecordLookupPort,
} from "./content-lookup.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  taxonomyAgentToolCatalog,
} from "./agent-tools.js";

export { buildTaxonomyToolRegistrations, taxonomyDerivedRisk } from "./tool-registrations.js";
export type { TaxonomyMergeGateway, TaxonomyMergePrepared, TaxonomyPackageToolDeps, TaxonomyToolSurfaces } from "./tool-handlers.types.js";

export {
  createLiveCollectionTermPolicy, createContentTargetPorts, contentEditPermission, authorizeContentEdit,
  type CollectionOwnerLookupPort,
} from "./collection-term-policy.js";
export { buildMergeTermHooks, type BuildMergeTermHooksInput, type MergeableEntryTermRepoPort } from "./gated-hooks.js";
export {
  createTermPurgeFollowUp, createTaxonomyPurgeFollowUp, type PurgeFollowUpHooks,
  type PurgeTrashLookupPort, type TaxonomyRevisionWritePort, type TaxonomyEventOutboxPort,
  type TermPurgeAuditReadPort, type TaxonomyMemberIdsReadPort,
} from "./taxonomy-trash-follow-ups.js";
export {
  trashTerm, trashTaxonomy, type RemoveTermFn, type RemoveTaxonomyFn, type TermTrashReadPort,
  type TaxonomyTrashReadPort, type TrashTermOutcome, type TrashTaxonomyOutcome,
} from "./trash-term.js";
export { renderHtmlTaxonomy, type HtmlTaxonomyTerm } from "./render-entry.js";
