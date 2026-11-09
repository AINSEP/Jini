import type { AgentToolDefinition, HumanConfirmer, LegacyToolAuthorizeFn, ToolExecutionContext, ToolExecutionOptions, ToolHandler, ToolMetadataById, AccessApprovalResource } from '@jini-ai/core';
import type { Clock } from '@jini-ai/core/primitives';
import type { ModelFacingErrorRule } from '@jini-ai/core/model-facing-tool-errors';
import { type PluginActivationRecord, type PluginActivationRepoPort } from '../activation.js';
import { type PluginConflict } from '../plugin-claims.js';
import { type RemovePluginFn, type PluginUninstallPreview } from '../uninstall.js';
import { type PluginDiscoveryRecord } from '../discovery-types.js';
import { type PluginInstallInput, type PluginInstallerPort, type PluginInstallPreview } from '../node/install.js';
import { type PluginSourcePort } from '../node/source-drafts.js';

/** @agent-note Stable wire family tags, never inferred from an id; independently scoped hosts may share ids. */
export type PluginFamily = 'site-runtime' | 'agent-plugin';
/** @agent-note Detach input/principal/run before approval. Disabled proposals bind no enable identity. */
export interface SetEnabledRequest {
  /** @agent-note Preserve the caller's explicit family. */
  readonly family: PluginFamily;
  /** @agent-note Workspace-scoped public id, never an internal path. */
  readonly pluginId: string;
  /** @agent-note Every enable requires fresh human consent, even for previously approved bytes. */
  readonly enabled: boolean;
}
/** @agent-note Supply the existing catalog/metadata directly; ids, permissions and descriptors must agree. */
export interface PluginToolRegistrationInput {
  /** @agent-note Host domain is attribution, not authorization. */
  readonly domain: string;
  /** @agent-note Host diagnostic path, never guessed by this package. */
  readonly catalogModule: string;
  /** @agent-note Supply exact schema and prose bytes, including example URLs. */
  readonly catalog: readonly AgentToolDefinition[];
  /** @agent-note Keep the host's action policy and catalog bytes unchanged. */
  readonly metadata: ToolMetadataById;
}
/** @agent-note Only consumed public installed metadata; paths, files, handles and transports must not be supplied or serialized. */
export interface InstalledPluginRevision {
  /** @agent-note Public id is scoped by the injected lifecycle owner. */
  readonly pluginId: string;
  /** @agent-note Every installed version/digest participates in the approval revision. */
  readonly version?: OptionalValue<string>;
  /** @agent-note Preserve saved digest bytes exactly; no rehash or migration. */
  readonly archiveDigest: string;
  /** @agent-note Names only, never skill paths or bytes. */
  readonly skills: readonly { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly name: string }[];
  /** @agent-note Public display projection only; inactive descriptions must be redacted by the same owner. */
  readonly displayName?: OptionalValue<string>;
  /** @agent-note Public metadata; no secrets or internal paths. */
  readonly description?: OptionalValue<string>;
  /** @agent-note Compatibility checks use the same host contract, without guessing from a product version. */
  readonly hostRange?: OptionalValue<string>;
  /** @agent-note Advisory capabilities remain the lifecycle owner's vocabulary. */
  readonly requires?: OptionalValue<readonly string[]>;
}
/** @agent-note Canonical instanceof classification in the host; unknown errors return undefined and rethrow unchanged. Private messages are log-only for unreadable/busy. */
export type ClassifiedPluginError = { 
  /** @agent-note Stable plugin/core protocol discriminator, never host authorization or a substitute for canonical error identity. */
  kind: 'not-installed'; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  message: string } | { 
  /** @agent-note Stable plugin/core protocol discriminator, never host authorization or a substitute for canonical error identity. */
  kind: 'host-incompatible' | 'update'; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  code: string } | { 
  /** @agent-note Stable plugin/core protocol discriminator, never host authorization or a substitute for canonical error identity. */
  kind: 'unreadable' | 'busy'; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  message: string };
/** @agent-note Authorize before disclosure, reauthorize after the same authenticated explicit human answers. Abort/deny/timeout never mutates; missing transport fails closed. */
export interface PluginApprovalPort<Description> {
  /** @agent-note Forward the SAME actor/tool/exchange transport. Freeze prepared identity and detach request ownership; descriptions grant no authority. */
  handler<Prepared>(steps: {
    
  /** @agent-note Authorize before reads or disclosure and freeze the detached target/identity. Preflight failures must occur before human consent. */
  prepare(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  ctx: ToolExecutionContext }, options: ToolExecutionOptions): Promise<Prepared>;
    
  /** @agent-note Describe only the frozen prepared proposal; safe host copy is not authority and cannot replace authenticated approval. */
  describe(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  ctx: ToolExecutionContext; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  prepared: Prepared }): Description | Promise<Description>;
    
  /** @agent-note Reauthorize after the same explicit human answer, revalidate complete identity/digest, honor abort, then invoke the sole mutation owner. */
  run(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  ctx: ToolExecutionContext; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  prepared: Prepared; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  confirmer: HumanConfirmer; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  choice?: string }, options: ToolExecutionOptions): Promise<unknown>;
  }, options?: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  flag?: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  ask?: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  prepared: Prepared }) => boolean; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  declined?: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  reason: 'declined' | 'expired' | 'abandoned'; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  prepared?: Prepared }) => unknown }): ToolHandler;
  /** @agent-note Preserve the host's exact no-answer result bytes; never automatically reopen approval. */
  notConfirmed(outcome: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  confirmed: false; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  reason: 'declined' | 'expired' | 'abandoned' }): { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  cancelled: boolean; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  reason?: 'expired' | 'abandoned'; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  note: string };
}
/** @agent-note Bind operations lazily per call to the same workspace layout, activation owner and admission queue. Missing lifecycle refuses at call time, never during construction. */
export interface PluginLifecycleToolsPort {
  /** @agent-note List reads degrade softly without a capability; approval reads require it. Preserve absent optional-method behavior in both cases. */
  inactivePluginIds?(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  strict: boolean }, optional?: Record<string, never>): Promise<ReadonlySet<string> | undefined>;
  /** @agent-note Preview only safe public resources; preserve source/access identity bytes and no extra reads. */
  previewEnableAccess?(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string }, optional?: Record<string, never>): Promise<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly key: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly resources?: readonly Omit<AccessApprovalResource, 'scope'>[] } | undefined>;
  /** @agent-note Persist a genuine decline through the same connection owner only after its authenticated answer. */
  recordDeclinedAccess?(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  accessKey: string }): Promise<void>;
  /** @agent-note Same scoped owner and snapshot; disabled metadata stays private, no paths/handles escape. */
  listInstalled(required: Record<string, never>, optional?: Record<string, never>): Promise<readonly InstalledPluginRevision[]>;
  /** @agent-note First enable preflight, before linked-face and compatibility checks or a dialog. */
  assertWritable(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
  /** @agent-note Sole lifecycle writer, with authenticated principal and unchanged saved decision bytes. */
  setEnabled(required: { 
  /** @agent-note Use the same authenticated workspace and shared layout/repository/queue for every family; never infer scope from an id. */
  workspaceId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  actor: string }): Promise<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  warnings?: readonly string[] }>;
  /** @agent-note Only after successful enable; forward approvedEnable and approvedEnableKey exactly and preserve existing failure semantics. */
  provisionMcp(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  principalId: string }, optional: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  approvedEnable: boolean; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  approvedEnableKey?: OptionalValue<string> }): Promise<void>;
  /** @agent-note Delegate the ENTIRE permission/preview/consent/permanent workspace-removal order to the lifecycle owner; host closes over the same transport. */
  uninstall(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  ctx: ToolExecutionContext; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  executionOptions: ToolExecutionOptions }, optional?: Record<string, never>): Promise<unknown>;
  /** @agent-note Apply the same projection for both plugin families; inactive entries expose only off status and public identity. */
  searchCandidate(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  candidate: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  displayName?: OptionalValue<string>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  description?: OptionalValue<string>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  keywords: readonly string[]; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  skills: readonly never[]; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  mcpServerIds: readonly string[] } }): { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  description?: OptionalValue<string> };
  /** @agent-note Check EVERY revision in this supplied snapshot with the same contract and activeProvides policy; never relist by id. Return only canonical safe code. */
  compatibility(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  revisions: readonly InstalledPluginRevision[] }): { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  code: string } | undefined;
  /** @agent-note Canonical classes only, no duck typing; unknown failures retain identity. */
  classifyError(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  error: unknown }): ClassifiedPluginError | undefined;
}
/** @agent-note Caller-safe public export rows only; props are host-opaque validated schema data, never executable handles or custody-bearing fields. */
export interface PluginExportRow {
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly plugin: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly displayName?: OptionalValue<string>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly component: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly version: number;
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly minVersion: number; 
  /** @agent-note Host-opaque validated public schema data only, never secrets, host paths, executable handles or transports. */
  readonly props: unknown; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly consent: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly availability: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly snippet: string | null;
}
/** @agent-note Same canonical provider relationship owner; private lookup faults degrade only where the existing flow permits. */
export interface PluginProviderFaceToolsPort {
  /** @agent-note Linked face is refused before compatibility or consent; a failed lookup remains for the write owner to recheck. */
  linkedProvider(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string }): Promise<string | undefined>;
  /** @agent-note Safe public refusal, from the same relationship owner. */
  describeLinkedFace(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  providerPluginId: string }): { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  code: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  message: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  providerPluginId: string };
  /** @agent-note Use canonical owner identity, never error name/code matching. */
  describeLinkedError(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  error: unknown }): { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  code: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  message: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  providerPluginId: string } | undefined;
}
/** @agent-note Host copy names its own tools, permissions, product and paths; preserve existing result bytes, never fabricate operational guidance. */
export interface PluginManagementMessages {
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly familyRequired: string;
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  restartNote(required: SetEnabledRequest): string;
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  changedSinceConfirmation(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  name: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  version: string }): string;
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  updatePendingNextStep(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  code: string }): string;
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  hostIncompatibleNote(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string }): string;
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  activationsUnreadableNote(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean }): string;
  
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  activationsBusyNote(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean }): string;
}
/** @agent-note The same command gateway as the host route owns authorization/audit/outbox; no direct writer may replace it. Inverse and rollback restore the exact prior row or delete a new row, then restore hooks. */
export interface PluginToolCommand {
  
  /** @agent-note Keep the same workspace, authenticated actor, permission and exact audit summary bytes at the existing command gateway. */
  readonly command: { 
  /** @agent-note Use the same authenticated workspace and shared layout/repository/queue for every family; never infer scope from an id. */
  workspaceId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  actor: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  id: string; 
  /** @agent-note Stable plugin/core protocol discriminator, never host authorization or a substitute for canonical error identity. */
  kind: 'agent' }; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  summary: string; 
  /** @agent-note Required host permission; check with the same evaluator before parsing, reading or any dialog. */
  permission: string };
  
  /** @agent-note Preserve captureInverse, execute and rollback ordering; no durable mutation may bypass the gateway or its compensation. */
  readonly mutation: { 
  /** @agent-note Use the host's exact entity scope for permission checks before reads or writes. */
  entityType: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  entityId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  operation: 'update'; 
  /** @agent-note Capture the exact prior activation through the same owner before mutation; no extra reads or saved-byte changes. */
  captureInverse(): Promise<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean }>; 
  /** @agent-note Invoke the same activation owner and hooks, preserving saved bytes, counts and failure identity. */
  execute(): Promise<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  activation: PluginActivationRecord }>; 
  /** @agent-note Restore the exact previous row or remove a new row, then restore hooks; preserve rollback failure semantics. */
  rollback(): Promise<void> };
}
/** @agent-note Local plugin-management seam. Same workspace-scoped repository/queue/all-family admission. Authorize before reads/dialog and after approval; fresh human consent for EVERY enable. Preflight writable→linked face→compatibility; reread complete version/digest/source/access identity after answer. Record site approval BEFORE enable (failed record leaves OFF); provision only after successful enable. OFF is durable before lowering linked faces; cleanup failure cannot claim success. Site uninstall previews before dialog, rediscovers name/version and uses shared Trash; agent uninstall stays with its lifecycle owner. No saved-byte changes, extra I/O, decrypts, telemetry, or optimizations. */
export interface PluginManagementToolsRequired<Description> {
  
  /** @agent-note Supply the exact host catalog, metadata, schemas and prose. Descriptor, dispatch, permission and risk ids must agree without defaults. */
  readonly registration: PluginToolRegistrationInput;
  
  /** @agent-note Use the same authenticated workspace and shared layout/repository/queue for every family; never infer scope from an id. */
  readonly workspaceId: string;
  
  /** @agent-note Bind the same host evaluator. Authorize before disclosure/dialog, reauthorize after authenticated approval, and preserve the original denial. */
  readonly authorize: LegacyToolAuthorizeFn;
  
  /** @agent-note Host permission names are required input; use the same values for descriptor and execution checks. */
  readonly permissions: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  read: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enable: string };
  
  /** @agent-note Host ids are required input for every operation; never replace them with this package or another host's names. */
  readonly toolIds: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  list: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  setEnabled: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  uninstall: string };
  
  /** @agent-note Supply the host entity scopes for both families and the activation mutation; preserve the same permission evaluator. */
  readonly entityTypes: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  plugin: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  agentPlugin: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  activation: string };
  
  /** @agent-note Supply the existing host actor attribution; preserve audit/saved bytes and never infer authority from the name. */
  readonly actorPluginId: string;
  
  /** @agent-note Bind the existing host clock; do not introduce a second time owner or rewrite saved timestamps. */
  readonly clock: Clock;
  
  /** @agent-note Use the same workspace-scoped activation repository as routes. Rollback restores its exact prior row or deletes a new row. */
  readonly pluginActivationRepo: PluginActivationRepoPort;
  
  /** @agent-note Reuse the existing discovery owner and exact snapshot at the approval boundary; no extra reads or relist-by-id optimization. */
  readonly discoverPlugins: () => Promise<readonly PluginDiscoveryRecord[]>;
  
  /** @agent-note Reuse the same conflict owner; a missing optional callback means the same empty-map behavior. */
  readonly listPluginConflicts?: OptionalValue<(() => Promise<ReadonlyMap<string, readonly PluginConflict[]>>)>;
  
  /** @agent-note Use the same shared-workspace Trash removal binding; agent permanent removal belongs wholly to its lifecycle owner. */
  readonly removePlugin: RemovePluginFn;
  
  /** @agent-note Use the existing source/approval owner. Record site approval before enabling; failed approval leaves OFF. Preserve saved/sealed bytes and rollback history. */
  readonly pluginSource?: OptionalValue<Pick<PluginSourcePort, 'readApproval' | 'recordApproval'>>;
  
  /** @agent-note Bind the same enable hooks and gateway; rollback restores previous hooks and durable activation state. */
  readonly onPluginEnabled: (pluginId: string) => Promise<void>;
  
  /** @agent-note Persist OFF before lowering linked faces; rollback restores previous hooks. Never claim cleanup success after Stop failure. */
  readonly onPluginDisabled: (pluginId: string) => void;
  
  /** @agent-note Bind the same lazy workspace lifecycle owner. Preserve soft listing versus strict approval reads, canonical errors, all-revision identity, and full delegated uninstall order. */
  readonly agentPlugins: PluginLifecycleToolsPort;
  
  /** @agent-note Supply only existing caller-safe public export rows; read failures degrade to the same empty map. Never supply package paths, secrets or render handles. */
  readonly pluginExports?: OptionalValue<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  catalog(required: { 
  /** @agent-note Use the same authenticated workspace and shared layout/repository/queue for every family; never infer scope from an id. */
  workspaceId: string }): Promise<ReadonlyMap<string, readonly PluginExportRow[]>> }>;
  
  /** @agent-note Bind the same provider relationship owner. Writable activations precede linked-face checks, which precede compatibility and any dialog. */
  readonly providerFaces: PluginProviderFaceToolsPort;
  
  /** @agent-note Call the existing Stop/roster owner only after durable OFF. Cleanup failure must retain its canonical error and cannot report success. */
  readonly lowerToolAccess: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string }) => Promise<void>;
  
  /** @agent-note Bind existing canonical host classes and exact safe copy; unknown failures rethrow unchanged and private error detail stays in server logs. */
  readonly extraModelFacingErrors: readonly ModelFacingErrorRule[];
  
  /** @agent-note Bind the SAME route command gateway with existing clock/idGen/outbox/changeSets/authorize. Preserve inverse/rollback and no extra writes or telemetry. */
  readonly executeCommand: (required: PluginToolCommand) => Promise<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  result: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  activation: PluginActivationRecord } }>;
  
  /** @agent-note Bind the existing fingerprint owner and exact domain/connection/tool/schema/annotation/description bytes. Preserve sorted full revision/digest/source/access identity; no migration or new hash. */
  readonly approvalFingerprint: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  family: PluginFamily; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  revision: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  schema: Readonly<Record<string, unknown>> }) => string;
  
  /** @agent-note Forward the SAME authenticated actor/tool/exchange transport. Only explicit active-human approval grants access; abort/deny/timeout never mutates and missing transport fails closed. */
  readonly approvals: PluginApprovalPort<Description>;
  
  /** @agent-note Host-opaque safe descriptions only; presentation grants no authority and must describe the frozen proposal and all added access. */
  readonly descriptions: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enable(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  subject: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  family: PluginFamily; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  version?: OptionalValue<string>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  label?: OptionalValue<string>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  adds?: OptionalValue<readonly string[]>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  previousEnabled?: OptionalValue<boolean | null>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  revision?: OptionalValue<string>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  resources?: OptionalValue<readonly Omit<AccessApprovalResource, 'scope'>[]> }; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  scope?: AccessApprovalResource['scope'] }): Description; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  uninstall(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  preview: PluginUninstallPreview }): Description };
  
  /** @agent-note Supply exact host runtime copy, including tool names, paths and products; never synthesize recovery advice or expose private diagnostics. */
  readonly messages: PluginManagementMessages;
  
  /** @agent-note Bind the existing optional callbacks and exact event/property bytes; preserve event counts, including failures, with no additional capture. */
  readonly telemetry?: OptionalValue<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  toggled(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  principalId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  enabled: boolean }): void }>;
}
/** @agent-note Authorize→parse→per-call policy→preview→install(expectedDigest). Host owns attachment owner/run/byte checks and opaque refs, never expose paths. Install stays OFF with exact trust warning, no new card, one telemetry event per existing outcome. */
export interface PluginInstallToolsRequired<Request> {
  
  /** @agent-note Supply the exact host catalog, metadata, schemas and prose. Descriptor, dispatch, permission and risk ids must agree without defaults. */
  readonly registration: PluginToolRegistrationInput;
  
  /** @agent-note Use the same authenticated workspace and shared layout/repository/queue for every family; never infer scope from an id. */
  readonly workspaceId: string; 
  /** @agent-note Bind the same host evaluator. Authorize before disclosure/dialog, reauthorize after authenticated approval, and preserve the original denial. */
  readonly authorize: LegacyToolAuthorizeFn;
  
  /** @agent-note Required host tool id; descriptor, risk, dispatch and approved exchange must use the same identity. */
  readonly toolId: string; 
  /** @agent-note Required host permission; check with the same evaluator before parsing, reading or any dialog. */
  readonly permission: string; 
  /** @agent-note Use the host's exact entity scope for permission checks before reads or writes. */
  readonly entityType: string;
  
  /** @agent-note Host owns request/attachment parsing and opaque refs; authorize first and never convert a model ref to an unchecked host path. */
  readonly parseRequest: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  input: unknown }) => Request;
  
  /** @agent-note Read the existing deployment policy per call after parsing, before preview; construction performs no policy read. */
  readonly localInstallEnabled: () => boolean;
  
  /** @agent-note Host checks attachment owner/run/byte limits and produces the existing installer input without exposing paths or secrets. */
  readonly installInput: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  request: Request; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  ownerId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  runId: string }) => Promise<PluginInstallInput>;
  
  /** @agent-note Bind the same installer. Preview first, then install with expectedDigest; always leave newly installed packages OFF. */
  readonly installer?: OptionalValue<PluginInstallerPort>;
  
  /** @agent-note Return the existing trust warning bytes for the exact preview; no new install card or trust inference. */
  readonly riskSentence: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  preview: PluginInstallPreview }) => string;
  
  /** @agent-note Supply exact host runtime copy, including tool names, paths and products; never synthesize recovery advice or expose private diagnostics. */
  readonly messages: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly localInstallDisabledNote: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  installedNote(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  name: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  version: string }): string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  readonly retryInstallHint: string };
  
  /** @agent-note Bind the existing optional callbacks and exact event/property bytes; preserve event counts, including failures, with no additional capture. */
  readonly telemetry?: OptionalValue<{ 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  installed(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  principalId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string }): void; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  installFailed(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  principalId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  reasonClass: 'refused' | 'internal' }): void }>;
}
/** @agent-note Source owner alone writes/seals/rolls back packages; no saved-byte or history changes. Delete freezes target/prior digest, reauthorizes after SAME authenticated human answer, then deletes only with expectedDigest. No disclosure before authorization. */
export interface PluginSourceToolsRequired<Description> {
  
  /** @agent-note Supply the exact host catalog, metadata, schemas and prose. Descriptor, dispatch, permission and risk ids must agree without defaults. */
  readonly registration: PluginToolRegistrationInput;
  
  /** @agent-note Use the same authenticated workspace and shared layout/repository/queue for every family; never infer scope from an id. */
  readonly workspaceId: string; 
  /** @agent-note Bind the same host evaluator. Authorize before disclosure/dialog, reauthorize after authenticated approval, and preserve the original denial. */
  readonly authorize: LegacyToolAuthorizeFn;
  
  /** @agent-note Host ids are required input for every operation; never replace them with this package or another host's names. */
  readonly toolIds: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  create: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  open: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  list: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  read: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  write: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  edit: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  delete: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  seal: string; 
  /** @agent-note Restore the exact previous row or remove a new row, then restore hooks; preserve rollback failure semantics. */
  rollback: string };
  
  /** @agent-note Required host write permission, checked again after approval; per-tool non-delete permissions still come from the supplied catalog. */
  readonly enablePermission: string; 
  /** @agent-note Use the host's exact entity scope for permission checks before reads or writes. */
  readonly entityType: string;
  
  /** @agent-note Use the existing source/approval owner. Record site approval before enabling; failed approval leaves OFF. Preserve saved/sealed bytes and rollback history. */
  readonly pluginSource?: OptionalValue<PluginSourcePort>;
  
  /** @agent-note Forward the SAME authenticated actor/tool/exchange transport. Only explicit active-human approval grants access; abort/deny/timeout never mutates and missing transport fails closed. */
  readonly approvals: PluginApprovalPort<Description>;
  
  /** @agent-note Describe the frozen target with the same authenticated exchange; reauthorize and delete only with its prior digest after the human answer. */
  readonly describeDelete: (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  target: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  id: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  path: string } }) => Description;
}

/** @agent-note Optional host metadata may explicitly carry undefined under either TypeScript optional-property mode. */
export type OptionalValue<T> = T | undefined;
