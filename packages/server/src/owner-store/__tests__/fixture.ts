import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AesGcmSecretSealer, FixedSiteKeyKeyring } from "@jini-ai/platform/secrets";
import { createVaultMetaParsers, InMemoryVaultRepo, SecretsVaultService } from "@jini-ai/platform/secrets/credential-sets";
import type { OwnerSyncTarget } from "../service.js";
import type { SqliteOpener } from "@jini-ai/db/sqlite";
import { openOwnerStore, type OpenOwnerStoreOptions, type OpenedOwnerStore } from "../open.js";

export const input = { kind: "vendor" as const, ownerKey: "plugin", binding: null, provider: "provider",
  label: "Shared API key", meta: { credentialType: "vendor", worksFor: ["provider"] },
  payload: { token: "a-secret-value-that-must-not-escape" }, expectedRevision: null };

/** Real files exercise persistence, WAL, file-key generation and the native migration runner. */
export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "jini-owner-store-"));
  const handles: OpenedOwnerStore[] = [];
  const open: SqliteOpener = filePath => new Database(filePath);
  const required = { filePath: join(directory, "owner.db"), keyFilePath: join(directory, "owner.key"), open };
  return { directory, required,
    async open(options: OpenOwnerStoreOptions = {}) {
      const handle = await openOwnerStore(required, options);
      handles.push(handle);
      return handle.service;
    },
    async close() {
      for (const handle of handles.splice(0)) await handle.close();
    },
    async cleanup() {
      for (const handle of handles.splice(0)) await handle.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Independent site key/repo proves that copied ciphertext is actually resealed for the site. */
export function target(consumerId: string, { repo = new InMemoryVaultRepo({}), keyHex = "42".repeat(32) } = {}): OwnerSyncTarget & { repo: InMemoryVaultRepo } {
  const keyring = new FixedSiteKeyKeyring({ hex: keyHex, hkdfSalt: "independent-site-key" });
  const vault = new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }),
    metaParsers: createVaultMetaParsers({}), authorize: async () => {},
    now: () => new Date().toISOString(), newId: () => randomUUID() });
  return { consumerId, workspaceId: `site-${consumerId}`, vault, repo };
}
