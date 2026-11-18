import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { isRedeemable, type ConfirmationTokenRecord, type TokenStorePort } from "@jini-ai/core/gated-mutations";
import { toRecord, toRow, type GatedMutationTokensTable } from "./repo.rows.js";

/**
 * @file SPEC-022 durability fix — THE durable `TokenStorePort` adapter: one Kysely query body for
 * every dialect (storage plan §4, ADR-066). `sqlite/gated-mutation-token-repo.sqlite.ts` is the
 * thin subclass the composition root builds from the content db handle.
 *
 * Purpose:
 * `core/gated-mutations/token.ts`'s own file header disclosed that a durable token store "is not
 * required by this test slice" and shipped only `InMemoryTokenStore`. That made the
 * `gated-mutations` capability-inventory entry `hasDurableAdapter: false` — a `classification:
 * "production"` capability with no durable adapter, which `production-readiness-gate.ts`'s
 * `collectDurabilityFailures` unconditionally fails on. This adapter closes that gap: confirmation
 * tokens survive a process restart via the `gated_mutation_tokens` table (migration `0052`).
 *
 * `tryRedeem` is single-use on every dialect: the read, the `isRedeemable` check and the
 * conditional write run inside one kernel transaction holding `lockKey` on the token, so no other
 * redemption of the same token can interleave (SQLite: `BEGIN IMMEDIATE` holds the write lock;
 * Postgres: a transaction advisory lock — READ COMMITTED alone would let two redeems both read
 * `minted`). The update is also conditioned on the status it read, so a missed lock could never
 * turn into a second redemption.
 *
 * Architectural role:
 * Infrastructure adapter. `core/gated-mutations` never imports this file — it depends only on
 * `TokenStorePort`; composition roots bind the concrete class.
 */

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface TokenStoreTables { tokens: string }
export interface TokenStoreSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: TokenStoreTables;
}

export class SqlTokenStore implements TokenStorePort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: TokenStoreTables;
  constructor({ kernel, tables }: TokenStoreSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  // Host-owned table names need an explicit column schema, as in the settings adapter.
  private from(db: Kysely<unknown>) {
    return db.withTables<Record<string, GatedMutationTokensTable>>().selectFrom(this.tables.tokens);
  }

  async save({ record }: { record: ConfirmationTokenRecord }, _optional: Record<string, never> = {}): Promise<void> {
    const row = toRow({ record });
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, GatedMutationTokensTable>>()
        .insertInto(this.tables.tokens)
        .values(row)
        .onConflict((oc) => oc.column("confirmation_token").doUpdateSet(row))
        .execute()
    );
  }

  async findByToken({ token }: { token: string }, _optional: Record<string, never> = {}): Promise<ConfirmationTokenRecord | null> {
    const row = await this.kernel.run((db) =>
      this.from(db).selectAll().where("confirmation_token", "=", token).executeTakeFirst()
    );
    return row ? toRecord({ row }) : null;
  }

  /** See this file's own header for what makes this single-use on every dialect. */
  async tryRedeem(
    params: { token: string; now: string },
    _optional: Record<string, never> = {},
  ): Promise<{ redeemed: boolean; record: ConfirmationTokenRecord | null }> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(`gated_mutation_tokens:${params.token}`);
      const row = await this.kernel.run((db) =>
        this.from(db).selectAll().where("confirmation_token", "=", params.token).executeTakeFirst()
      );
      if (!row) return { redeemed: false, record: null };

      const record = toRecord({ row });
      if (!isRedeemable({ record, now: params.now })) return { redeemed: false, record };

      const result = await this.kernel.run((db) =>
        db
          .withTables<Record<string, GatedMutationTokensTable>>()
          .updateTable(this.tables.tokens)
          .set({ status: "redeemed" })
          .where("confirmation_token", "=", params.token)
          .where("status", "=", row.status)
          .executeTakeFirst()
      );
      if (Number(result.numUpdatedRows) === 0) return { redeemed: false, record };

      return { redeemed: true, record: { ...record, status: "redeemed" } };
    });
  }

  /**
   * Atomically revokes only a minted token; a concurrent redemption remains terminal.
   * @param required.token The credential to revoke.
   * @returns Resolves after one conditional UPDATE, including when no minted row exists.
   * @complexity One indexed UPDATE; O(1) application time and space.
   */
  async expire({ token }: { token: string }, _optional: Record<string, never> = {}): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, GatedMutationTokensTable>>()
        .updateTable(this.tables.tokens)
        .set({ status: "expired" })
        .where("confirmation_token", "=", token)
        .where("status", "=", "minted")
        .execute()
    );
  }

  /** Not part of the core port: the host's legacy token store contract still reads it. */
  async count(): Promise<number> {
    // An ungrouped COUNT(*) always yields exactly one non-null row, so no empty-result fallback exists.
    const row = await this.kernel.run((db) =>
      this.from(db).select((eb) => eb.fn.countAll<number | string>().as("value")).executeTakeFirstOrThrow()
    );
    return Number(row.value);
  }
}
