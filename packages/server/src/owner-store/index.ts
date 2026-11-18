import type { SqliteOpener } from "@jini-ai/core/contracts/storage";
import type { KyselyKernel } from "@jini-ai/db/kernel";
import { openSqliteFileKernel } from "@jini-ai/db/kernel/sqlite";
import { countOwnerStoreRows, listOwnerDestinations, listOwnerEntryRows, type LegacyOwnerDatabase } from "@jini-ai/db/owner-store";
import { SqlSecretsVaultRepo, type SecretsVaultDatabase } from "@jini-ai/db/secrets-vault";
import type { VaultServiceDeps } from "@jini-ai/platform/secrets/credential-sets";
import { OWNER_WORKSPACE_ID, openLegacyOwnerVault, readLegacyOwnerEntry, type LegacyOwnerSnapshot } from "@jini-ai/platform/secrets/legacy-owner";

/** @file File wiring for a legacy owner store (owner.db + owner.key). Shared keys are now project
 * references, so nothing opens this store for writing, runs its migrations, or creates its key any
 * more. The SQL reads live in `@jini-ai/db/owner-store`; the decoder, the legacy keyring and the
 * authorization policy live in `@jini-ai/platform/secrets/legacy-owner`. Neither migrates: today's
 * on-disk stores sit at ledger 0000 (published 0.6.12), and the unpublished 0001 tables may or may not exist.
 */

export interface LegacyOwnerCounts { entries: number; grants: number }
export interface LegacyOwnerStoreFile { filePath: string; open: SqliteOpener }

/** Count entries and grants without the key, so a caller can tell an empty store from a used one.
 * SQLite's read-only mode rejects every write; a WAL database may still gain -wal/-shm files.
 * @throws Whatever the opener throws (missing file, not a database, locked).
 * @complexity O(1) queries over indexed tables.
 * @example const { entries, grants } = await countLegacyOwnerStore({ filePath, open });
 */
export async function countLegacyOwnerStore(required: LegacyOwnerStoreFile, _options = {}): Promise<LegacyOwnerCounts> {
  const kernel = openSqliteFileKernel<LegacyOwnerDatabase>(required, { readOnly: true });
  try { return await countOwnerStoreRows({ kernel }); } finally { await kernel.close(); }
}

/** Decrypt every entry and list its recorded destinations, read-only. The key file is only read:
 * a missing or wrong key is a recovery error, never a reason to generate a new one.
 * @param required The owner.db path, its owner.key path and the host's native SQLite opener.
 * @param options The host's vault meta parsers (its safe-metadata policy).
 * @throws OwnerStoreRecoveryError for an unusable key; opener errors unchanged.
 * @complexity O(n + payload bytes) for n entries, one decrypt each.
 * @example const snapshot = await readLegacyOwnerStore({ filePath, keyFilePath, open });
 */
export async function readLegacyOwnerStore(required: LegacyOwnerStoreFile & { keyFilePath: string },
  options: Partial<Pick<VaultServiceDeps, "metaParsers">> = {}): Promise<LegacyOwnerSnapshot> {
  const kernel = openSqliteFileKernel<LegacyOwnerDatabase>(required, { readOnly: true });
  try {
    // Kysely's DB generic is invariant. The vault sees only its table on this same read-only connection.
    const repo = new SqlSecretsVaultRepo({ kernel: kernel as unknown as KyselyKernel<SecretsVaultDatabase> });
    const vault = openLegacyOwnerVault({ repo, keyFilePath: required.keyFilePath }, options);
    const entries: LegacyOwnerSnapshot["entries"] = [];
    for (const row of await listOwnerEntryRows({ kernel, workspaceId: OWNER_WORKSPACE_ID })) entries.push(await readLegacyOwnerEntry({ vault, row }));
    return { entries, grants: await listOwnerDestinations({ kernel, table: "owner_grants" }), revocations: await listOwnerDestinations({ kernel, table: "owner_revocations" }) };
  } finally { await kernel.close(); }
}
