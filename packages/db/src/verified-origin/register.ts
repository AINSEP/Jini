import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { createVerifiedOrigin, type VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import type { UUID } from "@jini-ai/core/primitives";
import { originColumns, sameOrigin, type OriginSettingsTable } from "./repo.rows.js";
import type { OriginTables } from "./repo.sql.js";

/** What {@link registerConfiguredOriginOn} did, so the composition root can log it. */
export type ConfiguredOriginWriteResult = "inserted" | "updated" | "unchanged";

/**
 * Registers the operator-declared public origin — insert-or-correct, NOT find-or-create.
 *
 * This is deliberately a different function with a different contract from
 * {@link seedDevCapabilityOriginOn}, not a change to it. The certified idempotency test
 * (`features/origin/__tests__/repo.contract.test.ts`) protects "a re-run of the boot seed can never
 * clobber a real registered origin", and that assertion stands unchanged: the dev seed only refreshes its own loopback listener
 * scheme and port. What this function adds is the one authority that IS allowed to correct the
 * row — whoever can set this deployment's process environment (the host's secret store /
 * the deploy workflow's non-secret env inputs to the hosting plugin), which is strictly more privileged than an admin-UI login and can already deploy
 * arbitrary code. Without a correcting writer, production's `http://localhost:3000` row — durably
 * persisted by the first production boot and immortal under find-or-create — could never be fixed without a
 * hand-written migration against the live DB.
 *
 * WRITES THE ORIGIN COLUMNS ONLY. `redirect_allowlist_json` and `egress_allowlist_json` are left
 * exactly as found. A blind full-row overwrite would silently empty both, which in production
 * fail-closes every `isAllowedEgressTarget` check — a behavior change with no relationship to the
 * origin it is here to fix. Pinned by that suite's "preserves both allowlists" test.
 *
 * The read and the write run in one kernel transaction under `lockKey` on the workspace's row, so
 * two booting processes cannot both see "no row" and both insert.
 *
 * @param origin - Re-validated through `createVerifiedOrigin`, so the ADR-040 scheme/source
 * invariant cannot be bypassed by a caller that hand-built the object.
 * @returns which write happened, for the boot log.
 * @throws {InsecureOriginSourceError} if `origin` violates the scheme/source invariant. Callers
 * pass `resolveConfiguredOrigin`'s output, which can never produce that combination.
 * @complexity O(1) — one indexed lookup plus at most one write.
 */
export async function registerConfiguredOrigin(
  { kernel, tables, workspaceId, origin }: {
    kernel: StorageKernel<Kysely<unknown>, unknown>;
    tables: OriginTables;
    workspaceId: UUID;
    origin: VerifiedOrigin;
  },
  _optional: Record<string, never> = {},
): Promise<ConfiguredOriginWriteResult> {
  const verified = createVerifiedOrigin(origin);
  const view = (db: Kysely<unknown>) => db.withTables<Record<string, OriginSettingsTable>>();
  return kernel.transaction(async () => {
    await kernel.lockKey(`origin_settings:${workspaceId}`);
    const existing = await kernel.run((db) =>
      view(db).selectFrom(tables.origins).selectAll().where("workspace_id", "=", workspaceId).executeTakeFirst()
    );
    if (!existing) {
      await kernel.run((db) =>
        view(db)
          .insertInto(tables.origins)
          .values({ workspace_id: workspaceId, ...originColumns(verified), redirect_allowlist_json: "[]", egress_allowlist_json: "[]" })
          .execute()
      );
      return "inserted";
    }

    if (sameOrigin(existing, verified)) return "unchanged";

    await kernel.run((db) => view(db).updateTable(tables.origins).set(originColumns(verified)).where("workspace_id", "=", workspaceId).execute());
    return "updated";
  });
}
