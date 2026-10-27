import { sql } from "kysely";
import type { MigrationStep } from "../../migrate/step.js";

/** A revoked copy whose target cleanup failed. No cascade: the source entry cannot be deleted
 * while a copy may still exist on a site, so the copy can never become untracked.
 * workspace_id records where the copy lives, so another workspace reusing the consumer id cannot
 * settle it. Edited in place before any release (no tag or caller had applied it; npm 0.6.12 ships 0000 only).
 * owner_grants.workspace_id binds each grant to the one workspace it copies to (null until its first sync).
 * owner_unreconciled marks entries whose copies may sit at destinations no record names: grants made
 * before binding existed, and entries restored from a version-1 backup. Deletion waits for reconciliation.
 */
export const ownerRevocationsDdl = `
CREATE TABLE owner_revocations (
  entry_id TEXT NOT NULL REFERENCES secrets_vault(id),
  consumer_id TEXT NOT NULL, workspace_id TEXT NOT NULL, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, consumer_id)
);
CREATE INDEX owner_revocations_consumer ON owner_revocations (consumer_id, entry_id);
ALTER TABLE owner_grants ADD COLUMN workspace_id TEXT;
CREATE TABLE owner_unreconciled (entry_id TEXT PRIMARY KEY REFERENCES secrets_vault(id));
INSERT INTO owner_unreconciled (entry_id) SELECT DISTINCT entry_id FROM owner_grants;
`;

/** Pin is checked against the DDL in tests; never edit this step after publication. */
export const ownerRevocationsMigration: MigrationStep = {
  id: "0001_owner_revocations",
  checksum: "0f6f5f2abdc7024da54777881c429287c70c56515fa30a1ebd3cc0afdbdb031a",
  async up(kernel) {
    for (const statement of ownerRevocationsDdl.split(";").filter(part => part.trim())) {
      await kernel.execute(sql.raw(statement));
    }
  },
};
