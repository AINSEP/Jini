import type { AgentToolDefinition, DerivedRiskByToolId, ToolMetadataById, ToolExecutionContext, ToolExecutionOptions, SurfaceAskThenReport, SurfaceExchangeStore } from '@jini-ai/core';
import type { Clock } from '@jini-ai/core/primitives';
import type { SurfaceCardsPort, SurfaceCardSecretForm } from '@jini-ai/core/contracts/cards';
import type { CredentialedRequestRequired, CredentialedRequestOptional, CredentialedRequestResult, CredentialedRequestPort } from '@jini-ai/core/contracts/credentials';
import type { DeployOpsRegistry, DeployOpsSecretAppliesOn } from './ops-contracts.js';
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export type SecretValueSource = { kind: "site-key" } | { kind: "secret"; name: string } | { kind: "typed" };
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export interface SecretTargetInput { platform: string; target: string; credentialLabel?: string }
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export interface SetSecretInput extends SecretTargetInput { name: string; source: SecretValueSource; dryRun?: boolean }
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export interface UnsetSecretInput extends SecretTargetInput { name: string }
/** `unknown`: the secret may exist but cannot be compared or ruled out by a complete listing. */
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export type SecretComparison = "same" | "different" | "absent" | "unknown";
/** What a human is asked to approve; fixed before the card is drawn. */
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export interface SecretConfirmRequest { action: "overwrite" | "remove"; platform: string; target: string; name: string; source?: string; comparison?: SecretComparison; appliesOn: DeployOpsSecretAppliesOn }
/** The model-facing shape of a card the human did not confirm (`notConfirmedResult`). */
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export interface SecretNotConfirmed { cancelled: boolean; reason?: "expired" | "abandoned"; note: string }
/** The tool layer's card. A refusal carries the model-facing not-confirmed result to spread into the reply. */
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export type SecretConfirm = (request: SecretConfirmRequest) => Promise<{ confirmed: true } | { confirmed: false; result: SecretNotConfirmed }>;
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
interface SecretWriteResultBase extends Partial<SecretNotConfirmed> {
  platform: string; target: string; name: string; appliesOn: DeployOpsSecretAppliesOn; supportsStaging: boolean; deployNeeded: boolean; summary?: string; version?: string;
}
/** Never carries a value: only the comparison verdict and a one-way fingerprint. */
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export interface SetSecretResult extends SecretWriteResultBase {
  source: SecretValueSource; comparison: SecretComparison; fingerprint: string; fingerprintKind: "site-key" | "sha256"; changed: boolean; dryRun?: true;
}
/** @agent-note Stable secret metadata only; never put plaintext values in results. Confirmation is human-only and fixed before the card opens. */
export interface UnsetSecretResult extends SecretWriteResultBase { removed: boolean }


/** @agent-note Host adapter uses its existing guarded no-redirect HTTP client, repo, sealer, clock, audit and scheme loader. Recheck abort at actual I/O after any auth-scheme await; forward signal, enforce maxResponseBytes and report truncation even if clipped text parses as JSON. */
export interface DeployOpsBoundedRequest {
  /** @agent-note One call, no retry; preserve redaction and the transport truncation flag. */
  request(required: CredentialedRequestRequired & { maxResponseBytes: number }, optional: CredentialedRequestOptional & { signal?: AbortSignal | undefined }): Promise<CredentialedRequestResult & { bodyTruncated: boolean }>;
}
/** @agent-note Monotonic clock and abortable sleep; remove timers/listeners on every completion. Module sleeps cap at 5s, wait at 300s. */
export interface WaitClock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }
/** @agent-note Preserve the issued diagnostic object unchanged, including non-enumerable authority/provenance. Never reconstruct it from these public fields. */
export interface DeployCredentialDiagnostic { readonly setupToolId?: string; readonly prefill?: Readonly<Record<string,string|number|boolean|null>>; readonly hint?: string; readonly remedyToolId?: string }
/** @agent-note Required tool routing and cross-tool prose. Supply the host's exact ids; no defaults are provided. */
export interface DeployOpsToolIds { status: string; logs: string; wait: string; listTargets: string; deploy: string; listSecrets: string; setSecret: string; unsetSecret: string; credentialVerify: string }
/** @agent-note Every callback is scoped to one existing host workspace. No cache or alternate service: fresh registry and credential metadata per invocation; never decrypt for inventory/target resolution. Site key is reread each call and fingerprint uses the host Security projection or exact UTF-8 digest. */
export interface DeployOpsRuntime {
  workspaceId: string;
  clock: Clock;
  loadDeployOps(input: {workspaceId:string}): Promise<DeployOpsRegistry>;
  loadDeployWorkflowFiles?: ((input:{workspaceId:string})=>Promise<readonly string[]>) | undefined;
  waitClock?: WaitClock | undefined;
  credentials: DeployOpsBoundedRequest & Pick<CredentialedRequestPort,'resolveTarget'|'classifyError'> & {
    /** @agent-note Return only non-decrypting label/origin metadata from the same saved store. */
    list(required: Record<string,never>, optional?: Record<string,never>): Promise<readonly {label:string; allowedOrigins:readonly string[]}[]>;
    available: boolean;
  };
  siteKey: {
    /** @agent-note Reread ordered active host sources each call; no model access. */
    read(required: Record<string,never>, optional?: Record<string,never>): string | undefined;
    /** @agent-note Exact existing site-key projection; otherwise first 12 hex SHA256 of exact UTF-8, never trim. */
    fingerprint(required:{value:string}, optional?:Record<string,never>): {fingerprint:string;fingerprintKind:'site-key'|'sha256'};
  };
  publishHistoryStore?: {
    /** @agent-note Record only accepted dispatch, exact fields; failure cannot cause a retry or echo secrets. */
    recordSuccess(input:{workspaceId:string;entry:{kind:'deploy';target:string;projectName:string;url:string;reachable:false;status:'started';publishedAt:string;triggeredBy:'agent_tool'}}): Promise<unknown>;
  } | undefined;
  recovery: {
    /** @agent-note Bind existing issuer/message; return issued diagnostic with identity and provenance intact. Never echo provider/vault data. */
    setupRequired(required:{label:string;baseUrl:string}): {message:string;credentialSetup:DeployCredentialDiagnostic};
  };
  toolIds: DeployOpsToolIds;
  messages: {
    noUsableSiteKey: string;
    severalCredentials(required:{host:string;labels:readonly string[]}): string;
    noSavedCredential(required:{label:string}): string;
  };
}
/** @agent-note Host supplies card builders (typically UI) and askThenReport (typically daemon), and the SAME actor-bound exchange store used by its answer route. Keystrokes travel browser→answer→exchange→provider only. Outcome replaces the same URI after save; fixed safeError never reflects submitted bytes. */
export interface DeployOpsSecretCards {
  defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'];
  askThenReport: SurfaceAskThenReport;
  surfaceExchanges?: Pick<SurfaceExchangeStore,'open'> | undefined;
  uriHost: string;
  defaultLocale: string;
  noEmitter: string;
  locale(required:{ctx:ToolExecutionContext}): Promise<string>;
  form(required:{locale:string;title:string}): SurfaceCardSecretForm;
  text(required:{locale:string;id:'storage'|'savedTitle'}): string;
}
/** @agent-note Supply reviewed host catalog/metadata/risk/domain/entity/path and every permission explicitly. Permit before registry, credential, site-key or network access. Approval uses explicit human on same actor-bound exchange, freezes request, rechecks write permission after answer; deny/abort means no mutation. Undefined means no interactive surface. */
export interface DeployOpsRegistrationHost {
  catalog: readonly AgentToolDefinition[];
  metadata: ToolMetadataById;
  derivedRisk: DerivedRiskByToolId;
  domain: string;
  catalogModule: string;
  permissions: {write:string;siteKey:string};
  /** @agent-note Preserve the host evaluator's canonical refusal class and entity scope. */
  permit(required:{ctx:ToolExecutionContext;permission:string}, optional?:Record<string,never>):Promise<void>;
  approvals: {
    /** @agent-note Same store/principal/run; freeze public request, recheck write grant after answer; deny/abort never mutates. */
    confirmFor(required:{ctx:ToolExecutionContext;permit:(permission:string)=>Promise<void>}, optional:ToolExecutionOptions):SecretConfirm|undefined;
  };
  cards: DeployOpsSecretCards;
}
