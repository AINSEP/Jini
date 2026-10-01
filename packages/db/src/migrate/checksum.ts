import { createHash } from "node:crypto";

/**
 * The checksum a `MigrationStep` pins: sha256 hex of the text that defines the step, exactly
 * as given. A consumer's pin test re-derives each step's checksum with this and compares it to the
 * pinned value, so an edited shipped step fails the test before it reaches a database whose ledger
 * recorded the old one. Normalising the text first (stripping comments, collapsing whitespace) is
 * the consumer's choice and must stay the same for the life of its history.
 *
 * @complexity O(length of `text`).
 */
export function sourceChecksum(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
