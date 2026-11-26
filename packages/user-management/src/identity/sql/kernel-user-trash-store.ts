import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type { Kysely } from "kysely";
import { createUserTrashAdapter, type UserTrashAdapterDeps } from "./user-trash-adapter.js";

interface UserTrashTables {
  principals: { workspace_id: string; id: string; status: string; display_name: string; disabled_at: string | null };
  identity_users: { workspace_id: string; principal_id: string; username: string };
  sessions: { workspace_id: string; principal_id: string };
  outbox_events: Record<string, unknown>;
}

export function bindKernelUserTrashAdapter({ kernelFor, entityType }: {
  kernelFor: (required: { store: StorageKernel<unknown, unknown> }) => () => StorageKernel<Kysely<unknown>, unknown>;
  entityType: string;
}, _optional: Record<string, never> = {}) {
  return (deps: Pick<UserTrashAdapterDeps, "purge" | "idGen" | "clock"> & {
    db: StorageKernel<unknown, unknown>;
    eventValues: (event: DomainEvent) => Record<string, unknown>;
    assertAccountAction: NonNullable<UserTrashAdapterDeps["policy"]["assertAccountAction"]>;
  }, _optional: Record<string, never> = {}) => {
    const kernel = kernelFor({ store: deps.db });
    return createUserTrashAdapter({ ...deps, policy: { entityType, assertAccountAction: deps.assertAccountAction }, store: {
      readPrincipal: async ({ workspaceId, principalId }) => {
        const row = await kernel().run(db => db.withTables<UserTrashTables>().selectFrom("principals")
          .select(["status", "display_name"]).where("workspace_id", "=", workspaceId).where("id", "=", principalId).executeTakeFirst());
        return row ? { status: row.status, displayName: row.display_name } : null;
      },
      readDisplayUsername: async ({ workspaceId, principalId, fallback }) => {
        const row = await kernel().run(db => db.withTables<UserTrashTables>().selectFrom("identity_users")
          .select("username").where("workspace_id", "=", workspaceId).where("principal_id", "=", principalId).executeTakeFirst());
        return row?.username ?? fallback;
      },
      compareAndSetStatus: async ({ workspaceId, principalId, expected, next, disabledAt }) => {
        const result = await kernel().run(db => db.withTables<UserTrashTables>().updateTable("principals")
          .set({ status: next, ...(disabledAt === undefined ? {} : { disabled_at: disabledAt }) })
          .where("workspace_id", "=", workspaceId).where("id", "=", principalId).where("status", "=", expected).executeTakeFirst());
        return Number(result.numUpdatedRows);
      },
      revokeSessions: async ({ workspaceId, principalId }) => {
        const result = await kernel().run(db => db.withTables<UserTrashTables>().deleteFrom("sessions")
          .where("workspace_id", "=", workspaceId).where("principal_id", "=", principalId).executeTakeFirst());
        return Number(result.numDeletedRows);
      },
      appendEvent: async ({ event }) => {
        await kernel().run(db => db.withTables<UserTrashTables>().insertInto("outbox_events").values(deps.eventValues(event)).execute());
      },
      /** Runs `body` in one transaction holding the principal's row lock. */
      underPrincipalLock: ({ workspaceId, principalId, run }) => {
        const k = kernel();
        return k.transaction(async () => {
          await k.lockKey(`trash:${entityType}:${workspaceId}:${principalId}`);
          return run();
        });
      },
    } });
  };
}
