import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type { Kysely } from "kysely";
import { SqlUserPurge, type UserPurgeSqlPorts } from "../user-purge.js";

/**
 * @file The kernel-backed {@link UserPurgeSqlPorts}: one Kysely query body per port for every dialect, run on
 * the host's shared storage kernel so the purge joins the caller's transaction and lock keys.
 *
 * The tables are the identity schema this package owns (`principals`, `identity_users`, `principal_roles`,
 * `principal_policies`, `sessions`, `api_keys`, `setting_values_user`, `secrets_vault`) plus the host's
 * `outbox_events`; the host supplies only the kernel and its outbox row encoder (`eventValues`).
 * Moved from the Tovu host's `features/identity/user-purge.ts` (merge-25).
 */

/** The one column every purged table is scoped by, plus the owner column the counted tables share. */
interface ScopedRow { workspace_id: string; principal_id: string }
interface PrincipalRow { workspace_id: string; id: string }
type PurgeTables = Record<string, ScopedRow> & { principals: PrincipalRow; outbox_events: Record<string, unknown> };

export interface KernelUserPurgeRequired {
  kernel: Pick<StorageKernel<Kysely<unknown>, unknown>, "run" | "transaction">;
  /** The host's outbox row encoder for a domain event (for example `@jini-ai/db/events`' `outboxEventValues`). */
  eventValues: (event: DomainEvent) => Record<string, unknown>;
}

/**
 * Build the purge ports over one kernel.
 * @complexity O(1) per port call (one statement each).
 */
export function createKernelUserPurgePorts({ kernel, eventValues }: KernelUserPurgeRequired, _optional: Record<string, never> = {}): UserPurgeSqlPorts {
  const run = <T>(fn: (db: Kysely<PurgeTables>) => Promise<T>): Promise<T> => kernel.run((db) => fn(db.withTables<PurgeTables>()));
  return {
    transaction: ({ run: body }) => kernel.transaction(body),
    deleteCounted: async ({ table, workspaceId, principalId }) => {
      const result = await run((db) => db.deleteFrom(table).where("workspace_id", "=", workspaceId).where("principal_id", "=", principalId).executeTakeFirst());
      return Number(result.numDeletedRows);
    },
    deletePrincipalVault: async ({ workspaceId, principalId }) => {
      await run((db) => db.deleteFrom("secrets_vault").where("workspace_id", "=", workspaceId).where("principal_id", "=", principalId).execute());
    },
    deleteIdentityUser: async ({ workspaceId, principalId }) => {
      await run((db) => db.deleteFrom("identity_users").where("workspace_id", "=", workspaceId).where("principal_id", "=", principalId).execute());
    },
    deletePrincipal: async ({ workspaceId, principalId }) => {
      await run((db) => db.deleteFrom("principals").where("workspace_id", "=", workspaceId).where("id", "=", principalId).execute());
    },
    appendOutbox: async ({ event }) => {
      await run((db) => db.insertInto("outbox_events").values(eventValues(event)).execute());
    },
  };
}

/** {@link SqlUserPurge} bound to a storage kernel — the host's real `UserPurgePort`. */
export class KernelUserPurge extends SqlUserPurge {
  constructor(required: KernelUserPurgeRequired, _optional: Record<string, never> = {}) {
    super({ ports: createKernelUserPurgePorts(required) });
  }
}
