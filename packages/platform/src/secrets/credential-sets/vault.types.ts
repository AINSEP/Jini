import type { VaultKind, CredentialType, CredentialMeta, VaultJson, VaultMeta, VaultOptions, VaultContext, VaultIdentity, VaultRecord, VaultSummary, VaultPutRecord, VaultQuery, VaultDefaultQuery, VaultSingletonQuery, VaultBatchOp, VaultBatchResult, VaultCopyResult, VaultMetaParser, VaultMetaParsers, VaultRepoPort  , VaultErrorCode } from '@jini-ai/core/contracts/vault';
export type { VaultKind, CredentialType, CredentialMeta, VaultJson, VaultMeta, VaultOptions, VaultContext, VaultIdentity, VaultRecord, VaultSummary, VaultPutRecord, VaultQuery, VaultDefaultQuery, VaultSingletonQuery, VaultBatchOp, VaultBatchResult, VaultCopyResult, VaultMetaParser, VaultMetaParsers, VaultRepoPort } from '@jini-ai/core/contracts/vault';
import type { SealedSecret } from "../types.js";

export const VAULT_KINDS = ["site-assistant", "personal-execution", "media-provider", "publish-peer",
  "database-destination", "vendor", "source-control", "mcp-env", "mcp-auth", "api-connection"] as const satisfies readonly Exclude<VaultKind, "custom">[];

/** Safe error codes never contain submitted values or encrypted material. */
export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor({ code }: { code: VaultError["code"] }, _options: VaultOptions = {}) {
    super(`Secrets vault: ${code}`);
    this.code = code;
    this.name = "VaultError";
  }
}

/** The record belongs to the query's exact workspace, kind, owner and principal; an omitted provider
 * matches every provider. @complexity O(1). */
export function isInVaultQueryScope({ record, query }: { record: Pick<VaultRecord, keyof VaultQuery>; query: VaultQuery }, _options: VaultOptions = {}): boolean {
  const sameOwner = record.workspaceId === query.workspaceId && record.kind === query.kind && record.ownerKey === query.ownerKey;
  const sameProvider = query.provider === undefined || record.provider === query.provider;
  return sameOwner && record.principalId === query.principalId && sameProvider;
}
/** Unambiguous scope encoding keeps adapter default/identity checks on the same contract. */
export function vaultGroupKey({ record }: { record: VaultDefaultQuery }, _options: VaultOptions = {}): string {
  return JSON.stringify([record.workspaceId, record.kind, record.ownerKey, record.principalId, record.provider]);
}

/** Fields fixed at create and checked on every replacement. */
// Provider groups defaults, but is not authenticated identity (see buildVaultAad).
const IMMUTABLE_FIELDS = ["workspaceId", "kind", "ownerKey", "principalId", "id", "binding", "createdAt"] as const;

function assertRevision({ record, existing, expectedRevision }: { record: VaultPutRecord; existing: VaultRecord | null; expectedRevision: number | null }): void {
  if (expectedRevision === null ? existing !== null : existing?.revision !== expectedRevision) throw new VaultError({ code: "conflict" });
  if (!Number.isSafeInteger(record.revision) || record.revision !== (expectedRevision ?? 0) + 1) throw new VaultError({ code: "invalid-record" });
}

function assertSameIdentity({ record, existing }: { record: VaultPutRecord; existing: VaultRecord }): void {
  if (IMMUTABLE_FIELDS.some(field => record[field] !== existing[field])) throw new VaultError({ code: "context" });
  if (existing.kind === "vendor") {
    // Missing subtype identifies a pre-unification vendor; an explicit null is not a default.
    const previousType = existing.meta.credentialType === undefined ? "vendor" : existing.meta.credentialType;
    const nextType = record.meta.credentialType === undefined ? "vendor" : record.meta.credentialType;
    if (nextType !== previousType) throw new VaultError({ code: "context" });
  }
}

/** Adapters guard CAS and immutable identity even for callers below the service. */
export function assertVaultReplacement(
  { record, existing, expectedRevision }: { record: VaultPutRecord; existing: VaultRecord | null; expectedRevision: number | null },
  _options: VaultOptions = {},
): void {
  assertRevision({ record, existing, expectedRevision });
  if (existing) assertSameIdentity({ record, existing });
}
