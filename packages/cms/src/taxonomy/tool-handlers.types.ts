/**
 * @file The ports and deps the taxonomy agent-tool handlers are written against. Nothing here names
 * a host: the gateway, the human-confirm wrapper, the strict-keys guard, the slug function, the
 * built content-target ports and the merge hooks are passed in, so a host binds them to its own
 * token policy, confirm dialog and content-type registry.
 */
import type { AuthorizeFn, MutationActor, OutboxPort, TransactionalRepoPort } from "@jini-ai/core/contracts/events";
import type { GatedMutationHooks, GatewayPlan, PrincipalKind } from "@jini-ai/core/gated-mutations";
import type { Clock } from "@jini-ai/core/primitives";
import type { HostReadVocabulary, HumanConfirmer, SurfaceExchangeStore, ToolExecutionContext, ToolHandler } from "@jini-ai/core";
import type { TaxonomyListPort, TermListPort } from "./list.js";
import type { MergeTermPlanDetails, planMergeTerm } from "./merge-term.js";
import type {
  ContentLookupPort,
  ContentTypeTaxonomyPolicyPort,
  EntryTermRepoPort,
  TaxonomyRepoPort,
  TaxonomyRevisionRepoPort,
  TermRepoPort,
} from "./write-contracts.js";
import type {
  ImportableTermRepoPort,
} from "./import-service.js";
import type {
  UnassignableEntryTermRepoPort,
} from "./assignment-service.js";

/** What the handlers need to put a gated plan -> confirm -> execute ceremony behind a human click. */
export interface TaxonomyMergeGateway {
  plan(required: { principalId: string; principalKind: PrincipalKind; hooks: MergeHooks }): Promise<GatewayPlan>;
  confirm(required: { principalId: string; principalKind: PrincipalKind; hooks: MergeHooks; planId: string; planHash: string }): Promise<{ confirmationToken: string }>;
  execute(required: { principalId: string; principalKind: PrincipalKind; hooks: MergeHooks; confirmationToken: string }): Promise<{ mergedCount: number }>;
}

export type MergeHooks = GatedMutationHooks<MergeTermPlanDetails, { mergedCount: number }>;

/** What the merge handler prepares and the host's confirm dialog describes: the plan and both term names. */
export interface TaxonomyMergePrepared {
  hooks: MergeHooks;
  plan: Awaited<ReturnType<typeof planMergeTerm>>;
  fromName: string;
  intoName: string;
}

export interface TaxonomyToolSurfaces {
  readonly surfaceExchanges: SurfaceExchangeStore;
}

/**
 * The slice of the host's deps the handlers read. The built objects (`contentTargetPorts`,
 * `collectionTermPolicy`, `authorizeContentEdit`, `mergeTermHooks`) and the gateway, the human
 * confirm wrapper, the strict-keys guard and the slug function are host ports: the host owns the
 * content-type policy, the token policy and the confirm dialog's wording and transport.
 */
export interface TaxonomyPackageToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: Clock;
  idGen: { newId(): string };
  taxonomyRepo: TaxonomyRepoPort & TaxonomyListPort & TransactionalRepoPort;
  termRepo: TermRepoPort & TermListPort & ImportableTermRepoPort;
  entryTermRepo: EntryTermRepoPort & UnassignableEntryTermRepoPort & {
    listForContent(input: { contentType: string; contentId: string }): Promise<ReadonlyArray<{ termId: string }>>;
    countOverlap(params: { fromTermId: string; intoTermId: string }): Promise<number>;
  };
  taxonomyRevisionRepo: TaxonomyRevisionRepoPort;
  /** Read whole by `toTaxonomyOutbox`, together with `clock`, `idGen` and `workspaceId`. */
  outbox: OutboxPort;
  /** The host's trusted attribution for the assistant tool channel. Optional for now; unbound, writes record no actor. */
  mutationActor?: ((required: { principalId: string }) => MutationActor) | undefined;
  stampWatermark: () => Promise<void> | void;
  contentTargetPorts(): { contentLookup: ContentLookupPort; contentTypeTaxonomyPolicy: ContentTypeTaxonomyPolicyPort };
  collectionTermPolicy(): ContentTypeTaxonomyPolicyPort;
  authorizeContentEdit(required: { principalId: string; contentType: string }, optional?: Record<string, never>): Promise<void>;
  mergeTermHooks(required: { fromTermId: string; intoTermId: string; actorId: string }, optional?: Record<string, never>): MergeHooks;
  mergeGateway: TaxonomyMergeGateway;
  /**
   * The merge's human confirmation: the host asks the human (wording, locale and transport are
   * the host's), and only on the human's click calls `run`. `flag` is the result key for "did it run".
   */
  mergeConfirmedHandler(
    surfaces: TaxonomyToolSurfaces,
    spec: {
      flag: string;
      prepare: (required: { ctx: ToolExecutionContext }) => Promise<TaxonomyMergePrepared>;
      run: (required: { ctx: ToolExecutionContext; prepared: TaxonomyMergePrepared; confirmer: HumanConfirmer }) => Promise<unknown>;
    },
  ): ToolHandler;
  refuseUnexpectedKeys(input: Record<string, unknown>, allowed: readonly string[]): void;
  toSlug(required: { text: string }, optional?: Record<string, never>): string;
}

/** What every handler receives: the package deps and the surface store the human confirm runs on. */
export interface TaxonomyHandlerArgs {
  deps: TaxonomyPackageToolDeps;
  surfaces: TaxonomyToolSurfaces;
  /** How model-facing text names the host's read tools; neutral wording when absent. */
  hostReads?: HostReadVocabulary | undefined;
}
