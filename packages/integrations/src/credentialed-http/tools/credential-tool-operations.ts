// Mechanical extraction provenance (exact source SHA/path) is in this package's source-map.md.
// Original bodies and why-comments are preserved; host wiring stays with the consumer.
/**
 * @file Consumer-only ports for credential tools. Implementations belong to the composing host.
 * @agent-note Types only: core is the sole package dependency. Bind these operations over the
 * existing credential store, guarded adapters and answer-route exchange store; never build a
 * second vault, provider registry or surface store. Every member is required, including host copy.
 */
import type { ApprovalAnswer, ApprovalSteps, DerivedRiskByToolId, LegacyToolAuthorizeFn, SurfaceExchangeStore, ToolExecutionContext, ToolExecutionOptions, ToolHandler } from '@jini-ai/core';
import type { SecretCardForm, SurfaceDetail, SurfaceOutcomeSpec } from '@jini-ai/core/contracts/cards';
import type { CredentialAuthSchemeRule, CredentialSetConnectionInput, CredentialSetSummary, CredentialSetTokenHint, PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { VaultRepoPort } from '@jini-ai/core/contracts/vault';
import type { CallerSafeErrorRule, ModelFacingErrorRule } from '@jini-ai/core/model-facing-tool-errors';

/**
 * Only the approval fields this consumer needs; no host server or UI implementation type.
 * @agent-note The host owns all words, ids and rendering identity. Its tool id must route answers
 * to the SAME held call. Describe the exact resolved label/host/path before asking; model input
 * cannot approve. Namespace/app/path rules belong to the bound transport, not a fallback here.
 */
export interface CredentialApprovalDescription {
  readonly toolId: string;
  readonly errorCode: string;
  readonly title: string;
  readonly description?: string;
  readonly details: readonly SurfaceDetail[];
  readonly warning?: string;
  readonly danger?: boolean;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
}

/**
 * Approval lifecycle and authenticated human transport, independently supplied by the host.
 * @agent-note Typically core createApprovalHandler plus the host's human-confirm binding. Freeze
 * input/principal/run before awaits, prepare before asking, accept only an explicit authenticated
 * answer through the SAME answer-route exchange store, and check abort before effects. Permission
 * is re-admitted after the answer. A decline/expiry/abandonment must never decrypt or send.
 */
export interface CredentialApprovalPort {
  handler<Prepared>(required: ApprovalSteps<Prepared, CredentialApprovalDescription>, optional?: Record<string, never>): ToolHandler;
  askHuman(required: { ctx: ToolExecutionContext; description: CredentialApprovalDescription }, optional: ToolExecutionOptions): Promise<ApprovalAnswer>;
  describeDelete(required: { label: string; host: string; path: string }, optional?: Record<string, never>): CredentialApprovalDescription;
}

/**
 * Display-only card declarations and human-submitted connection fields.
 * @agent-note Typically bind the installed plugin card loader/operations. Absent loader returns
 * []; preserve safe optional-load failure, exact owned labels and conflicts, fixed destinations,
 * public-field/HTTPS validation and canonical validation errors. usedFor is display metadata and
 * grants no authority. readValues sees human answers only; no plaintext enters model results.
 */
export interface CredentialPluginCardsPort {
  load(required: { workspaceId: string }, optional?: Record<string, never>): Promise<readonly PluginCredentialCard[]>;
  find(required: { workspaceId: string; saveKind: PluginCredentialCard['saveKind']; target: string }, optional?: Record<string, never>): Promise<PluginCredentialCard | undefined>;
  readValues(required: { card: PluginCredentialCard; values: Readonly<Record<string, unknown>> }, optional?: Record<string, never>): {
    label: string; category: string; baseUrl: string; username?: string; token: string; additionalHosts?: readonly string[];
  };
}

/**
 * Non-secret form protocol; field names are saved-card protocol, not product vocabulary.
 * @agent-note Validate prefill with the host's secret-free field policy before rendering. worksFor
 * is compatibility metadata only; the store still validates categories and all persisted fields.
 */
export interface CredentialCreatePrefill {
  readonly label?: string;
  readonly baseUrl?: string;
  readonly category?: string;
  readonly worksFor?: string[];
}

/**
 * Host card descriptions, usually provided by UI builders wired at composition.
 * @agent-note Supply every sentence/example URL/category option/app id through these builders.
 * Token fields must be masked and never prefilled. The secret-card lifecycle supplies the SAME
 * URI for form and outcome; emit outcome only after save finishes. No model-secret fallback.
 */
export interface CredentialCardFormsPort {
  buildPlugin(required: { card: PluginCredentialCard }, optional?: Record<string, never>): SecretCardForm;
  applyPlugin(required: { card?: PluginCredentialCard | undefined; form: SecretCardForm }, optional?: Record<string, never>): SecretCardForm;
  create(required: { prefill: CredentialCreatePrefill; providers: readonly { id: string; vendorId: string }[] }, optional?: Record<string, never>): SecretCardForm;
  createOutcome(required: { label: string; state: 'success' | 'failure'; message: string }, optional?: Record<string, never>): SurfaceOutcomeSpec;
  rotate(required: { label: string }, optional?: Record<string, never>): SecretCardForm;
  rotateOutcome(required: { label: string; state: 'success' | 'failure'; message: string }, optional?: Record<string, never>): SurfaceOutcomeSpec;
}

/**
 * Only the recovery facts this consumer returns. Additional host-issued fields remain intact.
 * @agent-note Preserve the issuer's object identity/provenance; never reconstruct a diagnostic
 * from untrusted returned JSON. Only already-registered tool ids may be offered as remedies.
 */
export interface CredentialSetupDiagnostic {
  readonly hint?: string;
  readonly remedyToolId?: string;
}

/** @agent-note This value-free failure must not contain a token, raw exception or sealed context. */
export interface CredentialToolSetupFailure {
  readonly executed: false;
  readonly credentialSetup: CredentialSetupDiagnostic;
}

/**
 * Credential setup diagnostics retain the host's issuance and validation policy.
 * @agent-note Missing label can offer create with public prefill; only an explicit invalid verify
 * can offer replacement. Unreachable/transport errors never establish invalidity. Preserve the
 * original issued diagnostic object and successful provider result, including additional fields.
 */
export interface CredentialRecoveryPort {
  withSetup<Result>(required: { invoke: () => Promise<Result>; label: string; url?: string; verification?: boolean }, optional?: Record<string, never>): Promise<Result | CredentialToolSetupFailure>;
}

/**
 * Read-only catalogs and publish compatibility invalidation, bound over the host's current objects.
 * @agent-note Catalog failures are optional enrichment only and must not block save or erase
 * explicit worksFor ids. prepareInvalidation loads the existing registry only when the existing
 * cache is attached, BEFORE persistence; its callback closes over those exact objects and runs
 * only AFTER a successful save. Do not reload, cache, queue, invalidate on failure or add opens.
 */
export interface CredentialPublishPort {
  loadProviders(required: Record<string, never>, optional?: Record<string, never>): Promise<{ id: string; vendorId: string }[]>;
  prepareInvalidation(required: Record<string, never>, optional?: Record<string, never>): Promise<(required: { after: CredentialSetSummary }) => void>;
}

/**
 * Host locale and translated safe credential copy.
 * @agent-note Resolve for the authenticated principal/workspace. Translate only already-safe
 * messages; token hints are for human outcomes and never model results. No default locale/copy.
 */
export interface CredentialLocalePort {
  resolve(required: { principalId: string }, optional?: Record<string, never>): Promise<string>;
  text(required: { id: 'blank' | 'saved'; locale: string }, optional?: Record<string, never>): string;
  hint(required: { hint: CredentialSetTokenHint | null | undefined; locale: string }, optional?: Record<string, never>): string;
  translate(required: { message: string; locale: string }, optional?: Record<string, never>): string;
}

/**
 * Host token, public-field, abort and duplicate-message policy.
 * @agent-note guardRepo must guard site/project insert/update and vault put/applyBatch AFTER
 * asynchronous sealing while preserving receiver, vault/CAS/transaction identity and read/delete
 * behavior. cleanToken preserves the token interior and never reflects it in errors. Public fields
 * are checked before disclosure. worksFor never selects or authorizes a credential. Only a trusted
 * project-conflict classifier may publish its known safe message; arbitrary exceptions stay private.
 */
export interface CredentialToolPolicy {
  guardRepo<Repo extends { readonly vault?: VaultRepoPort }>(required: { store: Repo; signal: AbortSignal }, optional?: Record<string, never>): Repo;
  cleanToken(required: { token: string }, optional?: Record<string, never>): string;
  assertFreeField(required: { value: string; field: string }, optional?: Record<string, never>): void;
  normalizeWorksFor(required: { value: unknown }, optional?: Record<string, never>): string[];
  readonly defaultCategory: string;
  isProjectConflict(required: { error: Error }, optional?: Record<string, never>): boolean;
  validateWriteFiles(required: { branch: unknown; commitMessage: unknown; files: unknown }, optional?: Record<string, never>): CredentialWriteFilesRequest;
}

/**
 * Validated file payload before provider-specific owner/repository validation.
 * @agent-note The host validator preserves branch/path/size limits and canonical validation
 * errors, including reserved .git paths. It runs before permission/I/O; provider target rules run
 * after build from saved metadata but before decrypt. files are the exact validated commit input.
 */
export interface CredentialWriteFilesRequest {
  readonly branch: string;
  readonly commitMessage: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

/**
 * Every sentence assembled by the handler closure; host callbacks own interpolated wording too.
 * @agent-note Never echo submitted secret values. Field errors may name keys only; duplicate
 * messages receive a secret-free display label. Keep established host bytes by binding old copy.
 */
export interface CredentialToolMessages {
  readonly formSaveFailure: string;
  readonly noCreateChannel: string;
  readonly noRotateChannel: string;
  readonly noDeleteChannel: string;
  readonly runEnded: string;
  readonly invalidWorksFor: string;
  readonly unlabeled: string;
  readonly missingUsername: string;
  readonly invalidUsername: string;
  readonly probeOriginMismatch: string;
  unexpectedUsername(required: { keys: readonly string[] }, optional?: Record<string, never>): string;
  unexpectedToken(required: { keys: readonly string[] }, optional?: Record<string, never>): string;
  notFoundLabel(required: { label: string }, optional?: Record<string, never>): string;
  notFoundId(required: { id: string }, optional?: Record<string, never>): string;
  duplicateLabel(required: { label: string }, optional?: Record<string, never>): string;
  missingPluginCard(required: { providerId: string }, optional?: Record<string, never>): string;
  writeFailure(required: { message: string }, optional?: Record<string, never>): string;
  probeFailure(required: { status: 'refused' | 'unavailable'; keyHint?: string | undefined; replacing: boolean }, optional?: Record<string, never>): string;
}

/**
 * Log-only observations, never model-facing diagnostics.
 * @agent-note Error summaries may contain class/code only. Never log raw error text, the submitted
 * label/token/file contents. Write failure detail stays server-side; human/model text uses the
 * caller-safe message. Creation logs fixed lifecycle metadata only; rotation also the row id.
 */
export interface CredentialToolDiagnostics {
  describeError(required: { error: unknown }, optional?: Record<string, never>): string;
  createFailure(required: { metadata: { toolId: string; exchangeId: string; saved: false } }, optional?: Record<string, never>): void;
  rotateFailure(required: { toolId: string; exchangeId: string; credentialId: string; errorSummary: string }, optional?: Record<string, never>): void;
  writeFailure(required: { phase: 'plan' | 'commit'; failure: { readonly code: string; readonly logDetail?: string } }, optional?: Record<string, never>): void;
}

/**
 * The already-extracted credential-set job, bound over the host's C1 policy and current store.
 * @agent-note Reads preserve metadata-only behavior; resolve opens only the selected authorized
 * row. Writes use the SAME repo/vault/transaction and supplied guardRepo for both site/project
 * persistence after asynchronous sealing. replace uses trusted principalId to decide owner-only
 * shared-key replacement, rechecks current grants, and preserves CAS/context. No new repo/store.
 */
export interface CredentialToolSetsPort {
  list(required: Record<string, never>, optional?: Record<string, never>): Promise<CredentialSetSummary[]>;
  describe(required: { id: string }, optional?: Record<string, never>): Promise<CredentialSetSummary | null>;
  byLabel(required: { label: string }, optional?: Record<string, never>): Promise<CredentialSetSummary | null>;
  resolve(required: { label: string }, optional?: Record<string, never>): Promise<{ baseUrl: string; connection: CredentialSetConnectionInput } | null>;
  setUsername(required: { id: string; username: string | null }, optional?: Record<string, never>): Promise<CredentialSetSummary>;
  replace(required: { id: string; connection: CredentialSetConnectionInput; signal: AbortSignal; principalId: string; guardRepo: CredentialToolPolicy['guardRepo'] }, optional?: Record<string, never>): Promise<CredentialSetSummary>;
  create(required: { label: string; worksFor: unknown; category: string; baseUrl: string; additionalHosts?: readonly string[]; scope?: 'site'; connection: CredentialSetConnectionInput; signal: AbortSignal; guardRepo: CredentialToolPolicy['guardRepo'] }, optional?: Record<string, never>): Promise<CredentialSetSummary>;
}

/**
 * Only authenticated scope, authorization and trusted scheme loading are consumed directly.
 * @agent-note Supply the host's existing authorizer and installed auth schemes for this workspace.
 * Scope is trusted composition input, never read from model input or an answer. All request,
 * store, provider, locale and UI implementations arrive through the named operations instead.
 */
export interface CredentialToolActorDeps {
  readonly authorize: LegacyToolAuthorizeFn;
  readonly workspaceId: string;
  loadAuthSchemes(required: { workspaceId: string }, optional?: Record<string, never>): Promise<readonly CredentialAuthSchemeRule[]>;
}

/**
 * Required consumer contract for the complete credential-tool seam.
 * @agent-note Bind every port over the SAME store/adapters/exchanges as the host's routes. ids
 * must agree with catalog/metadata/risk and answer routing; no default tool/permission/path exists.
 * Model rules are a canonical-class allowlist: unknown/transport/raw sealer/JSON errors remain
 * private; secret-store failures use fixed text. Form rules likewise use a fixed fallback. These
 * declarations are local consumer needs, so they do not introduce a domain package dependency.
 */
export interface CredentialToolOperations {
  readonly sets: CredentialToolSetsPort;
  readonly approval: CredentialApprovalPort;
  readonly pluginCards: CredentialPluginCardsPort;
  readonly credentialCardForms: CredentialCardFormsPort;
  readonly recovery: CredentialRecoveryPort;
  readonly publish: CredentialPublishPort;
  readonly locale: CredentialLocalePort;
  readonly policy: CredentialToolPolicy;
  readonly messages: CredentialToolMessages;
  readonly diagnostics: CredentialToolDiagnostics;
  readonly ids: { readonly list: string; readonly verify: string; readonly setUsername: string; readonly makeRequest: string; readonly writeFiles: string; readonly save: string };
  readonly derivedRisk: DerivedRiskByToolId;
  readonly modelFacingErrors: readonly ModelFacingErrorRule[];
  readonly formErrors: readonly CallerSafeErrorRule[];
}

/**
 * Only the shared exchange store is consumed by these handlers.
 * @agent-note This MUST be the SAME store instance used by answer/callback routes. The approval
 * transport may close over extra host authorization dependencies; this consumer never imports them.
 */
export interface CredentialToolSurfaces {
  readonly surfaceExchanges: SurfaceExchangeStore;
}
