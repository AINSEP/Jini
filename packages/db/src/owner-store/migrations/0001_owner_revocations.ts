import { sql } from "kysely";
import type { MigrationStep } from "../../migrate/step.js";

/** A revoked copy whose target cleanup failed. No cascade: the source entry cannot be deleted
 * while a copy may still exist on a site, so the copy can never become untracked.
 * workspace_id records where the copy lives, so another workspace reusing the consumer id cannot
 * settle it. Edited in place before any release (no tag or caller had applied it).
 */
export const ownerRevocationsDdl = `
CREATE TABLE owner_revocations (
  entry_id TEXT NOT NULL REFERENCES secrets_vault(id),
  consumer_id TEXT NOT NULL, workspace_id TEXT NOT NULL, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, consumer_id)
);
CREATE INDEX owner_revocations_consumer ON owner_revocations (consumer_id, entry_id);
`;

/** Pin is checked against the DDL in tests; never edit this step after publication. */
export const ownerRevocationsMigration: MigrationStep = {
  id: "0001_owner_revocations",
  checksum: "c151f22043b0df09937f2a94e468e769b903acead2e8d611247a048193c1619e",
  async up(kernel) {
    for (const statement of ownerRevocationsDdl.split(";").filter(part => part.trim())) {
      await kernel.execute(sql.raw(statement));
    }
  },
};
