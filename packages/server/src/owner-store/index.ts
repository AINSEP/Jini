import type { SqliteOpener } from "@jini-ai/core/contracts/storage";
import type { VaultKind, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { LegacyOwnerStoreDestination, LegacyOwnerStoreSnapshot } from "@jini-ai/core/contracts/site/legacy-owner-store";

/** @file File wiring for a legacy owner store (owner.db + owner.key). Shared keys are now project
 * references, so nothing opens this store for writing, runs its migrations, or creates its key any
 * more. The SQL reads live in `@jini-ai/db/owner-store`; the decoder, the legacy keyring and the
 * authorization policy live in `@jini-ai/platform/secrets/legacy-owner`. Neither migrates: today's
 * on-disk stores sit at ledger 0000 (published 0.6.12), and the unpublished 0001 tables may or may not exist.
 * The host injects both (owner K5: no package imports another package's implementation); this file
 * only composes them: one read-only connection, the vault on that same connection, always closed.
 */

export interface LegacyOwnerCounts { entries: number; grants: number }
export interface LegacyOwnerStoreFile { filePath: string; open: SqliteOpener }
/** One sealed row of the legacy owner workspace, as the owner-store SQL reads list it. */
export interface LegacyOwnerStoreRow { id: string; kind: VaultKind; ownerKey: string; binding: string | null }

/** The implementations the host passes in. Generic so this package needs only core types.
 * @example const ports = { openKernel: (file, options) => openSqliteFileKernel<LegacyOwnerDatabase>(file, options),
 *   countOwnerStoreRows, listOwnerEntryRows, listOwnerDestinations, createVaultRepo, ownerWorkspaceId: OWNER_WORKSPACE_ID,
 *   openLegacyOwnerVault, readLegacyOwnerEntry };
 */
export interface LegacyOwnerStorePorts<Kernel extends { close(): Promise<void> }, Vault, Entry, Options> {
  /** Opens owner.db (`openSqliteFileKernel` from `@jini-ai/db/kernel/sqlite`); always called with `{ readOnly: true }`. */
  openKernel: (file: LegacyOwnerStoreFile, options: { readOnly: true }) => Kernel;
  /** The owner-store SQL reads (`@jini-ai/db/owner-store`). */
  countOwnerStoreRows: (args: { kernel: Kernel }) => Promise<LegacyOwnerCounts>;
  listOwnerEntryRows: (args: { kernel: Kernel; workspaceId: string }) => Promise<LegacyOwnerStoreRow[]>;
  listOwnerDestinations: (args: { kernel: Kernel; table: "owner_grants" | "owner_revocations" }) => Promise<LegacyOwnerStoreDestination[]>;
  /** The secrets-vault repo over the given connection (`SqlSecretsVaultRepo` from `@jini-ai/db/secrets-vault`). */
  createVaultRepo: (args: { kernel: Kernel }) => VaultRepoPort;
  /** The legacy decoder (`@jini-ai/platform/secrets/legacy-owner`): its workspace id, read-only keyring vault and entry read. */
  ownerWorkspaceId: string;
  openLegacyOwnerVault: (args: { repo: VaultRepoPort; keyFilePath: string }, options: Partial<Options>) => Vault;
  readLegacyOwnerEntry: (args: { vault: Vault; row: LegacyOwnerStoreRow }) => Promise<Entry>;
}
type CountPorts<Kernel extends { close(): Promise<void> }> = Pick<LegacyOwnerStorePorts<Kernel, unknown, unknown, never>, "openKernel" | "countOwnerStoreRows">;

/** Count entries and grants without the key, so a caller can tell an empty store from a used one.
 * SQLite's read-only mode rejects every write; a WAL database may still gain -wal/-shm files.
 * @throws Whatever the opener throws (missing file, not a database, locked).
 * @complexity O(1) queries over indexed tables.
 * @example const { entries, grants } = await countLegacyOwnerStore({ filePath, open, ports });
 */
export async function countLegacyOwnerStore<Kernel extends { close(): Promise<void> }>(
  required: LegacyOwnerStoreFile & { ports: CountPorts<Kernel> }, _options = {}): Promise<LegacyOwnerCounts> {
  const { ports, ...file } = required;
  const kernel = ports.openKernel(file, { readOnly: true });
  try { return await ports.countOwnerStoreRows({ kernel }); } finally { await kernel.close(); }
}

/** Decrypt every entry and list its recorded destinations, read-only. The key file is only read:
 * a missing or wrong key is a recovery error, never a reason to generate a new one.
 * @param required The owner.db path, its owner.key path, the host's native SQLite opener and the injected ports.
 * @param options The host's vault meta parsers (its safe-metadata policy), passed to the injected vault opener.
 * @throws OwnerStoreRecoveryError for an unusable key; opener errors unchanged.
 * @complexity O(n + payload bytes) for n entries, one decrypt each.
 * @example const snapshot = await readLegacyOwnerStore({ filePath, keyFilePath, open, ports });
 */
export async function readLegacyOwnerStore<Kernel extends { close(): Promise<void> }, Vault, Entry, Options>(
  required: LegacyOwnerStoreFile & { keyFilePath: string; ports: LegacyOwnerStorePorts<Kernel, Vault, Entry, Options> },
  options: Partial<Options> = {}): Promise<LegacyOwnerStoreSnapshot<Entry>> {
  const { ports, keyFilePath, ...file } = required;
  const kernel = ports.openKernel(file, { readOnly: true });
  try {
    // The vault sees only its table on this same read-only connection.
    const repo = ports.createVaultRepo({ kernel });
    const vault = ports.openLegacyOwnerVault({ repo, keyFilePath }, options);
    const entries: Entry[] = [];
    for (const row of await ports.listOwnerEntryRows({ kernel, workspaceId: ports.ownerWorkspaceId })) entries.push(await ports.readLegacyOwnerEntry({ vault, row }));
    return { entries, grants: await ports.listOwnerDestinations({ kernel, table: "owner_grants" }), revocations: await ports.listOwnerDestinations({ kernel, table: "owner_revocations" }) };
  } finally { await kernel.close(); }
}
