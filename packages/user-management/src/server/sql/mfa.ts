import type { Kysely } from "kysely";
import type { IdentityTransactionPort } from "../../core/ports.js";
import type { MfaPending, MfaStore } from "../mfa/ports.js";
import type { PasskeysTable } from "./passkeys.js";
import type { SqlIdentityKernel } from "./kernel.js";

/** Stored column shape of the host's owner MFA factor table; the table name itself is host-owned. */
export interface MfaFactorsTable { workspace_id: string; principal_id: string; sealed_secret: string; last_step: number }
/** Stored column shape of the host's pending MFA proof table; the table name itself is host-owned. */
export interface MfaPendingTable {
  workspace_id: string; principal_id: string; purpose: string; token_hash: string;
  expires_at: number; attempts: number; sealed_secret: string | null;
}
/** Host-owned table names. `passkeys` is cleared together with the factor by `clear`. */
export interface MfaTables { factors: string; pending: string; passkeys: string }

const factorsView = (db: Kysely<unknown>) => db.withTables<Record<string, MfaFactorsTable>>();
const pendingView = (db: Kysely<unknown>) => db.withTables<Record<string, MfaPendingTable>>();
const passkeysView = (db: Kysely<unknown>) => db.withTables<Record<string, PasskeysTable>>();

/** Store sealed owner factors and bounded pending proofs in the existing identity transaction.
 * Errors propagate for rollback; no plaintext factor or bearer proof is persisted.
 * @complexity Each method uses a fixed number of indexed queries and O(1) result space.
 */
export function createSqlMfaStore(
  { kernel, transactions, tables }: { kernel: SqlIdentityKernel; transactions: IdentityTransactionPort; tables: MfaTables },
  _options: Record<string, never> = {},
): MfaStore {
  const clearPending: MfaStore["clearPending"] = scope => transactions.run({ workspaceId: scope.workspaceId,
    execute: () => kernel.run(async db => {
      await pendingView(db).deleteFrom(tables.pending).where("workspace_id", "=", scope.workspaceId)
        .where("principal_id", "=", scope.principalId).execute();
    }),
  });
  return {
    clearPending,
    factor: scope => transactions.run({ workspaceId: scope.workspaceId, execute: async () => {
      const row = await kernel.run(db => factorsView(db).selectFrom(tables.factors).selectAll()
        .where("workspace_id", "=", scope.workspaceId).where("principal_id", "=", scope.principalId).executeTakeFirst());
      return row ? { ...scope, sealedSecret: row.sealed_secret, lastStep: Number(row.last_step) } : null;
    } }),
    saveFactor: factor => transactions.run({ workspaceId: factor.workspaceId, execute: () => kernel.run(async db => {
      const values = { workspace_id: factor.workspaceId, principal_id: factor.principalId,
        sealed_secret: factor.sealedSecret, last_step: factor.lastStep };
      await factorsView(db).insertInto(tables.factors).values(values).onConflict(conflict =>
        conflict.columns(["workspace_id", "principal_id"]).doUpdateSet(values)).execute();
    }) }),
    pending: input => transactions.run({ workspaceId: input.workspaceId, execute: async () => {
      const row = await kernel.run(db => pendingView(db).selectFrom(tables.pending).selectAll()
        .where("workspace_id", "=", input.workspaceId).where("token_hash", "=", input.tokenHash).executeTakeFirst());
      if (!row) return null;
      return { workspaceId: row.workspace_id, principalId: row.principal_id, purpose: row.purpose as MfaPending["purpose"],
        tokenHash: row.token_hash, expiresAt: Number(row.expires_at), attempts: Number(row.attempts),
        ...(row.sealed_secret === null ? {} : { sealedSecret: row.sealed_secret }) };
    } }),
    savePending: pending => transactions.run({ workspaceId: pending.workspaceId, execute: () => kernel.run(async db => {
      const values = { workspace_id: pending.workspaceId, principal_id: pending.principalId, purpose: pending.purpose,
        token_hash: pending.tokenHash, expires_at: pending.expiresAt, attempts: pending.attempts,
        sealed_secret: pending.sealedSecret ?? null };
      await pendingView(db).insertInto(tables.pending).values(values).onConflict(conflict =>
        conflict.columns(["workspace_id", "principal_id", "purpose"]).doUpdateSet(values)).execute();
    }) }),
    clear: scope => transactions.run({ workspaceId: scope.workspaceId, execute: async () => {
      await clearPending(scope);
      await kernel.run(db => passkeysView(db).deleteFrom(tables.passkeys).where("workspace_id", "=", scope.workspaceId)
        .where("principal_id", "=", scope.principalId).execute());
      await kernel.run(db => factorsView(db).deleteFrom(tables.factors).where("workspace_id", "=", scope.workspaceId)
        .where("principal_id", "=", scope.principalId).execute());
    } }),
  };
}
