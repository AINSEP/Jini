import { sql } from "kysely";
import type { MigrationStep } from "../../migrate/step.js";

/** A revoked copy whose target cleanup failed. No cascade: the source entry cannot be deleted
 * while a copy may still exist on a site, so the copy can never become untracked.
 */
export const ownerRevocationsDdl = `
CREATE TABLE owner_revocations (
  entry_id TEXT NOT NULL REFERENCES secrets_vault(id),
  consumer_id TEXT NOT NULL, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, consumer_id)
);
CREATE INDEX owner_revocations_consumer ON owner_revocations (consumer_id, entry_id);
`;

/** Pin is checked against the DDL in tests; never edit this step after publication. */
export const ownerRevocationsMigration: MigrationStep = {
  id: "0001_owner_revocations",
  checksum: "ec10f3f93a6a46744e9909f0f832463873fa51805f7ab48d45ba4f90fd8b8cdb",
  async up(kernel) {
    for (const statement of ownerRevocationsDdl.split(";").filter(part => part.trim())) {
      await kernel.execute(sql.raw(statement));
    }
  },
};
