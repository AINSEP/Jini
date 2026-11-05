import { sql } from "kysely";
import type { MigrationStep } from "@jini-ai/db/migrate";
import type { StorageKernel } from "@jini-ai/db/kernel";

/** ADR-066: durable, credential-free intent replay state; historical rows stay ineligible. */
export const PAYMENTS_INTENT_REPLAY_ID = "0005_payments_intent_replay";

async function up(kernel: StorageKernel<unknown>): Promise<void> {
  await kernel.run(db => db.schema.alterTable("commerce_payment_attempts").addColumn("dispatch_json", "text").execute());
  await kernel.run(db => db.schema.alterTable("commerce_payment_attempts")
    .addColumn("recovery_attempts", "bigint", column => column.notNull().defaultTo(0).check(sql`recovery_attempts >= 0`)).execute());
  await kernel.run(db => db.schema.alterTable("commerce_payment_attempts").addColumn("recovery_claim_until", "bigint").execute());
}

/** Adds only the recovery fields missing from existing attempts. */
export function paymentsIntentReplay(required: { checksum: string }, _optional: Record<string, never> = {}): MigrationStep {
  return { id: PAYMENTS_INTENT_REPLAY_ID, checksum: required.checksum, up };
}
