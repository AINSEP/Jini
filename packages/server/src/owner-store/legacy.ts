import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { SqlSecretsVaultRepo, type SecretsVaultDatabase } from "@jini-ai/db/secrets-vault";
import type { StorageKernel } from "@jini-ai/db/kernel";
import { openSqliteFileKernel } from "@jini-ai/db/kernel/sqlite";
import type { SqliteOpener } from "@jini-ai/db/sqlite";
import { AesGcmSecretSealer, EnvOrFileKeyring } from "@jini-ai/platform/secrets";
import { createVaultMetaParsers, isCopyableKind, SecretsVaultService, type VaultServiceDeps } from "@jini-ai/platform/secrets/credential-sets";
import { VaultError, type VaultContext, type VaultKind, type VaultMeta } from "@jini-ai/platform/secrets/credential-sets/contracts";

/** @file Read-only reader for a legacy owner store (owner.db + owner.key). Shared keys are now
 * project references, so nothing opens this store for writing, runs its migrations, or creates its
 * key any more. The reader never migrates: today's on-disk stores sit at ledger 0000 (published
 * 0.6.12), and the unpublished 0001 tables may or may not exist.
 */

export const OWNER_WORKSPACE_ID = "owner";

/** One decrypted legacy entry: the identity, metadata and payload an importer needs. */
export interface LegacyOwnerEntry {
  id: string; kind: VaultKind; ownerKey: string; binding: string | null; provider: string | null;
  label: string; isDefault: boolean; meta: VaultMeta; payload: VaultMeta | null;
}
/** A site the legacy store copied an entry to (consumerId = the site's canonical folder). */
export interface LegacyOwnerDestination { entryId: string; consumerId: string }
/** grants: active copies. revocations: revoked copies whose site cleanup never finished. */
export interface LegacyOwnerSnapshot { entries: LegacyOwnerEntry[]; grants: LegacyOwnerDestination[]; revocations: LegacyOwnerDestination[] }
export interface LegacyOwnerCounts { entries: number; grants: number }
export interface LegacyOwnerStoreFile { filePath: string; open: SqliteOpener }

interface LegacyOwnerDatabase extends SecretsVaultDatabase {
  owner_grants: { entry_id: string; consumer_id: string; created_at: string };
  owner_revocations: { entry_id: string; consumer_id: string };
}

/** Safe recovery guidance never includes underlying key material or vault payloads. */
export class OwnerStoreRecoveryError extends Error {
  constructor() {
    super("Owner store key is missing, invalid, or cannot open existing data. Restore the original owner key.");
    this.name = "OwnerStoreRecoveryError";
  }
}

/** Fixed owner scope still preserves feature ownership, which the vault's AAD authenticates. */
export function ownerContext(input: Pick<VaultContext, "kind" | "ownerKey" | "binding">, _options = {}): VaultContext {
  return { kind: input.kind, ownerKey: input.ownerKey, binding: input.binding, workspaceId: OWNER_WORKSPACE_ID, principalId: null };
}

/** Count entries and grants without the key, so a caller can tell an empty store from a used one.
 * SQLite's read-only mode rejects every write; a WAL database may still gain -wal/-shm files.
 * @throws Whatever the opener throws (missing file, not a database, locked).
 * @complexity O(1) queries over indexed tables.
 * @example const { entries, grants } = await countLegacyOwnerStore({ filePath, open });
 */
export async function countLegacyOwnerStore(required: LegacyOwnerStoreFile, _options = {}): Promise<LegacyOwnerCounts> {
  const kernel = openSqliteFileKernel<LegacyOwnerDatabase>(required, { readOnly: true });
  try {
    const [entries] = await kernel.query<{ n: number }>(sql`SELECT count(*) AS n FROM secrets_vault`);
    const [grants] = await kernel.query<{ n: number }>(sql`SELECT count(*) AS n FROM owner_grants`);
    return { entries: Number(entries?.n ?? 0), grants: Number(grants?.n ?? 0) };
  } finally { await kernel.close(); }
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
    const vault = ownerVault({ kernel, keyFilePath: required.keyFilePath }, options);
    const rows = await kernel.run(db => db.selectFrom("secrets_vault").select(["id", "kind", "owner_key", "binding"])
      .where("workspace_id", "=", OWNER_WORKSPACE_ID).orderBy("id").execute());
    const entries: LegacyOwnerEntry[] = [];
    for (const row of rows) entries.push(await readEntry({ vault, row }));
    return { entries, grants: await destinations({ kernel, table: "owner_grants" }), revocations: await destinations({ kernel, table: "owner_revocations" }) };
  } finally { await kernel.close(); }
}

/** The legacy keyring exactly as the store wrote it; file fallback on, auto-generation off. */
function ownerVault({ kernel, keyFilePath }: { kernel: StorageKernel<LegacyOwnerDatabase>; keyFilePath: string },
  options: Partial<Pick<VaultServiceDeps, "metaParsers">> = {}): SecretsVaultService {
  const keyring = new EnvOrFileKeyring({ env: { read: () => undefined }, envVarName: "OWNER_STORE_KEY",
    keyFilePath, hkdfSalt: "jini-owner-store-v1", allowFileFallback: true, allowFileAutoGenerate: false });
  // Kysely's DB generic is invariant. The vault sees only its table on this same read-only connection.
  const repo = new SqlSecretsVaultRepo({ kernel: kernel as unknown as StorageKernel<SecretsVaultDatabase> });
  return new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }),
    metaParsers: options.metaParsers ?? createVaultMetaParsers({}), now: () => new Date().toISOString(), newId: () => randomUUID(),
    authorize: async ({ context }) => {
      if (context.workspaceId !== OWNER_WORKSPACE_ID || context.principalId !== null || !isCopyableKind[context.kind]) throw new VaultError({ code: "context" });
    } });
}

/** One authenticated decrypt; any key or envelope failure is the fixed recovery error. */
async function readEntry({ vault, row }: { vault: SecretsVaultService; row: { id: string; kind: VaultKind; owner_key: string; binding: string | null } }): Promise<LegacyOwnerEntry> {
  let entry: Awaited<ReturnType<SecretsVaultService["get"]>>;
  try { entry = await vault.get({ ...ownerContext({ kind: row.kind, ownerKey: row.owner_key, binding: row.binding }), id: row.id }); }
  catch { throw new OwnerStoreRecoveryError(); }
  if (!entry) throw new OwnerStoreRecoveryError();
  const { summary } = entry;
  return { id: summary.id, kind: summary.kind, ownerKey: summary.ownerKey, binding: summary.binding, provider: summary.provider,
    label: summary.label, isDefault: summary.isDefault, meta: summary.meta, payload: entry.payload };
}

/** owner_revocations exists only past the unpublished 0001 step; a 0000 store has none. */
async function destinations({ kernel, table }: { kernel: StorageKernel<LegacyOwnerDatabase>; table: "owner_grants" | "owner_revocations" }): Promise<LegacyOwnerDestination[]> {
  const present = await kernel.query(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}`);
  if (present.length === 0) return [];
  const rows = await kernel.run(db => db.selectFrom(table).select(["entry_id", "consumer_id"]).orderBy("entry_id").orderBy("consumer_id").execute());
  return rows.map(row => ({ entryId: row.entry_id, consumerId: row.consumer_id }));
}
