import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AesGcmSecretSealer, EnvOrFileKeyring, generateFileSiteKey, SiteKeyFileAlreadyExistsError } from "@jini-ai/platform/secrets";
import { createVaultMetaParsers, type VaultServiceDeps } from "@jini-ai/platform/secrets/credential-sets";
import { closeSqliteConnection, sqliteKernel } from "../kernel/sqlite/index.js";
import { runMigrations } from "../migrate/runner.js";
import { openSqliteConnection } from "../sqlite/open.js";
import type { SqliteOpener } from "../sqlite/types.js";
import { OWNER_STORE_LEDGER, ownerStoreMigrations } from "./migrations/index.js";
import { OwnerStoreService, ownerContext, type OwnerStoreDatabase } from "./service.js";

export interface OpenOwnerStoreInput { filePath: string; keyFilePath: string; open: SqliteOpener }
export type OpenOwnerStoreOptions = Partial<Pick<VaultServiceDeps, "metaParsers" | "now" | "newId">>;
export interface OpenedOwnerStore { service: OwnerStoreService; close(): Promise<void> }

/** Safe recovery guidance never includes underlying key material or vault payloads. */
export class OwnerStoreRecoveryError extends Error {
  constructor() {
    super("Owner store key is missing, invalid, or cannot open existing data. Restore the original owner key or restore an encrypted backup into an empty store.");
    this.name = "OwnerStoreRecoveryError";
  }
}

/** Open an independently migrated owner database using the host's native SQLite dependency.
 * Key creation reuses exclusive file generation; an existing credential forbids replacement.
 * @throws Migration history errors unchanged, or OwnerStoreRecoveryError for unusable keys.
 * @complexity O(m) migration steps; initial key verification opens at most one credential.
 * @example const store = await openOwnerStore({ filePath, keyFilePath, open });
 */
export async function openOwnerStore(required: OpenOwnerStoreInput, options: OpenOwnerStoreOptions = {}): Promise<OpenedOwnerStore> {
  if (comparablePath({ filePath: required.filePath }) === comparablePath({ filePath: required.keyFilePath })) throw new TypeError("Owner database and key paths must differ");
  const client = openSqliteConnection({ filePath: required.filePath, open: ({ filePath }) => required.open(filePath, {}) });
  try {
    const kernel = sqliteKernel<OwnerStoreDatabase>(client);
    await runMigrations(sqliteKernel<unknown>(client), ownerStoreMigrations, { ledgerTable: OWNER_STORE_LEDGER, appName: "owner store" });
    const service = await kernel.transaction(async () => {
      const anyEntry = await kernel.run(db => db.selectFrom("secrets_vault").select("id").executeTakeFirst());
      const existing = await kernel.run(db => db.selectFrom("secrets_vault").selectAll()
        .where("sealed_ciphertext", "is not", null).executeTakeFirst());
      prepareKey({ keyFilePath: required.keyFilePath, hasCredentials: anyEntry !== undefined });
      const keyring = new EnvOrFileKeyring({ env: { read: () => undefined }, envVarName: "OWNER_STORE_KEY",
        keyFilePath: required.keyFilePath, hkdfSalt: "jini-owner-store-v1", allowFileFallback: true, allowFileAutoGenerate: false });
      const store = new OwnerStoreService({ kernel, keyring, sealer: new AesGcmSecretSealer({ keyring }),
        metaParsers: options.metaParsers ?? createVaultMetaParsers({}),
        now: options.now ?? (() => new Date().toISOString()), newId: options.newId ?? (() => randomUUID()) });
      try {
        // activeKey is only a handle; derive actually validates the file before accepting writes.
        await keyring.derive({ workspaceId: "owner", purpose: "owner-store-key-check", info: "v1" });
        if (existing) await store.vault.get({ ...ownerContext({ kind: existing.kind, ownerKey: existing.owner_key, binding: existing.binding }), id: existing.id });
      } catch {
        throw new OwnerStoreRecoveryError();
      }
      return store;
    });
    return { service, close: async () => closeSqliteConnection(client) };
  } catch (error) {
    closeSqliteConnection(client);
    throw error;
  }
}

/** Paths may not exist yet; fold case on hosts whose default filesystems alias case variants.
 * @complexity O(n) time and space in the resolved path length; no filesystem access.
 */
function comparablePath({ filePath }: { filePath: string }): string {
  const absolute = resolve(filePath);
  return process.platform === "win32" || process.platform === "darwin" ? absolute.toLowerCase() : absolute;
}

/** Never auto-generate over missing recovery material; wx settles competing initializers. */
function prepareKey({ keyFilePath, hasCredentials }: { keyFilePath: string; hasCredentials: boolean }): void {
  if (existsSync(keyFilePath)) return;
  if (hasCredentials) throw new OwnerStoreRecoveryError();
  try {
    generateFileSiteKey({ keyFilePath });
  } catch (error) {
    if (!(error instanceof SiteKeyFileAlreadyExistsError)) throw error;
  }
}
