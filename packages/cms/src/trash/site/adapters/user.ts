import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type { outboxEventValues } from "@jini-ai/db/events";
import type { TrashAdapter } from "../../index.js";
import { lazyKernel, type MarkerStore } from "./marker-sql.js";
import { loose } from "../../sql/entry-sql.js";
import { createUserTrashAdapter as createAdapter, type UserTrashAdapterDeps as UserTransitionDeps } from "@jini-ai/user-management/identity/sql/user-trash-adapter";

/**
 * @file `TrashAdapter` for users (delete-user plan v2, decision 4) — bespoke rather than a
 * `TRASHABLE` registry entry, because `hide` writes two tables (`principals` AND `sessions`) and
 * `purge` must go through `UserPurgePort.purgeUser` (`SqlUserPurge`, `identity/user-purge.ts`) for
 * its own eight-table delete, not through a single-table `compareAndDelete`. Mirrors
 * `@jini-ai/cms/trash/adapters/directory`'s "bespoke adapter" precedent.
 *
 * `entityVersion` is always `null`: `principals` has no version column, so `hide`/`unhide`/`purge`
 * never receive a meaningful `expectedVersion` to compare against (the trash core still passes one
 * through, per the shared `TrashAdapter` contract, but this adapter has nothing to check it against).
 *
 * One Kysely body over the content database's storage kernel, so the same statements run on SQLite,
 * PGlite and Postgres. Each method is read-then-write, so each runs in `kernel.transaction` holding
 * `kernel.lockKey` for the principal (a nested transaction joins the trash core's own). That lock
 * only orders Trash against Trash: `SqlPrincipalRepo.save` never takes it, so on Postgres a
 * re-enable or disable can commit between the read and the write. `hide`/`unhide` therefore repeat
 * the status they read in the `UPDATE`'s `WHERE`, and 0 affected rows is `version-changed` — no
 * stale `priorMarker`, no overwritten status, no event. `hide`/`unhide` insert their own
 * `identity.user.trashed` / `identity.user.restored` outbox event ({@link outboxEventValues}) in that
 * same transaction as the marker write; `purge`'s `purgeUser` joins it too, so the status check and
 * the delete cannot be split by a concurrent restore.
 */

export const USER_ENTITY_TYPE = "user";

export interface UserTrashAdapterDeps {
  eventValues: typeof outboxEventValues;
  assertAccountAction?: UserTransitionDeps["policy"]["assertAccountAction"];
  db: MarkerStore;
  tables: { principals: string; users: string; sessions: string; outbox: string };
  purge: UserTransitionDeps["purge"];
  idGen: { next(): string };
  clock: { nowIso(): string };
}

interface PrincipalRow {
  status: string;
  displayName: string;
}

/** @complexity O(1), one indexed read. */
async function readPrincipal({ kernel, tables, workspaceId, principalId }: { kernel: MarkerStore; tables: UserTrashAdapterDeps["tables"]; workspaceId: string; principalId: string }, _optional = {}): Promise<PrincipalRow | null> {
  const row = await kernel.run((db) =>
    loose(db)
      .selectFrom(tables.principals)
      .select(["status", "display_name"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", principalId)
      .executeTakeFirst()
  );
  return row ? { status: row.status as string, displayName: row.display_name as string } : null;
}

/** Falls back to the principal's display name for a principal with no `identity_users` row (an
 *  `api_key` principal, decision 5's "Tovu-Runner" case) — the audit event still needs a name to
 *  report even when there is no login username to give it.
 *  @complexity O(1), one indexed read. */
async function readDisplayUsername({ kernel, tables, workspaceId, principalId, fallback }: { kernel: MarkerStore; tables: UserTrashAdapterDeps["tables"]; workspaceId: string; principalId: string; fallback: string }, _optional = {}): Promise<string> {
  const row = await kernel.run((db) =>
    loose(db)
      .selectFrom(tables.users)
      .select("username")
      .where("workspace_id", "=", workspaceId)
      .where("principal_id", "=", principalId)
      .executeTakeFirst()
  );
  return (row?.username as string | undefined) ?? fallback;
}

/** @complexity O(1), one insert. */
async function appendEvent({ kernel, tables, event, eventValues }: { kernel: MarkerStore; tables: UserTrashAdapterDeps["tables"]; event: DomainEvent; eventValues: typeof outboxEventValues }, _optional = {}): Promise<void> {
  await kernel.run((db) => loose(db).insertInto(tables.outbox).values(eventValues(event)).execute());
}

/**
 * Builds the user `TrashAdapter`.
 *
 * @complexity O(1) to build; each method is O(1) plus `purge`'s delegated
 *             `UserPurgePort.purgeUser` cost (itself O(1), see that file).
 */
export function createUserTrashAdapter(deps: UserTrashAdapterDeps, _optional = {}): TrashAdapter {
  const { purge, idGen, clock, tables } = deps;
  const kernel = lazyKernel({ store: deps.db });
  return createAdapter({ purge, idGen, clock, policy: { entityType: USER_ENTITY_TYPE, assertAccountAction: deps.assertAccountAction }, store: {
    underPrincipalLock: ({ workspaceId, principalId, run }) => {
      const k = kernel();
      return k.transaction(async () => {
        await k.lockKey(`trash:${USER_ENTITY_TYPE}:${workspaceId}:${principalId}`);
        return run();
      });
    },
    readPrincipal: input => readPrincipal({ kernel: kernel(), tables, ...input }),
    readDisplayUsername: input => readDisplayUsername({ kernel: kernel(), tables, ...input }),
    compareAndSetStatus: async ({ workspaceId, principalId, expected, next, disabledAt }) => {
      const updated = await kernel().run(db => loose(db).updateTable(tables.principals)
        .set(disabledAt === undefined ? { status: next } : { status: next, disabled_at: disabledAt })
        .where("workspace_id", "=", workspaceId).where("id", "=", principalId).where("status", "=", expected).executeTakeFirst());
      return Number(updated.numUpdatedRows);
    },
    revokeSessions: async ({ workspaceId, principalId }) => {
      const revoked = await kernel().run(db => loose(db).deleteFrom(tables.sessions).where("workspace_id", "=", workspaceId).where("principal_id", "=", principalId).executeTakeFirst());
      return Number(revoked.numDeletedRows);
    },
    appendEvent: ({ event }) => appendEvent({ kernel: kernel(), tables, event, eventValues: deps.eventValues }),
  } });
}
