import type { VaultContext, VaultIdentity, VaultMeta, VaultSummary } from '@jini-ai/core/contracts/vault';

/** @agent-note Back it with the same vault object as your API connection host; `format` and the row ids are saved; never change them. */
export interface AdminSurfacePluginStatePersistence {
  readonly scope: VaultContext;
  readonly format: string;
  readonly vault: {
    list(required: VaultContext): Promise<readonly VaultSummary[]>;
    get(required: VaultIdentity): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
    put(required: VaultIdentity & { expectedRevision: number | null; provider: null; label: string; meta: VaultMeta; payload: VaultMeta }): Promise<VaultSummary>;
    delete(required: VaultIdentity & { expectedRevision: number }): Promise<boolean>;
  };
  isConflict(required: { error: unknown }): boolean;
}
