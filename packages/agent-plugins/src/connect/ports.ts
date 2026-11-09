/** Consumer-owned service boundaries. Composition binds concrete services and secret stores. */
import type { ExternalMcpAccessSnapshot, ExternalMcpApprovedAccess, ExternalMcpOAuthStatus, ExternalMcpServerRecord, ExternalMcpServerRepoPort, ExternalMcpServerView, SaveExternalMcpServerInput } from '@jini-ai/core/contracts/hosted-mcp';
import type { SealedSecret } from '@jini-ai/core/contracts/vault';

/** Roster persistence and safe classification; sealing/keyring dependencies stay in composition. */
/** @agent-note `Lowered` is the host's own tool-access change record type (opaque to this package). */
export interface AgentPluginMcpPort<Lowered = unknown> {
  readonly repo: AgentPluginMcpRepo;
  /** Atomically save exactly the approved source and previous grants through the store owner. */
  applyAccess(input: ExternalMcpApprovedAccess, options?: Record<string, never>): Promise<void>;
  saveServer(input: AgentPluginMcpSave, options?: Record<string, never>): Promise<AgentPluginMcpView>;
  classifyError(input: { error: unknown }, options?: Record<string, never>): "validation" | "unconfigured" | "other";
  /** @agent-note `lowered` is the host's own tool-access change record (opaque here; this package only
   * ever calls it with `{}` after provisioning settles). One roster notifier per host, shared by admin and chat enable. */
  notifyRosterChanged(input: { readonly lowered?: Lowered }, options?: Record<string, never>): Promise<void>;
}

/** @agent-note These aliases name the canonical `@jini-ai/core/contracts/hosted-mcp` rows. Never copy the record,
 * access snapshot or repository: adoption must retain the canonical store's whole saved row. */
export type AgentPluginMcpRecord = ExternalMcpServerRecord;
export type AgentPluginMcpSave = SaveExternalMcpServerInput;
/** @agent-note The host's token-hint shape stays opaque here (`unknown`); this package never reads it. */
export type AgentPluginMcpView = ExternalMcpServerView<unknown>;
export type AgentPluginMcpRepo = Pick<ExternalMcpServerRepoPort, 'findByServerId' | 'upsert' | 'deleteByServerId' | 'updateAccessIfCurrent'>;
export type AgentPluginMcpAccessSnapshot = ExternalMcpAccessSnapshot;
/** @agent-note A second host supplies all six projections together with the paired
 * {@link AgentPluginMcpProjectionPorts.classifyError}; preview, provisioning, sign-in revalidation and
 * status reads must all receive the SAME object, never a per-call default. */
export interface AgentPluginMcpProjections {
  /** @agent-note The canonical saved representation of a row's admitted source. The snapshot must be
   * JSON-serializable with a stable key order: approval revalidation compares JSON.stringify of the
   * previewed and re-read snapshots byte-for-byte, so any reordering refuses a valid approval. */
  readonly accessSnapshot: (required: { record: AgentPluginMcpRecord }, optional?: Record<string, never>) => AgentPluginMcpAccessSnapshot;
  /** @agent-note Canonical saved admission revision; same stability rule as `accessSnapshot`. */
  readonly admissionRevision: (record: AgentPluginMcpRecord) => string;
  /** @agent-note With `{ strict: true }` an unreadable stored list throws; it never reads as an empty
   * or fresh grant, which would silently widen or drop an existing grant. */
  readonly readToolGrants: (record: Pick<AgentPluginMcpAccessSnapshot, 'allowedToolNames' | 'writeAllowedToolNames'>, options?: { strict?: boolean }) => { allowedToolNames: string[]; writeAllowedToolNames: string[] };
  /** @agent-note Throws an error the paired `classifyError` reports as `'validation'`; its message is
   * the public repair reason shown to the model, so it must never carry credential material. */
  readonly validateToolNames: (required: { names: readonly string[]; field: string }, optional?: Record<string, never>) => string[];
  /** @agent-note Pure: no I/O, no cache, never opens sealed credential material (status reads stay token-free). */
  readonly oauthStatus: (record: { oauthStatus: string | null }) => ExternalMcpOAuthStatus;
  /** @agent-note Pure: no I/O, no cache, never opens sealed credential material (status reads stay token-free). */
  readonly hasStaticAccessToken: (record: { authMode: string; sealedOAuth: SealedSecret | null }) => boolean;
}
/** @agent-note Bound once per binding/factory and passed whole: a host never supplies one half. */
export interface AgentPluginMcpProjectionPorts {
  readonly projections: AgentPluginMcpProjections;
  /** @agent-note Paired with `projections.validateToolNames`: whatever it throws classifies as
   * `'validation'`. Classification alone does not redact; consumers redact before model text. */
  readonly classifyError: AgentPluginMcpPort['classifyError'];
}
/** New composition must fulfill the full contract. */
export interface AgentPluginMcpServicesPort<Lowered = unknown> extends Omit<AgentPluginMcpPort<Lowered>, 'classifyError'>, AgentPluginMcpProjectionPorts {}
