/**
 * Compile-time drift pin: commerce copies the options of db's `runMigrations` (minus `ledgerTable`)
 * so it need not import db at runtime. The options are all-optional, so mutual assignability alone
 * would accept a dropped field; the key comparison below fails when either side gains or loses one.
 */
import type { KyselyKernel } from "@jini-ai/db/kernel";
import type { MigrationOptions, MigrationReport, runMigrations } from "@jini-ai/db/migrate";
import type { PaymentsMigrationOptions, PaymentsMigrationRunner } from "../index.js";

type DbOptions = Omit<MigrationOptions, "ledgerTable">;
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;

export const optionKeysMatchDb: SameKeys<DbOptions, PaymentsMigrationOptions> = true;
export const optionsToDb: DbOptions = {} as PaymentsMigrationOptions;
export const optionsFromDb: PaymentsMigrationOptions = {} as DbOptions;
declare const dbRunMigrations: typeof runMigrations;
export const dbRunnerFits = dbRunMigrations satisfies PaymentsMigrationRunner<KyselyKernel<unknown>, MigrationReport>;
