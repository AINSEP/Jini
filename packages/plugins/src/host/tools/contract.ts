import type { AgentToolDefinition, HumanConfirmer, LegacyToolAuthorizeFn, ToolExecutionContext, ToolExecutionOptions, ToolHandler, ToolMetadataById, AccessApprovalResource } from '@jini-ai/core';
import type { Clock } from '@jini-ai/core/primitives';
import type { ModelFacingErrorRule } from '@jini-ai/core/model-facing-tool-errors';
import { type PluginActivationRecord, type PluginActivationRepoPort } from '../activation.js';
import { type PluginConflict } from '../plugin-claims.js';
import { type RemovePluginFn, type PluginUninstallPreview } from '../uninstall.js';
import { type PluginDiscoveryRecord } from '../discovery-types.js';
import { type PluginInstallInput, type PluginInstallerPort, type PluginInstallPreview } from '../node/install.js';
import { type PluginSourcePort } from '../node/source-drafts.js';

export type PluginFamily = 'site-runtime' | 'agent-plugin';
export interface SetEnabledRequest {
  readonly family: PluginFamily;
  readonly pluginId: string;
  readonly enabled: boolean;
}
export interface PluginToolRegistrationInput {
  readonly domain: string;
  readonly catalogModule: string;
  /** @agent-note Catalog names must match toolIds and its authorization permissions must match the supplied permission values. */
  readonly catalog: readonly AgentToolDefinition[];
  readonly metadata: ToolMetadataById;
}
export interface InstalledPluginRevision {
  readonly pluginId: string;
  readonly version?: OptionalValue<string>;
  readonly archiveDigest: string;
  /** @agent-note Supply skill names only because these values are serialized in the public list response. */
  readonly skills: readonly { 
  readonly name: string }[];
  readonly displayName?: OptionalValue<string>;
  readonly summary?: OptionalValue<string>;
  readonly description?: OptionalValue<string>;
  readonly hostRange?: OptionalValue<string>;
  readonly requires?: OptionalValue<readonly string[]>;
}
export type ClassifiedPluginError = { 
  kind: 'not-installed'; 
  message: string } | { 
  kind: 'host-incompatible' | 'update'; 
  code: string } | { 
  kind: 'unreadable' | 'busy'; 
  message: string };
export interface PluginApprovalPort<Description> {
  /** @agent-note Keep one authenticated actor/tool/exchange through preparation and execution, refusing mutation on missing transport, abort or an unanswered required approval; set-enabled constructs this handler at registration while uninstall constructs it per call. */
  handler<Prepared>(steps: {

  /** @agent-note Authorize before disclosing target facts and detach the proposal identity from mutable caller input. */
  prepare(required: { 
  ctx: ToolExecutionContext }, options: ToolExecutionOptions): Promise<Prepared>;

  describe(required: { 
  ctx: ToolExecutionContext; 
  prepared: Prepared }): Description | Promise<Description>;

  /** @agent-note Reauthorize and revalidate the frozen proposal after confirmation before performing the mutation. */
  run(required: { 
  ctx: ToolExecutionContext; 
  prepared: Prepared; 
  confirmer: HumanConfirmer; 
  choice?: string }, options: ToolExecutionOptions): Promise<unknown>;
  }, options?: { 
  /** @agent-note The flag names the false-valued result field returned when approval has no affirmative answer and declined is absent. */
  flag?: string; 
  /** @agent-note Returning false skips the human dialog and runs immediately, so permit that path only when the prepared action needs no escalation approval. */
  ask?: (required: { 
  prepared: Prepared }) => boolean; 
  /** @agent-note Replace the default no-answer result for declined, expired or abandoned approval without running the mutation. */
  declined?: (required: { 
  reason: 'declined' | 'expired' | 'abandoned'; 
  prepared?: Prepared }) => unknown }): ToolHandler;
  notConfirmed(outcome: { 
  confirmed: false; 
  reason: 'declined' | 'expired' | 'abandoned' }): { 
  cancelled: boolean; 
  reason?: 'expired' | 'abandoned'; 
  note: string };
}
export interface PluginLifecycleToolsPort {
  /** @agent-note Strict approval reads must refuse on missing capability while non-strict list reads may degrade softly. */
  inactivePluginIds?(required: { 
  strict: boolean }, optional?: Record<string, never>): Promise<ReadonlySet<string> | undefined>;
  previewEnableAccess?(required: { 
  pluginId: string }, optional?: Record<string, never>): Promise<{ 
  readonly key: string; 
  readonly resources?: readonly Omit<AccessApprovalResource, 'scope'>[] } | undefined>;
  /** @agent-note Record only a genuine declined answer through the same scoped connection owner. */
  recordDeclinedAccess?(required: { 
  accessKey: string }): Promise<void>;
  /** @agent-note A rejected listing empties the entire agentPlugins list response to isolate failure from the independently working runtime-plugin list. */
  listInstalled(required: Record<string, never>, optional?: Record<string, never>): Promise<readonly InstalledPluginRevision[]>;
  assertWritable(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
  /** @agent-note Share the workspace admission queue and activation repository with every other lifecycle writer. */
  setEnabled(required: { 
  workspaceId: string; 
  pluginId: string; 
  enabled: boolean; 
  actor: string }): Promise<{ 
  pluginId: string; 
  enabled: boolean; 
  warnings?: readonly string[] }>;
  /** @agent-note Provision only after successful enable and forward the approved access key unchanged. */
  provisionMcp(required: { 
  pluginId: string; 
  principalId: string }, optional: { 
  approvedEnable: boolean; 
  approvedEnableKey?: OptionalValue<string> }): Promise<void>;
  /** @agent-note Delegate the complete authorize, preview, confirm and remove sequence to the same lifecycle owner and authenticated exchange. */
  uninstall(required: { 
  ctx: ToolExecutionContext; 
  pluginId: string; 
  executionOptions: ToolExecutionOptions }, optional?: Record<string, never>): Promise<unknown>;
  searchCandidate(required: { 
  candidate: { 
  pluginId: string; 
  displayName?: OptionalValue<string>; 
  summary?: OptionalValue<string>;
  description?: OptionalValue<string>; 
  enabled: boolean; 
  keywords: readonly string[]; 
  skills: readonly never[]; 
  mcpServerIds: readonly string[] } }): { 
  pluginId: string; 
  enabled: boolean; 
  description?: OptionalValue<string> };
  /** @agent-note Check every supplied revision with the same host contract and active-provides policy without relisting by id. */
  compatibility(required: { 
  pluginId: string; 
  revisions: readonly InstalledPluginRevision[] }): { 
  code: string } | undefined;
  /** @agent-note Classify canonical host error classes and return undefined for unknown failures so their identity survives. */
  classifyError(required: { 
  error: unknown }): ClassifiedPluginError | undefined;
}
export interface PluginExportRow {

  readonly plugin: string; 
  readonly displayName?: OptionalValue<string>; 
  readonly component: string; 
  readonly version: number;

  readonly minVersion: number; 
  readonly props: unknown; 
  readonly consent: string; 
  readonly availability: string; 
  readonly snippet: string | null;
}
export interface PluginProviderFaceToolsPort {
  linkedProvider(required: { 
  pluginId: string }): Promise<string | undefined>;
  describeLinkedFace(required: { 
  pluginId: string; 
  providerPluginId: string }): { 
  code: string; 
  message: string; 
  providerPluginId: string };
  describeLinkedError(required: { 
  error: unknown }): { 
  code: string; 
  message: string; 
  providerPluginId: string } | undefined;
}
export interface PluginManagementMessages {

  readonly familyRequired: string;

  restartNote(required: SetEnabledRequest): string;

  changedSinceConfirmation(required: { 
  pluginId: string; 
  name: string; 
  version: string }): string;

  /** @agent-note Only PLUGIN_UPDATE_PENDING is recoverable by restart, so other update codes must not recommend restart recovery. */
  updatePendingNextStep(required: { 
  code: string }): string;

  hostIncompatibleNote(required: { 
  pluginId: string }): string;

  activationsUnreadableNote(required: { 
  pluginId: string; 
  enabled: boolean }): string;

  activationsBusyNote(required: { 
  pluginId: string; 
  enabled: boolean }): string;
}
export interface PluginToolCommand {

  readonly command: { 
  workspaceId: string; 
  actor: { 
  id: string; 
  kind: 'agent' }; 
  summary: string; 
  permission: string };

  readonly mutation: { 
  entityType: string; 
  entityId: string; 
  operation: 'update'; 
  captureInverse(): Promise<{ 
  enabled: boolean }>; 
  execute(): Promise<{ 
  activation: PluginActivationRecord }>; 
  /** @agent-note Restore the exact prior activation row or remove a newly created row, then restore its hooks. */
  rollback(): Promise<void> };
}
export interface PluginManagementToolsRequired<Description> {

  /** @agent-note List rejects all input, set-enabled requires family/pluginId/enabled and uninstall requires family/pluginId, with family exactly site-runtime or agent-plugin. */
  readonly registration: PluginToolRegistrationInput;

  readonly workspaceId: string;

  /** @agent-note Use the same permission evaluator before disclosure and again after human approval. */
  readonly authorize: LegacyToolAuthorizeFn;

  readonly permissions: { 
  read: string; 
  enable: string };

  readonly toolIds: { 
  list: string; 
  setEnabled: string; 
  uninstall: string };

  readonly entityTypes: { 
  plugin: string; 
  agentPlugin: string; 
  activation: string };

  readonly actorPluginId: string;

  readonly clock: Clock;

  /** @agent-note Share this workspace-scoped repository with other entry points so previews and writes observe the same activation state. */
  readonly pluginActivationRepo: PluginActivationRepoPort;

  readonly discoverPlugins: () => Promise<readonly PluginDiscoveryRecord[]>;

  readonly listPluginConflicts?: OptionalValue<(() => Promise<ReadonlyMap<string, readonly PluginConflict[]>>)>;

  readonly removePlugin: RemovePluginFn;

  /** @agent-note Record source approval before enabling and leave the plugin OFF if recording fails. */
  readonly pluginSource?: OptionalValue<Pick<PluginSourcePort, 'readApproval' | 'recordApproval'>>;

  readonly onPluginEnabled: (pluginId: string) => Promise<void>;

  readonly onPluginDisabled: (pluginId: string) => void;

  readonly agentPlugins: PluginLifecycleToolsPort;

  readonly pluginExports?: OptionalValue<{ 
  catalog(required: { 
  workspaceId: string }): Promise<ReadonlyMap<string, readonly PluginExportRow[]>> }>;

  readonly providerFaces: PluginProviderFaceToolsPort;

  /** @agent-note Invoke the shared Stop and roster owner only after durable OFF and propagate cleanup failure without claiming success. */
  readonly lowerToolAccess: (required: { 
  pluginId: string }) => Promise<void>;

  readonly extraModelFacingErrors: readonly ModelFacingErrorRule[];

  /** @agent-note Use the existing command gateway for authorization, audit, outbox and rollback rather than bypassing it with a direct writer. */
  readonly executeCommand: (required: PluginToolCommand) => Promise<{ 
  result: { 
  activation: PluginActivationRecord } }>;

  /** @agent-note Use the same fingerprint owner before and after approval and include every supplied revision and schema field. */
  readonly approvalFingerprint: (required: { 
  family: PluginFamily; 
  pluginId: string; 
  revision: string; 
  schema: Readonly<Record<string, unknown>> }) => string;

  readonly approvals: PluginApprovalPort<Description>;

  readonly descriptions: { 
  enable(required: { 
  subject: { 
  family: PluginFamily; 
  pluginId: string; 
  version?: OptionalValue<string>; 
  label?: OptionalValue<string>; 
  adds?: OptionalValue<readonly string[]>; 
  previousEnabled?: OptionalValue<boolean | null>; 
  revision?: OptionalValue<string>; 
  resources?: OptionalValue<readonly Omit<AccessApprovalResource, 'scope'>[]> }; 
  scope?: AccessApprovalResource['scope'] }): Description; 
  uninstall(required: { 
  preview: PluginUninstallPreview }): Description };

  readonly messages: PluginManagementMessages;

  readonly telemetry?: OptionalValue<{ 
  toggled(required: { 
  principalId: string; 
  pluginId: string; 
  enabled: boolean }): void }>;
}
export interface PluginInstallToolsRequired<Request> {

  readonly registration: PluginToolRegistrationInput;

  readonly workspaceId: string; 
  readonly authorize: LegacyToolAuthorizeFn;

  readonly toolId: string; 
  readonly permission: string; 
  readonly entityType: string;

  readonly parseRequest: (required: { 
  input: unknown }) => Request;

  readonly localInstallEnabled: () => boolean;

  readonly installInput: (required: { 
  request: Request; 
  ownerId: string; 
  runId: string }) => Promise<PluginInstallInput>;

  /** @agent-note Preview and install must throw this package's canonical PluginInstallError for relayable refusals, while other errors retain opaque failure handling. */
  readonly installer?: OptionalValue<PluginInstallerPort>;

  readonly riskSentence: (required: { 
  preview: PluginInstallPreview }) => string;

  readonly messages: { 
  readonly localInstallDisabledNote: string; 
  installedNote(required: { 
  name: string; 
  version: string }): string; 
  readonly retryInstallHint: string };

  readonly telemetry?: OptionalValue<{ 
  installed(required: { 
  principalId: string; 
  pluginId: string }): void; 
  installFailed(required: { 
  principalId: string; 
  reasonClass: 'refused' | 'internal' }): void }>;
}
export interface PluginSourceToolsRequired<Description> {

  readonly registration: PluginToolRegistrationInput;

  readonly workspaceId: string; 
  readonly authorize: LegacyToolAuthorizeFn;

  /** @agent-note Every operation reads id; create also reads name/description, read/write/edit/delete read path, write reads content, and edit reads oldString/newString plus optional replaceAll. */
  readonly toolIds: { 
  create: string; 
  open: string; 
  list: string; 
  read: string; 
  write: string; 
  edit: string; 
  delete: string; 
  seal: string; 
  rollback: string };

  readonly enablePermission: string; 
  readonly entityType: string;

  /** @agent-note Source operations must throw this package's canonical PluginSourceError or PluginInstallError for relayable refusals, while other errors retain opaque failure handling. */
  readonly pluginSource?: OptionalValue<PluginSourcePort>;

  readonly approvals: PluginApprovalPort<Description>;

  readonly describeDelete: (required: { 
  target: { 
  id: string; 
  path: string } }) => Description;
}

export type OptionalValue<T> = T | undefined;
