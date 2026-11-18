/** Legacy owner database schema history and its read-only row queries; decryption lives in @jini-ai/platform/secrets/legacy-owner, the file wiring in @jini-ai/server/owner-store. */
import type { VaultKind } from "@jini-ai/core/contracts/vault";
import type { KyselyKernel } from "../kernel/port.js";
import type { SecretsVaultDatabase } from "../secrets-vault/index.js";

// No runtime kysely import here: this entry must load without the optional kysely peer, so the reads
// below use the kernel's own query builder (db.selectFrom, db.introspection) rather than the `sql` tag.

export { OWNER_STORE_LEDGER, ownerStoreMigrations } from "./migrations/index.js";
export { ownerStoreDdl, ownerStoreMigration } from "./migrations/0000_owner_store.js";

export interface LegacyOwnerDatabase extends SecretsVaultDatabase {
  owner_grants: { entry_id: string; consumer_id: string; created_at: string };
  owner_revocations: { entry_id: string; consumer_id: string };
}

/** Count entries and grants without any key, so a caller can tell an empty store from a used one.
 * @throws Whatever the kernel throws (not a database, locked).
 * @complexity O(1) queries over indexed tables.
 * @example const { entries, grants } = await countOwnerStoreRows({ kernel });
 */
export async function countOwnerStoreRows({ kernel }: { kernel: KyselyKernel<LegacyOwnerDatabase> }, _options = {}): Promise<{ entries: number; grants: number }> {
  const count = (table: "secrets_vault" | "owner_grants") => kernel.run(async db =>
    Number((await db.selectFrom(table).select(eb => eb.fn.countAll<number>().as("n")).executeTakeFirst())?.n ?? 0));
  return { entries: await count("secrets_vault"), grants: await count("owner_grants") };
}

/** The sealed entries of one workspace, in id order. The caller passes the legacy owner workspace.
 * @complexity O(n) for n rows of that workspace.
 * @example const rows = await listOwnerEntryRows({ kernel, workspaceId: "owner" });
 */
export async function listOwnerEntryRows({ kernel, workspaceId }: { kernel: KyselyKernel<LegacyOwnerDatabase>; workspaceId: string }, _options = {}):
  Promise<{ id: string; kind: VaultKind; ownerKey: string; binding: string | null }[]> {
  const rows = await kernel.run(db => db.selectFrom("secrets_vault").select(["id", "kind", "owner_key", "binding"])
    .where("workspace_id", "=", workspaceId).orderBy("id").execute());
  return rows.map(row => ({ id: row.id, kind: row.kind, ownerKey: row.owner_key, binding: row.binding }));
}

/** owner_revocations exists only past the unpublished 0001 step; a 0000 store has none. */
export async function listOwnerDestinations({ kernel, table }: { kernel: KyselyKernel<LegacyOwnerDatabase>; table: "owner_grants" | "owner_revocations" }, _options = {}):
  Promise<{ entryId: string; consumerId: string }[]> {
  const present = (await kernel.run(db => db.introspection.getTables())).some(candidate => candidate.name === table);
  if (!present) return [];
  const rows = await kernel.run(db => db.selectFrom(table).select(["entry_id", "consumer_id"]).orderBy("entry_id").orderBy("consumer_id").execute());
  return rows.map(row => ({ entryId: row.entry_id, consumerId: row.consumer_id }));
}
