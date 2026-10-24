import { sql } from "kysely";
import type { MigrationStep } from "../../migrate/step.js";

/** Owner-only history: no site tables or foreign workspace records are required. */
export const ownerStoreDdl = `
CREATE TABLE secrets_vault (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, owner_key TEXT NOT NULL,
  principal_id TEXT, binding TEXT, provider TEXT, label TEXT NOT NULL, is_default INTEGER NOT NULL,
  revision INTEGER NOT NULL, sealed_key_id TEXT, sealed_ciphertext TEXT, sealed_nonce TEXT, sealed_alg TEXT,
  last4 TEXT, token_length INTEGER, meta TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
CREATE UNIQUE INDEX owner_vault_default ON secrets_vault
  (workspace_id, kind, owner_key, (principal_id IS NULL), coalesce(principal_id, ''),
   (provider IS NULL), coalesce(provider, '')) WHERE is_default = 1;
CREATE UNIQUE INDEX owner_vault_label ON secrets_vault
  (workspace_id, kind, owner_key, (principal_id IS NULL), coalesce(principal_id, ''),
   (provider IS NULL), coalesce(provider, ''), label);
CREATE INDEX owner_vault_lookup ON secrets_vault
  (workspace_id, kind, owner_key, principal_id, provider, is_default);
CREATE INDEX owner_vault_promotion ON secrets_vault
  (workspace_id, kind, owner_key, principal_id, provider, updated_at DESC, id COLLATE BINARY DESC);
CREATE TABLE owner_grants (
  entry_id TEXT NOT NULL REFERENCES secrets_vault(id) ON DELETE CASCADE,
  consumer_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, consumer_id)
);
CREATE INDEX owner_grants_consumer ON owner_grants (consumer_id, entry_id);
`;

/** Pin is checked against the DDL in tests; never edit this step after publication. */
export const ownerStoreMigration: MigrationStep = {
  id: "0000_owner_store",
  checksum: "ea2c33cf1835f6b1db0f52a4de3419aaf8c1a2e2edeece1e2b3240c517592446",
  async up(kernel) {
    // Kysely executes one SQLite statement at a time; the runner owns the encompassing transaction.
    for (const statement of ownerStoreDdl.split(";").filter(part => part.trim())) {
      await kernel.execute(sql.raw(statement));
    }
  },
};
