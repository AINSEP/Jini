import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { OriginSettingRepoPort, VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import type { UUID } from "@jini-ai/core/primitives";
import { toVerifiedOrigin, type OriginRow, type OriginSettingsTable } from "./repo.rows.js";

/**
 * @file ADR-046 Phase 1 — THE durable `OriginSettingRepoPort` adapter: one Kysely query body for
 * every dialect (storage plan §4, ADR-066); ADR-006 rule-of-two "second adapter" half,
 * `Jini packages/http-kit/src/verified-origin/repo.memory.ts`'s `InMemoryOriginSettingRepo` is the first.
 * `sqlite/origin-repo.sqlite.ts` is the thin layer the composition root builds from the content db
 * handle.
 *
 * Purpose:
 * The workspace's verified origin and its two allowlists previously lived only in-memory in the
 * real running server's composition root — worse, hardcoded fresh into the constructor's seed
 * array on every boot, not even genuinely "seeded once." This adapter makes the row durable.
 *
 * The READ adapter is read-only by design (matches `OriginSettingRepoPort`, which declares no write
 * method). Writes are two standalone boot-time functions below, not port methods — ADR-006's
 * rule-of-two says don't abstract before the second adapter needs it, and there is still only one
 * durable adapter:
 *
 * 1. {@link seedDevCapabilityOriginOn} — the idempotent find-or-create dev default
 *    (the current loopback listener), preserving operator registrations.
 * 2. {@link registerConfiguredOriginOn} — the operator-declared public origin, from
 *    `features/origin/configured-origin.ts`'s public-URL resolver (2026-09-18; design note:
 *    `ADS-memory/reports/2026-09-18-public-origin-registration-design.md`). This is what finally
 *    closes the "no way to register a real production origin" gap this header used to disclose as
 *    permanent, and it is why production's sitemap can emit absolute URLs again.
 *
 * Both writers are async (the kernel is), so the composition root hands the read adapter the boot
 * write's promise as `after`: every read waits for it, and a boot write that failed fails the reads
 * instead of letting them see a half-booted row.
 *
 * Still open, and still a real gap: no ADMIN route or reachability/ownership VERIFICATION flow
 * exists (ADR-040's own "Open" section keeps that as a v0.1 item). Registration authority today is
 * "whoever can set this deployment's process environment", nothing weaker and nothing stronger.
 */

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface OriginTables { origins: string }
export interface OriginSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: OriginTables;
}
export interface OriginSqlOptional {
  /** Reads wait for it (the host's boot write); see the file header. */
  after?: Promise<unknown>;
}

export class SqlOriginSettingRepo implements OriginSettingRepoPort {
  /** @param options.after - Reads wait for it (the composition root's boot write); see the file header. */
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: OriginTables;
  private readonly after: Promise<unknown> | undefined;
  constructor({ kernel, tables }: OriginSqlRequired, optional: OriginSqlOptional = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.after = optional.after;
  }

  private async row(workspaceId: UUID): Promise<OriginRow | undefined> {
    await this.after;
    return this.kernel.run((db) =>
      db
        .withTables<Record<string, OriginSettingsTable>>()
        .selectFrom(this.tables.origins)
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .executeTakeFirst()
    );
  }

  async findByWorkspaceId({ workspaceId }: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<VerifiedOrigin | null> {
    const row = await this.row(workspaceId);
    return row ? toVerifiedOrigin(row) : null;
  }

  async findRedirectAllowlist({ workspaceId }: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<string[]> {
    const row = await this.row(workspaceId);
    return row ? (JSON.parse(row.redirect_allowlist_json) as string[]) : [];
  }

  async findEgressAllowlist({ workspaceId }: { workspaceId: UUID }, _optional: Record<string, never> = {}): Promise<string[]> {
    const row = await this.row(workspaceId);
    return row ? (JSON.parse(row.egress_allowlist_json) as string[]) : [];
  }
}
