import type { UUID } from "@jini-ai/core/primitives";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type { PurgeCounts, UserPurgePort, UserPurgeReason } from "./user-purge-types.js";

/**
 * @file `UserPurgePort`'s real adapter (delete-user plan decision 2/7) — the only one that can
 * actually delete anything, since it is backed by real SQL tables. One Kysely query body for every
 * dialect (storage plan §4, ADR-066); `user-purge.sqlite.ts` is the thin subclass built from the
 * content db handle.
 */

type Scope = { workspaceId: string; principalId: string };
/** The principal-scoped tables whose deleted-row counts the purge reports, in delete order. */
type CountedTable = "principal_roles" | "principal_policies" | "sessions" | "api_keys" | "setting_values_user";

export interface UserPurgeSqlPorts {
  transaction<T>(required: { run: () => Promise<T> }): Promise<T>;
  deleteCounted(required: Scope & { table: CountedTable }): Promise<number>;
  deletePrincipalVault(required: Scope): Promise<void>;
  deleteIdentityUser(required: Scope): Promise<void>;
  deletePrincipal(required: Scope): Promise<void>;
  appendOutbox(required: { event: DomainEvent }): Promise<void>;
}

/**
 * Hard-deletes a principal's identity rows and appends its audit event in ONE storage-kernel
 * transaction, so a concurrent reader can never observe the principal half-purged (the kernel's
 * transaction holds the SQLite write lock from `BEGIN IMMEDIATE`, and on Postgres nothing is
 * visible before COMMIT) — mirroring `SqliteCommerceOrderRepo.placeOrder()`'s identical "header +
 * line items in one transaction" reasoning. Any statement throwing (including the outbox insert,
 * e.g. a duplicate event id) rolls back every delete this call made — see the paired RED test.
 * Called from inside a caller's transaction (the trash core's `purgeSelected`), it joins that one.
 *
 * Deletes, in decision 2's order: `principal_roles`, `principal_policies`, `sessions`, `api_keys`
 * (only keys bound to this principal — a key an agent/api_key principal ISSUED has its own,
 * different `principalId` and is untouched), `setting_values_user`,
 * principal-bound `secrets_vault` rows (their FK already cascades with `principals` below; deleted
 * explicitly anyway so this method's own behavior does not depend on cascade ordering for a
 * credential row), `identity_users`, `principals`.
 *
 * Deliberately does NOT touch any FK-less "created by"/"actor" attribution column
 * (`posts.created_by_principal_id`, `*_revisions.actor_id`, `redirects.created_by_principal`, …) —
 * `schema.sqlite.ts`'s own header note on those columns explains why an attribution fact must
 * survive the principal it names being deleted; this method purges IDENTITY, never CONTENT.
 */
export class SqlUserPurge implements UserPurgePort {
  private readonly ports: UserPurgeSqlPorts;
  constructor(required: { ports: UserPurgeSqlPorts }, _optional = {}) {
    this.ports = required.ports;
  }

  /** @complexity O(1): eight fixed DELETE statements plus one INSERT, no loop over caller data. */
  async purgeUser(required: {
    workspaceId: UUID;
    principalId: UUID;
    buildEvent: (required: { removed: PurgeCounts }, optional?: { reason?: UserPurgeReason }) => DomainEvent;
    reason?: UserPurgeReason;
  }, _optional: Record<string, never> = {}): Promise<PurgeCounts> {
    const { workspaceId, principalId, buildEvent, reason } = required;
    return this.ports.transaction({ run: async () => {
      const roles = await this.ports.deleteCounted({ workspaceId, principalId, table: "principal_roles" });
      const policies = await this.ports.deleteCounted({ workspaceId, principalId, table: "principal_policies" });
      const sessionCount = await this.ports.deleteCounted({ workspaceId, principalId, table: "sessions" });
      const apiKeyCount = await this.ports.deleteCounted({ workspaceId, principalId, table: "api_keys" });
      const userSettings = await this.ports.deleteCounted({ workspaceId, principalId, table: "setting_values_user" });
      await this.ports.deletePrincipalVault({ workspaceId, principalId });
      await this.ports.deleteIdentityUser({ workspaceId, principalId });
      await this.ports.deletePrincipal({ workspaceId, principalId });

      const removed: PurgeCounts = { roles, policies, sessions: sessionCount, apiKeys: apiKeyCount, userSettings };
      const event = buildEvent({ removed }, reason === undefined ? {} : { reason });
      await this.ports.appendOutbox({ event });

      return removed;
    } });
  }
}
