import type { Kysely } from "kysely";

export interface LedgerRow {
  id: string;
  checksum: string;
  applied_at: string;
}

type LedgerDb = Record<string, LedgerRow>;

/** Persisted identities remain host-owned; no existing row is rewritten. */
export interface LegacyLedgerMapping {
  columns: { version: string; name: string; checksum: string; appliedAt: string };
  identities: Readonly<Record<string, { version: number; name: string }>>;
  timestamps?: "database-default" | "iso";
}

/** Where one history's ledger lives, resolved from {@link MigrationOptions}. */
export interface Ledger {
  readonly table: string;
  readonly schema: string | undefined;
  readonly lockKey: string;
  readonly mapping: LegacyLedgerMapping | undefined;
  run<T>(fn: (db: Kysely<LedgerDb>) => Promise<T>): Promise<T>;
}
