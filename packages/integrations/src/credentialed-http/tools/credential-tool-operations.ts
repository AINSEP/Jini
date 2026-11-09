// Mechanical extraction provenance (exact source SHA/path) is in this package's source-map.md.
// Original bodies and why-comments are preserved; host wiring stays with the consumer.
/**
 * @file Consumer-only ports for credential tools. Implementations belong to the composing host.
 */
import type { ApprovalAnswer, ApprovalSteps, DerivedRiskByToolId, LegacyToolAuthorizeFn, SurfaceExchangeStore, ToolExecutionContext, ToolExecutionOptions, ToolHandler } from '@jini-ai/core';
import type { SecretCardForm, SurfaceDetail, SurfaceOutcomeSpec } from '@jini-ai/core/contracts/cards';
import type { CredentialAuthSchemeRule, CredentialSetConnectionInput, CredentialSetSummary, CredentialSetTokenHint, PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { VaultRepoPort } from '@jini-ai/core/contracts/vault';
import type { CallerSafeErrorRule, ModelFacingErrorRule } from '@jini-ai/core/model-facing-tool-errors';

/**
 * Only the approval fields this consumer needs; no host server or UI implementation type.
 */
/** @agent-note The tool id must route the authenticated human answer to the SAME held call described by the resolved label, host and path. */
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
 */
/** @agent-note Freeze input, principal and run before awaits, accept only an explicit authenticated human answer, and recheck permission and abort before decrypting or sending. */
export interface CredentialApprovalPort {
  handler<Prepared>(required: ApprovalSteps<Prepared, CredentialApprovalDescription>, optional?: Record<string, never>): ToolHandler;
  askHuman(required: { ctx: ToolExecutionContext; description: CredentialApprovalDescription }, optional: ToolExecutionOptions): Promise<ApprovalAnswer>;
  describeDelete(required: { label: string; host: string; path: string }, optional?: Record<string, never>): CredentialApprovalDescription;
}

/**
 * Display-only card declarations and human-submitted connection fields.
 */
/** @agent-note Treat absent or failed optional card loading as empty enrichment, while fixed destinations, field validation and owned labels remain authoritative. */
export interface CredentialPluginCardsPort {
  load(required: { workspaceId: string }, optional?: Record<string, never>): Promise<readonly PluginCredentialCard[]>;
  find(required: { workspaceId: string; saveKind: PluginCredentialCard['saveKind']; target: string }, optional?: Record<string, never>): Promise<PluginCredentialCard | undefined>;
  readValues(required: { card: PluginCredentialCard; values: Readonly<Record<string, unknown>> }, optional?: Record<string, never>): {
    label: string; category: string; baseUrl: string; username?: string; token: string; additionalHosts?: readonly string[];
  };
}

/**
 * Non-secret form protocol; field names are saved-card protocol, not product vocabulary.
 */
/** @agent-note Validate prefill as secret-free metadata before rendering; worksFor neither selects nor authorizes a credential. */
export interface CredentialCreatePrefill {
  readonly label?: string;
  readonly baseUrl?: string;
  readonly category?: string;
  readonly worksFor?: string[];
}

/**
 * Host card descriptions, usually provided by UI builders wired at composition.
 */
/** @agent-note Mask token fields without prefilling them, and send the outcome on the SAME URI only after the save completes. */
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
 */
/** @agent-note Preserve the issued diagnostic object and its non-enumerable provenance rather than reconstructing it from public fields. */
export interface CredentialSetupDiagnostic {
  readonly hint?: string;
  readonly remedyToolId?: string;
}

export interface CredentialToolSetupFailure {
  readonly executed: false;
  readonly credentialSetup: CredentialSetupDiagnostic;
}

/**
 * Credential setup diagnostics retain the host's issuance and validation policy.
 */
/** @agent-note Only explicit invalid verification may offer replacement, because transport or unreachable failures never establish credential invalidity. */
export interface CredentialRecoveryPort {
  withSetup<Result>(required: { invoke: () => Promise<Result>; label: string; url?: string; verification?: boolean }, optional?: Record<string, never>): Promise<Result | CredentialToolSetupFailure>;
}

/**
 * Read-only catalogs and publish compatibility invalidation, bound over the host's current objects.
 */
/** @agent-note Prepare invalidation from the attached registry before persistence and invoke its captured callback only after a successful save, without reloading or invalidating on failure. */
export interface CredentialPublishPort {
  /** @agent-note Optional catalog failures must return empty enrichment without blocking a save or removing explicit worksFor ids. */
  loadProviders(required: Record<string, never>, optional?: Record<string, never>): Promise<{ id: string; vendorId: string }[]>;
  prepareInvalidation(required: Record<string, never>, optional?: Record<string, never>): Promise<(required: { after: CredentialSetSummary }) => void>;
}

/**
 * Host locale and translated safe credential copy.
 */
/** @agent-note Translate only caller-safe text for the authenticated scope, and reserve token hints for human outcomes rather than model results. */
export interface CredentialLocalePort {
  resolve(required: { principalId: string }, optional?: Record<string, never>): Promise<string>;
  text(required: { id: 'blank' | 'saved'; locale: string }, optional?: Record<string, never>): string;
  hint(required: { hint: CredentialSetTokenHint | null | undefined; locale: string }, optional?: Record<string, never>): string;
  translate(required: { message: string; locale: string }, optional?: Record<string, never>): string;
}

/**
 * Host token, public-field, abort and duplicate-message policy.
 */
/** @agent-note guardRepo must preserve receiver, vault, CAS and transaction identity while guarding site and project writes after asynchronous sealing. */
export interface CredentialToolPolicy {
  guardRepo<Repo extends { readonly vault?: VaultRepoPort }>(required: { store: Repo; signal: AbortSignal }, optional?: Record<string, never>): Repo;
  /** @agent-note Preserve token interior bytes and never reflect them in normalization errors. */
  cleanToken(required: { token: string }, optional?: Record<string, never>): string;
  assertFreeField(required: { value: string; field: string }, optional?: Record<string, never>): void;
  normalizeWorksFor(required: { value: unknown }, optional?: Record<string, never>): string[];
  readonly defaultCategory: string;
  /** @agent-note Classify only trusted project-conflict errors whose messages are already safe to publish. */
  isProjectConflict(required: { error: Error }, optional?: Record<string, never>): boolean;
  validateWriteFiles(required: { branch: unknown; commitMessage: unknown; files: unknown }, optional?: Record<string, never>): CredentialWriteFilesRequest;
}

/**
 * Validated file payload before provider-specific owner/repository validation.
 */
/** @agent-note Validate reserved paths, sizes and canonical input errors before permission or I/O, then preserve the exact file payload through provider planning and commit. */
export interface CredentialWriteFilesRequest {
  readonly branch: string;
  readonly commitMessage: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

/**
 * Every sentence assembled by the handler closure; host callbacks own interpolated wording too.
 */
/** @agent-note Messages may name rejected keys or a secret-free display label but must never echo submitted secret values. */
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
 */
/** @agent-note describeError returns class/code only, while trusted provider failure detail stays in server logs and never human or model messages. */
export interface CredentialToolDiagnostics {
  describeError(required: { error: unknown }, optional?: Record<string, never>): string;
  createFailure(required: { metadata: { toolId: string; exchangeId: string; saved: false } }, optional?: Record<string, never>): void;
  rotateFailure(required: { toolId: string; exchangeId: string; credentialId: string; errorSummary: string }, optional?: Record<string, never>): void;
  writeFailure(required: { phase: 'plan' | 'commit'; failure: { readonly code: string; readonly logDetail?: string } }, optional?: Record<string, never>): void;
}

/**
 * The already-extracted credential-set job, bound over the host's C1 policy and current store.
 */
/** @agent-note Bind the SAME repo, vault, transaction and abort guard as host routes, rechecking current grants and CAS when replacing a selected authorized row. */
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
 */
/** @agent-note Workspace and principal scope must come from trusted host composition rather than model input or card answers. */
export interface CredentialToolActorDeps {
  readonly authorize: LegacyToolAuthorizeFn;
  readonly workspaceId: string;
  loadAuthSchemes(required: { workspaceId: string }, optional?: Record<string, never>): Promise<readonly CredentialAuthSchemeRule[]>;
}

/**
 * Required consumer contract for the complete credential-tool seam.
 */
/** @agent-note operations.ids must agree with catalog, metadata, derived risk and answer routing over the SAME host stores and adapters. */
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
  /** @agent-note DELETE preflight validation uses CredentialedRequestValidationError exported by this package's credentialed-http entry, so include that class to surface its refusal. */
  readonly modelFacingErrors: readonly ModelFacingErrorRule[];
  readonly formErrors: readonly CallerSafeErrorRule[];
}

/**
 * Only the shared exchange store is consumed by these handlers.
 */
/** @agent-note This must be the SAME exchange store instance used by the answer and callback routes. */
export interface CredentialToolSurfaces {
  readonly surfaceExchanges: SurfaceExchangeStore;
}
