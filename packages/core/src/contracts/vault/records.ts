import type { SealedSecret } from '../vault.js';
/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/platform`. */


/** `custom` remains readable/replaceable until each workspace activates its data migration. */
export type VaultKind = "site-assistant" | "personal-execution" | "media-provider" | "publish-peer" | "database-destination" | "vendor" | "source-control" | "mcp-env" | "mcp-auth" | "api-connection" | "custom";

export type CredentialType = "vendor" | "custom";

/** Required metadata on every active vendor-kind credential. Subtype is immutable after create. */
export type CredentialMeta = VaultMeta & { credentialType: CredentialType; worksFor: string[] };

export type VaultJson = null | boolean | number | string | VaultJson[] | { [key: string]: VaultJson };

export type VaultMeta = { [key: string]: VaultJson };

export type VaultOptions = Record<string, never>;


/** Expected ownership is supplied by the caller, never reconstructed from an untrusted row. */
export interface VaultContext {
  workspaceId: string;
  kind: VaultKind;
  ownerKey: string;
  principalId: string | null;
  /** Host-canonicalized endpoint/resource binding; null for credentials without such a binding. */
  binding: string | null;
}

export interface VaultIdentity extends VaultContext { id: string }

export interface VaultRecord extends VaultIdentity {
  provider: string | null;
  label: string;
  isDefault: boolean;
  revision: number;
  sealed: SealedSecret | null;
  last4: string | null;
  tokenLength: number | null;
  meta: VaultMeta;
  createdAt: string;
  updatedAt: string;
}

export type VaultSummary = Omit<VaultRecord, "sealed"> & { configured: boolean };

/** Unspecified placement lets the repo auto-default a group's first row; false opts out.
 * Persisted records and read models always contain a concrete boolean.
 */
export type VaultPutRecord = Omit<VaultRecord, "isDefault"> & { isDefault?: boolean | undefined };

export interface VaultQuery {
  workspaceId: string;
  kind: VaultKind;
  ownerKey: string;
  principalId: string | null;
  provider?: string | null | undefined;
}

/** A default belongs to one exact group; omitted provider never means all providers. */
export interface VaultDefaultQuery extends VaultQuery { provider: string | null }

/** Singleton lookup ignores provider/default; omitted owner/principal leave that dimension unfiltered.
 * Hosts enforce singleton cardinality for their kind/scope. No binding is inferred by the service.
 */
export interface VaultSingletonQuery {
  workspaceId: string;
  kind: VaultKind;
  ownerKey?: string | undefined;
  principalId?: string | null | undefined;
}

/** Ordered CAS operations; default side effects affect later operations' revisions. */
export type VaultBatchOp =
  | { put: { record: VaultPutRecord; expectedRevision: number | null } }
  | { delete: { workspaceId: string; id: string; expectedRevision: number } }
  | { patchMeta: { workspaceId: string; id: string; expectedRevision: number; patch: VaultMeta; updatedAt: string } };

export type VaultBatchResult = VaultRecord | boolean;

export interface VaultCopyResult {
  kind: VaultKind;
  id: string;
  status: "copied" | "skipped" | "failed";
  last4?: string;
  reasonCode?: VaultErrorCode | "source-needs-upgrade" | "source-missing" | "target-exists" |
    "kind-not-copyable" | "requires-mcp-configuration" | "copy-failed";
}

export type VaultMetaParser = (input: { meta: unknown; provider?: string | null | undefined }, options?: VaultOptions) => VaultMeta;

export type VaultMetaParsers = Readonly<Record<VaultKind, VaultMetaParser>>;


/** CAS is mandatory: null creates only; a number replaces/deletes only that revision.
 * Defaults group by workspace/kind/owner/principal/provider. Every default change increments
 * revision; promotion uses updatedAt descending, then id descending (binary UTF-8 order).
 * All writes must join a host transaction when the adapter supports transaction composition.
 */
export interface VaultRepoPort {
  find(input: { workspaceId: string; id: string }, options?: VaultOptions): Promise<VaultRecord | null>;
  /** Indexed exact-group lookup; returns at most one row without listing its siblings.
   * Optional for compatibility with pre-C1 ports; both built-in adapters implement it.
   */
  findDefault?(input: VaultDefaultQuery, options?: VaultOptions): Promise<VaultRecord | null>;
  /** Optional additions keep older injected ports source-compatible; built-in adapters implement both. */
  findOne?(input: VaultSingletonQuery, options?: VaultOptions): Promise<VaultRecord | null>;
  /** All operations commit together or throw with no published changes. Default side effects
   * follow operation order; a delete carries full expected ownership.
   * SQL joins the host transaction: callers must propagate failures to roll that transaction back.
   * @example await repo.applyBatch!({ ops: [{ put: { record, expectedRevision: null } }] });
   */
  applyBatch?(input: { ops: readonly VaultBatchOp[] }, options?: VaultOptions): Promise<VaultBatchResult[]>;
  list(input: VaultQuery, options?: VaultOptions): Promise<VaultRecord[]>;
  put(input: { record: VaultPutRecord; expectedRevision: number | null }, options?: VaultOptions): Promise<VaultRecord>;
  /** Service-validated patch: top-level keys are plain JSON-path identifiers. */
  patchMeta(input: { workspaceId: string; id: string; expectedRevision: number; patch: VaultMeta; updatedAt: string }, options?: VaultOptions): Promise<VaultRecord>;
  delete(input: { workspaceId: string; id: string; expectedRevision: number }, options?: VaultOptions): Promise<boolean>;
}

export type VaultErrorCode = "conflict" | "context" | "invalid-meta" | "invalid-record";
