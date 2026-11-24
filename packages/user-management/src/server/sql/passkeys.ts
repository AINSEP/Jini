import type { Kysely } from "kysely";
import type { IdentityTransactionPort } from "../../core/ports.js";
import type { PasskeyStore } from "../mfa/passkey-ports.js";
import type { SqlIdentityKernel } from "./kernel.js";

/** Stored column shape of the host's owner passkey table; the table name itself is host-owned. */
export interface PasskeysTable { workspace_id: string; principal_id: string; credential_id: string; public_key: string; counter: number; rp_id: string }
/** Host-owned table names. */
export interface PasskeyTables { passkeys: string }

const view = (db: Kysely<unknown>) => db.withTables<Record<string, PasskeysTable>>();

/** Public keys/counters only. Every query joins the identity lock and rollback boundary.
 * @complexity One indexed query per method, list bounded to six rows (five-key cap plus overflow detection).
 */
export function createSqlPasskeyStore(
  { kernel, transactions, tables }: { kernel: SqlIdentityKernel; transactions: IdentityTransactionPort; tables: PasskeyTables },
  _options: Record<string, never> = {},
): PasskeyStore {
  const qualified = (column: "principal_id" | "public_key" | "rp_id") => `${tables.passkeys}.${column}` as const;
  return {
    list: scope => transactions.run({ workspaceId: scope.workspaceId, execute: () => kernel.run(async db => {
      const rows = await view(db).selectFrom(tables.passkeys).selectAll().where("workspace_id", "=", scope.workspaceId)
        .where("principal_id", "=", scope.principalId).orderBy("credential_id").limit(6).execute();
      return rows.map(r => ({ workspaceId: r.workspace_id, principalId: r.principal_id, id: r.credential_id,
        publicKey: r.public_key, counter: Number(r.counter), rpId: r.rp_id }));
    }) }),
    save: credential => transactions.run({ workspaceId: credential.workspaceId, execute: () => kernel.run(async db => {
      const result = await view(db).insertInto(tables.passkeys).values({ workspace_id: credential.workspaceId,
        principal_id: credential.principalId, credential_id: credential.id, public_key: credential.publicKey,
        counter: credential.counter, rp_id: credential.rpId }).onConflict(c => c.columns(["workspace_id", "credential_id"])
          .doUpdateSet({ counter: credential.counter }).where(qualified("principal_id"), "=", credential.principalId)
          .where(qualified("public_key"), "=", credential.publicKey).where(qualified("rp_id"), "=", credential.rpId))
        .executeTakeFirst();
      if (result.numInsertedOrUpdatedRows === 0n) throw new Error("Passkey credential ownership conflict");
    }) }),
    remove: input => transactions.run({ workspaceId: input.workspaceId, execute: () => kernel.run(async db => {
      await view(db).deleteFrom(tables.passkeys).where("workspace_id", "=", input.workspaceId)
        .where("principal_id", "=", input.principalId).where("credential_id", "=", input.id).execute();
    }) }),
    clear: scope => transactions.run({ workspaceId: scope.workspaceId, execute: () => kernel.run(async db => {
      await view(db).deleteFrom(tables.passkeys).where("workspace_id", "=", scope.workspaceId).where("principal_id", "=", scope.principalId).execute();
    }) }),
  };
}
