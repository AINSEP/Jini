import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { sql } from "kysely";
import { afterEach, describe, test } from "vitest";
import { VaultError, type VaultRecord } from "@jini-ai/platform/secrets/credential-sets/contracts";

import { openPgliteKernel } from "../../kernel/pglite/index.js";
import type { StorageKernel } from "../../kernel/port.js";
import { sqliteKernel } from "../../kernel/sqlite/index.js";
import { SqlSecretsVaultRepo, type SecretsVaultDatabase } from "../repo.sql.js";

/**
 * @file How the SQL vault reads rows it did not write itself: the host owns the DDL and the driver,
 * so a row can be half-sealed, carry unparseable meta, have a NULL default flag or a duplicated id
 * (no constraint stops it), or come back from a driver that already parsed `jsonb` into an object.
 */

const kernels: Array<StorageKernel<SecretsVaultDatabase>> = [];
afterEach(async () => {
  for (const kernel of kernels.splice(0)) await kernel.close();
});

/** The adapter's columns with no NOT NULL and no key: the loosest schema a host could give it. */
async function looseSqliteVault(): Promise<{ kernel: StorageKernel<SecretsVaultDatabase>; repo: SqlSecretsVaultRepo }> {
  const kernel = sqliteKernel<SecretsVaultDatabase>(new Database(":memory:"));
  kernels.push(kernel);
  await kernel.execute(sql`CREATE TABLE secrets_vault (
    workspace_id TEXT, id TEXT, kind TEXT, owner_key TEXT, principal_id TEXT, binding TEXT, provider TEXT,
    label TEXT, is_default BOOLEAN, revision INTEGER, sealed_key_id TEXT, sealed_ciphertext TEXT,
    sealed_nonce TEXT, sealed_alg TEXT, last4 TEXT, token_length INTEGER, meta TEXT, created_at TEXT, updated_at TEXT)`);
  return { kernel, repo: new SqlSecretsVaultRepo({ kernel }) };
}

/** Inserts a raw row: `id`, the default flag, the sealed parts and meta exactly as given. */
async function insertRaw(
  kernel: StorageKernel<SecretsVaultDatabase>,
  row: { id: string; isDefault: number | null; sealed: [string | null, string | null, string | null, string | null]; meta: string }
): Promise<void> {
  const [keyId, ciphertext, nonce, alg] = row.sealed;
  await kernel.execute(sql`INSERT INTO secrets_vault VALUES (
    'ws', ${row.id}, 'vendor', 'deploy', NULL, NULL, 'host', ${`label-${row.id}`}, ${row.isDefault}, 1,
    ${keyId}, ${ciphertext}, ${nonce}, ${alg}, NULL, NULL, ${row.meta}, 'created', 'updated')`);
}

const scope = { workspaceId: "ws", kind: "vendor" as const, ownerKey: "deploy", principalId: null, provider: "host" };
const unsealed: [null, null, null, null] = [null, null, null, null];

describe("rows the SQL vault refuses", () => {
  test("a row with only some sealed parts is an invalid record, never a half-decryptable secret", async () => {
    const { kernel, repo } = await looseSqliteVault();
    await insertRaw(kernel, { id: "half", isDefault: 0, sealed: ["key-1", null, "nonce-1", "aes-256-gcm"], meta: "{}" });

    await assert.rejects(repo.find({ workspaceId: "ws", id: "half" }), (error: unknown) => error instanceof VaultError && error.code === "invalid-record");
  });

  test("meta that is not JSON is invalid meta", async () => {
    const { kernel, repo } = await looseSqliteVault();
    await insertRaw(kernel, { id: "garbled", isDefault: 0, sealed: unsealed, meta: "{not json" });

    await assert.rejects(repo.list(scope), (error: unknown) => error instanceof VaultError && error.code === "invalid-meta");
  });
});

describe("rows the SQL vault normalizes", () => {
  test("a NULL default flag reads as not the default", async () => {
    const { kernel, repo } = await looseSqliteVault();
    await insertRaw(kernel, { id: "unflagged", isDefault: null, sealed: unsealed, meta: '{"accountLabel":null}' });

    const found = await repo.find({ workspaceId: "ws", id: "unflagged" });
    assert.equal(found?.isDefault, false);
    assert.deepEqual(found?.meta, { accountLabel: null });
  });

  test("list orders by id code units, keeping duplicated ids (no key in the host schema) side by side", async () => {
    const { kernel, repo } = await looseSqliteVault();
    for (const id of ["b", "a", "B", "b"]) await insertRaw(kernel, { id, isDefault: 0, sealed: unsealed, meta: "{}" });

    assert.deepEqual((await repo.list(scope)).map((record) => record.id), ["B", "a", "b", "b"]);
  });
});

/** A PGlite with the driver's own parsers (jsonb parsed into objects), as a host kernel over default node-postgres would be. */
class JsonParsingPGlite extends PGlite {
  constructor(dataDirOrOptions?: string | PGliteOptions, options?: PGliteOptions) {
    const given = typeof dataDirOrOptions === "string" ? { ...options, dataDir: dataDirOrOptions } : dataDirOrOptions;
    super({ ...given, parsers: {} });
  }
}

test("meta a driver already parsed into an object is used as is, and round-trips through put", async () => {
  const kernel = openPgliteKernel<SecretsVaultDatabase>({ PGlite: JsonParsingPGlite });
  kernels.push(kernel);
  await kernel.execute(sql`CREATE TABLE secrets_vault (
    workspace_id text NOT NULL, id text NOT NULL, kind text NOT NULL, owner_key text NOT NULL, principal_id text,
    binding text, provider text, label text NOT NULL, is_default boolean NOT NULL, revision integer NOT NULL,
    sealed_key_id text, sealed_ciphertext text, sealed_nonce text, sealed_alg text, last4 text, token_length integer,
    meta jsonb NOT NULL, created_at text NOT NULL, updated_at text NOT NULL, PRIMARY KEY (workspace_id, id))`);
  const [probe] = await kernel.query<{ meta: unknown }>(sql`SELECT '{"accountLabel":"probe"}'::jsonb AS meta`);
  assert.deepEqual(probe?.meta, { accountLabel: "probe" }, "this driver hands back jsonb as an object");
  const repo = new SqlSecretsVaultRepo({ kernel });
  const record: VaultRecord = {
    workspaceId: "ws", id: "obj", kind: "vendor", ownerKey: "deploy", principalId: null, binding: null, provider: "host",
    label: "Work account", isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null,
    meta: { accountLabel: "Work account" }, createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z",
  };

  await repo.put({ record, expectedRevision: null });

  const found = await repo.find({ workspaceId: "ws", id: "obj" });
  assert.deepEqual(found?.meta, { accountLabel: "Work account" });
  assert.equal(found?.label, "Work account");
});
