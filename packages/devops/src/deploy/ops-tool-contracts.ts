import type { AgentToolDefinition, DerivedRiskByToolId, ToolMetadataById, ToolExecutionContext, ToolExecutionOptions, SurfaceAskThenReport, SurfaceExchangeStore } from '@jini-ai/core';
import type { Clock } from '@jini-ai/core/primitives';
import type { SurfaceCardsPort, SurfaceCardSecretForm } from '@jini-ai/core/contracts/cards';
import type { CredentialedRequestRequired, CredentialedRequestOptional, CredentialedRequestResult, CredentialedRequestPort } from '@jini-ai/core/contracts/credentials';
import type { DeployOpsRegistry, DeployOpsSecretAppliesOn } from './ops-contracts.js';

export type SecretValueSource = { kind: "site-key" } | { kind: "secret"; name: string } | { kind: "typed" };

export interface SecretTargetInput { platform: string; target: string; credentialLabel?: string | undefined }
/** @agent-note A source names metadata only, while a typed value must arrive separately from the authenticated human card and never model input. */
export interface SetSecretInput extends SecretTargetInput { name: string; source: SecretValueSource; dryRun?: boolean }

export interface UnsetSecretInput extends SecretTargetInput { name: string }
/** `unknown`: the secret may exist but cannot be compared or ruled out by a complete listing. */
export type SecretComparison = "same" | "different" | "absent" | "unknown";
/** What a human is asked to approve; fixed before the card is drawn. */
export interface SecretConfirmRequest { action: "overwrite" | "remove"; platform: string; target: string; name: string; source?: string; comparison?: SecretComparison; appliesOn: DeployOpsSecretAppliesOn }
/** The model-facing shape of a card the human did not confirm (`notConfirmedResult`). */
export interface SecretNotConfirmed { cancelled: boolean; reason?: "expired" | "abandoned"; note: string }
/** The tool layer's card. A refusal carries the model-facing not-confirmed result to spread into the reply. */
/** @agent-note A declined, expired or abandoned human answer must produce no provider mutation. */
export type SecretConfirm = (request: SecretConfirmRequest) => Promise<{ confirmed: true } | { confirmed: false; result: SecretNotConfirmed }>;

interface SecretWriteResultBase extends Partial<SecretNotConfirmed> {
  platform: string; target: string; name: string; appliesOn: DeployOpsSecretAppliesOn; supportsStaging: boolean; deployNeeded: boolean; summary?: string; version?: string;
}
/** Never carries a value: only the comparison verdict and a one-way fingerprint. */
export interface SetSecretResult extends SecretWriteResultBase {
  source: SecretValueSource; comparison: SecretComparison; fingerprint: string; fingerprintKind: "site-key" | "sha256"; changed: boolean; dryRun?: true;
}

export interface UnsetSecretResult extends SecretWriteResultBase { removed: boolean }
/** @agent-note After awaiting auth schemes, recheck abort at actual I/O, forward the signal, enforce maxResponseBytes and preserve transport truncation without retries. */
export interface DeployOpsBoundedRequest {

  request(required: CredentialedRequestRequired & { maxResponseBytes: number }, optional: CredentialedRequestOptional & { signal?: AbortSignal | undefined }): Promise<CredentialedRequestResult & { bodyTruncated: boolean }>;
}
/** @agent-note Use a monotonic clock and abortable sleep that removes timers and listeners on every completion. */
export interface WaitClock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }
/** @agent-note Preserve the issued diagnostic object identity, including its non-enumerable authority and provenance. */
export interface DeployCredentialDiagnostic { readonly setupToolId?: string; readonly prefill?: Readonly<Record<string,string|number|boolean|null>>; readonly hint?: string; readonly remedyToolId?: string }

export interface DeployOpsToolIds { status: string; logs: string; wait: string; listTargets: string; deploy: string; listSecrets: string; setSecret: string; unsetSecret: string; credentialVerify: string }
/** @agent-note Use the SAME workspace and saved store as host request routes so inventory and target authorization describe the same credentials. */
export interface DeployOpsRuntime {
  workspaceId: string;
  clock: Clock;
  loadDeployOps(input: {workspaceId:string}): Promise<DeployOpsRegistry>;
  loadDeployWorkflowFiles?: ((input:{workspaceId:string})=>Promise<readonly string[]>) | undefined;
  waitClock?: WaitClock | undefined;
  credentials: DeployOpsBoundedRequest & Pick<CredentialedRequestPort,'resolveTarget'|'classifyError'> & {
    /** @agent-note Return non-decrypting metadata with exact HTTPS origins such as https://host without a trailing slash, read only when no explicit credential label is supplied. */
    list(required: Record<string,never>, optional?: Record<string,never>): Promise<readonly {label:string; allowedOrigins:readonly string[]}[]>;
    available: boolean;
  };
  siteKey: {
    /** @agent-note Reread the ordered active host key sources on each call without exposing key material to the model. */
    read(required: Record<string,never>, optional?: Record<string,never>): string | undefined;
    /** @agent-note Use the host key projection for a recognized key, otherwise the first 12 SHA256 hex characters of exact UTF-8 bytes without trimming. */
    fingerprint(required:{value:string}, optional?:Record<string,never>): {fingerprint:string;fingerprintKind:'site-key'|'sha256'};
  };
  publishHistoryStore?: {
    /** @agent-note A history failure must never retry an accepted dispatch or disclose secret material. */
    recordSuccess(input:{workspaceId:string;entry:{kind:'deploy';target:string;projectName:string;url:string;reachable:false;status:'started';publishedAt:string;triggeredBy:'agent_tool'}}): Promise<unknown>;
  } | undefined;
  recovery: {
    /** @agent-note Return the original issued diagnostic with its identity and provenance intact, without provider or vault data. */
    setupRequired(required:{label:string;baseUrl:string}): {message:string;credentialSetup:DeployCredentialDiagnostic};
  };
  toolIds: DeployOpsToolIds;
  messages: {
    noUsableSiteKey: string;
    severalCredentials(required:{host:string;labels:readonly string[]}): string;
    noSavedCredential(required:{label:string}): string;
  };
}
/** @agent-note Use the same actor-bound exchange store as the answer route, and emit the outcome on the same URI only after the save completes. */
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

export interface DeployOpsRegistrationHost {
  /** @agent-note Catalog names must equal toolIds values, with handler keys platform/target/credentialLabel for secret inventory, additionally name for unset and name/source/dryRun for set; deployment uses platform/target/ref/workflowFile/credentialLabel, target inventory uses platform/credentialLabel/org, status uses platform/target/credentialLabel/runId/branch, logs adds limit, and wait adds until/timeoutSeconds. */
  catalog: readonly AgentToolDefinition[];
  metadata: ToolMetadataById;
  derivedRisk: DerivedRiskByToolId;
  domain: string;
  catalogModule: string;
  permissions: {write:string;siteKey:string};
  /** @agent-note Preserve the host evaluator's canonical refusal class and entity scope. */
  permit(required:{ctx:ToolExecutionContext;permission:string}, optional?:Record<string,never>):Promise<void>;
  approvals: {
    /** @agent-note Freeze the public request on the same actor-bound exchange; the callback rechecks write permission after the human answer and denies every declined or aborted mutation. */
    confirmFor(required:{ctx:ToolExecutionContext;permit:(permission:string)=>Promise<void>}, optional:ToolExecutionOptions):SecretConfirm|undefined;
  };
  cards: DeployOpsSecretCards;
}
