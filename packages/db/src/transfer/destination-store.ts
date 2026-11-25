import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { SecretsVaultService } from "@jini-ai/core/contracts/site/secrets-credential-sets";
import { VaultError, type VaultRepoPort, type VaultRecord, type VaultContext, type VaultMetaParser } from "@jini-ai/core/contracts/vault";
import type { TargetDescription } from "./postgres-target.js";

export interface SavedDatabaseDestination {
  readonly connectionString: string;
  readonly tokenHint?: CredentialTokenHint;
  readonly description: TargetDescription;
  readonly savedAt: string;
}

/** What `database_transfer_status` reports about the last run. Never row data, never the address. */
export type DatabaseTransferRunSummary =
  | { readonly copied: true; readonly snapshotAt: string; readonly tableCount: number; readonly rowCount: number }
  | { readonly copied: false; readonly snapshotAt: string; readonly code: string; readonly message: string };

export interface DatabaseDestinationStorePort {
  /** @throws {DestinationUnreadableError} When a saved address exists but cannot be opened. */
  get(workspaceId: string): Promise<SavedDatabaseDestination | null>;
  /** Replaces any earlier destination for the workspace, and forgets its last run. */
  save(workspaceId: string, destination: SavedDatabaseDestination): Promise<void>;
  lastRun(workspaceId: string): Promise<DatabaseTransferRunSummary | null>;
  recordRun(workspaceId: string, summary: DatabaseTransferRunSummary): Promise<void>;
}

/** A saved address that no longer opens: another site key, or a row moved between workspaces. */
export class DestinationUnreadableError extends Error {
  constructor() {
    super("the saved destination database could not be unlocked (the site's key may have changed); save it again with database_transfer_set_destination");
  }
}

/** Internal persistence follows the shared vault port; public store methods stay unchanged.
 * The destination is a singleton (`secrets_vault_singleton`), so it is read with `findOne`, never
 * `findDefault`: 0012 copied legacy rows with is_default=false (the old table had no such column),
 * and a default-only read made an upgraded site's destination invisible (parity finding R1). */
export type DatabaseDestinationRepoPort = VaultRepoPort & Required<Pick<VaultRepoPort, "findOne">>;
export async function authorizeDestinationVaultContext(
  { context, scope }: { readonly context: { readonly kind: string; readonly ownerKey: string; readonly principalId: string | null }; readonly scope: { readonly kind: string; readonly ownerKey: string } },
  _options = {}
): Promise<void> {
  if (context.kind !== scope.kind || context.ownerKey !== scope.ownerKey || context.principalId !== null) throw new VaultError({ code: "context" });
}

export class SealedDatabaseDestinationStore implements DatabaseDestinationStorePort {
  constructor(private readonly deps: {
    readonly repo: DatabaseDestinationRepoPort;
    readonly vault: Pick<SecretsVaultService, "findOne" | "put" | "patchMeta">;
    readonly scope: { readonly kind: VaultContext["kind"]; readonly ownerKey: string; readonly principalId: null; readonly provider: null; readonly binding: null };
    readonly parseMeta: VaultMetaParser;
    readonly normalizeAddress: (required: { value: string }) => string;
  }, _optional = {}) {}

  /** One indexed singleton read and at most one open; raw crypto errors never leave the store. */
  async get(workspaceId: string): Promise<SavedDatabaseDestination | null> {
    try {
      const opened = await this.deps.vault.findOne({ ...this.deps.scope, workspaceId });
      if (!opened) return null;
      if (typeof opened.payload?.connectionString !== "string") throw new VaultError({ code: "invalid-record" });
      const meta = opened.summary.meta;
      // An address is not a token: even its length or suffix can expose connection details.
      return { connectionString: opened.payload.connectionString, description: meta.description as unknown as TargetDescription,
        savedAt: (meta.savedAt ?? opened.summary.createdAt) as string };
    } catch {
      throw new DestinationUnreadableError();
    }
  }

  /** Replaces the singleton through Jini's seal/CAS lifecycle and clears the previous last run. */
  async save(workspaceId: string, destination: SavedDatabaseDestination): Promise<void> {
    const existing = await this.deps.repo.findOne({ ...this.deps.scope, workspaceId });
    if (destination.connectionString === '' && existing) return;
    const connectionString = this.deps.normalizeAddress({ value: destination.connectionString });
    await this.deps.vault.put({ ...this.deps.scope, workspaceId, ...(existing ? { id: existing.id } : {}),
      expectedRevision: existing?.revision ?? null, label: existing?.label ?? "Database destination", isDefault: true,
      meta: { ...existing?.meta, description: { ...destination.description }, savedAt: destination.savedAt, lastRun: null },
      payload: { connectionString } });
  }

  /** Status is validated metadata, so it remains readable even when the site key is unavailable. */
  async lastRun(workspaceId: string): Promise<DatabaseTransferRunSummary | null> {
    const existing = await this.deps.repo.findOne({ ...this.deps.scope, workspaceId });
    if (!existing) return null;
    const meta = this.deps.parseMeta({ meta: existing.meta });
    return meta.lastRun as unknown as DatabaseTransferRunSummary | null;
  }

  /** Targeted jsonSet + CAS never rewrites a credential. A replacement or deletion wins over the
   * old run; competing metadata patches may retry against the same envelope, at most three times.
   * @complexity At most three indexed reads/validated CAS patches, no decryption.
   */
  async recordRun(workspaceId: string, summary: DatabaseTransferRunSummary): Promise<void> {
    let original: VaultRecord | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.deps.repo.findOne({ ...this.deps.scope, workspaceId });
      if (!existing || (original && !isSameDestination({ existing, original }))) return;
      original ??= existing;
      try {
        await this.deps.vault.patchMeta({ ...this.deps.scope, workspaceId, id: existing.id,
          expectedRevision: existing.revision, patch: { lastRun: { ...summary } } });
        return;
      } catch (error) {
        if (!(error instanceof VaultError) || error.code !== "conflict" || attempt === 2) throw error;
      }
    }
  }
}

function isSameDestination({ existing, original }: { existing: VaultRecord; original: VaultRecord }, _options = {}): boolean {
  return existing.id === original.id && JSON.stringify(existing.sealed) === JSON.stringify(original.sealed);
}

