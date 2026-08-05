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
 * **No gated-mutation composition.** The `mergeTerm` ceremony's plan/confirm/execute ordering,
 * token TTL, and actor-class rule belong to a mutation-gateway kernel that is not part of this
 * package. What ports here is the domain's own half — the structural self-merge guard and the
 * overlap-loss disclosure ({@link planMergeTerm}) — which takes the gateway's three steps as
 * injected closures. A host binds them to whichever gateway it runs. This is why `merge-term.ts`
 * has no imports at all: the ceremony is a parameter, not a dependency.
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
  createTaxonomy,
  createTerm,
  renameTerm,
  assignTerms,
  deleteTerm,
  deleteTaxonomy,
  onContentDeleted,
  type AuthorizeFn,
  type Taxonomy,
  type Term,
  type TaxonomyRepoPort,
  type TermRepoPort,
  type EntryTermRepoPort,
  type ContentLookupPort,
  type TaxonomyRevisionRow,
  type TaxonomyRevisionRepoPort,
  type ClockPort,
  type IdGeneratorPort,
  type WriteServiceDeps,
  type CreateTaxonomyRequired,
  type CreateTermRequired,
  type RenameTermRequired,
  type AssignTermsRequired,
  type DeleteTermRequired,
  type DeleteTaxonomyRequired,
  type DeletableTaxonomyRepoPort,
  type DeletableTermRepoPort,
  type AssignmentCountEntryTermRepoPort,
  type TransactionalRepoPort,
  type EntryTermsCleanupPort,
  type OnContentDeletedRequired,
} from "./write-service.js";

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
  type ContentRecordLookupPort,
} from "./content-lookup.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  taxonomyAgentToolCatalog,
  type AgentToolDefinition as TaxonomyAgentToolDefinition,
  type AgentToolSideEffect as TaxonomyAgentToolSideEffect,
  type AgentToolActorClassRule as TaxonomyAgentToolActorClassRule,
} from "./agent-tools.js";
