import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { openSqliteFileKernel } from "@jini-ai/db/kernel/sqlite";
import { runMigrations } from "@jini-ai/db/migrate";
import { OWNER_STORE_LEDGER, ownerStoreMigrations } from "@jini-ai/db/owner-store";
import { SqlSecretsVaultRepo } from "@jini-ai/db/secrets-vault";
import type { SqliteOpener } from "@jini-ai/db/sqlite";
import { AesGcmSecretSealer, EnvOrFileKeyring, generateFileSiteKey } from "@jini-ai/platform/secrets";
import { createVaultMetaParsers, SecretsVaultService } from "@jini-ai/platform/secrets/credential-sets";
import type { VaultSummary } from "@jini-ai/platform/secrets/credential-sets/contracts";
import { ownerContext } from "../legacy.js";

export const input = { kind: "vendor" as const, ownerKey: "plugin", binding: null, provider: "provider",
  label: "Shared API key", meta: { credentialType: "vendor", worksFor: ["provider"] },
  payload: { token: "a-secret-value-that-must-not-escape" }, expectedRevision: null };

export const open: SqliteOpener = (filePath, options) => new Database(filePath, options);

/** A real legacy store as published 0.6.12 wrote it: WAL, ledger 0000 only, sealed entries, grants.
 * Written here with the vault directly, since no production code writes an owner store any more.
 */
export async function legacyStore({ entries = [], grants = [] }: {
  entries?: (typeof input)[]; grants?: { entryIndex: number; consumerId: string }[];
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "jini-owner-store-"));
  const filePath = join(directory, "owner.db"), keyFilePath = join(directory, "owner.key");
  generateFileSiteKey({ keyFilePath });
  const wal = new Database(filePath);
  wal.pragma("journal_mode = WAL");
  wal.close();
  const kernel = openSqliteFileKernel<unknown>({ filePath, open });
  const saved: VaultSummary[] = [];
  try {
    await runMigrations(kernel, ownerStoreMigrations, { ledgerTable: OWNER_STORE_LEDGER, appName: "owner store" });
    const keyring = new EnvOrFileKeyring({ env: { read: () => undefined }, envVarName: "OWNER_STORE_KEY",
      keyFilePath, hkdfSalt: "jini-owner-store-v1", allowFileFallback: true, allowFileAutoGenerate: false });
    const vault = new SecretsVaultService({ repo: new SqlSecretsVaultRepo({ kernel: kernel as never }), keyring,
      sealer: new AesGcmSecretSealer({ keyring }), metaParsers: createVaultMetaParsers({}), authorize: async () => {},
      now: () => new Date().toISOString(), newId: () => randomUUID() });
    for (const entry of entries) saved.push(await vault.put({ ...entry, ...ownerContext(entry) }));
    for (const grant of grants) {
      await kernel.execute(sql`INSERT INTO owner_grants (entry_id, consumer_id, created_at) VALUES (${saved[grant.entryIndex]!.id}, ${grant.consumerId}, ${new Date().toISOString()})`);
    }
  } finally { await kernel.close(); }
  return { directory, filePath, keyFilePath, saved, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
