import { describe, expect, it } from "vitest";
import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import { IdentityValidationError } from "../../core/index.js";
import { createPermissionGrantRegistry } from "../permission-grants.js";
import { registerRoleManagePermissionGrants, ROLE_MANAGE_PERMISSION } from "../role-manage-permission.js";
import { registerUserManagePermissionGrants } from "../user-manage-permission.js";
import { InMemoryUserPurge, UserDeleteUnsupportedError } from "../user-purge-types.js";
import { createUsernameChangePort } from "../username-change-ports.js";

/** An outbox that only records enqueued events; the other methods are never reached by the rename port. */
function recordingOutbox(): { outbox: OutboxPort; events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  const unused = async (): Promise<never> => { throw new Error("not used by the rename port"); };
  return { events, outbox: { enqueue: async (event) => { events.push(event); }, claimPending: unused, markDelivered: unused, markFailed: unused } };
}

describe("createUsernameChangePort", () => {
  it("refuses renaming the seeded owner and allows anyone else", async () => {
    const { outbox } = recordingOutbox();
    const port = createUsernameChangePort({ outbox, idGen: { newId: () => "evt-1" }, isInTrash: async () => false, seededOwnerPrincipalId: Promise.resolve("owner") });
    await expect(port.assertSupported({ principalId: "owner" })).rejects.toThrow(IdentityValidationError);
    await expect(port.assertSupported({ principalId: "owner" })).rejects.toThrow("the seeded owner's username cannot be changed until a persistent owner identity is configured");
    await expect(port.assertSupported({ principalId: "someone" })).resolves.toBeUndefined();
  });

  it("asks the host Trash about exactly the principal given", async () => {
    const asked: string[] = [];
    const { outbox } = recordingOutbox();
    const port = createUsernameChangePort({ outbox, idGen: { newId: () => "evt-1" }, seededOwnerPrincipalId: Promise.resolve("owner"),
      isInTrash: async ({ principalId }) => { asked.push(principalId); return principalId === "trashed"; } });
    expect(await port.isInTrash({ principalId: "trashed" })).toBe(true);
    expect(await port.isInTrash({ principalId: "live" })).toBe(false);
    expect(asked).toEqual(["trashed", "live"]);
  });

  it("records one audit event carrying both usernames, the actor and the occurrence time", async () => {
    const { outbox, events } = recordingOutbox();
    const port = createUsernameChangePort({ outbox, idGen: { newId: () => "evt-1" }, isInTrash: async () => false, seededOwnerPrincipalId: Promise.resolve("owner") });
    await port.record({ workspaceId: "ws", principalId: "p-1", callerPrincipalId: "admin", previousUsername: "ada", username: "ada2", occurredAt: "t1" });
    expect(events).toEqual([{ id: "evt-1", name: "identity.user.username_changed", workspaceId: "ws", aggregateId: "p-1", actorId: "admin", occurredAt: "t1",
      payload: { principalId: "p-1", previousUsername: "ada", username: "ada2" } }]);
  });
});

describe("built-in admin grants", () => {
  it("role.manage is granted to the admin role only", () => {
    const registry = createPermissionGrantRegistry({});
    registerRoleManagePermissionGrants({ registry });
    const grants = registry.roleGrants.list({});
    expect(ROLE_MANAGE_PERMISSION).toBe("role.manage");
    expect(grants.map(({ role, permission }) => ({ role, permission }))).toEqual([{ role: "admin", permission: "role.manage" }]);
    expect(grants[0]?.reason).toContain("Owner decision 2026-10-05");
  });

  it("user.manage is granted to the admin role only, with its owner-decision reason", () => {
    const registry = createPermissionGrantRegistry({});
    registerUserManagePermissionGrants({ registry });
    const grants = registry.roleGrants.list({});
    expect(grants.map(({ role, permission }) => ({ role, permission }))).toEqual([{ role: "admin", permission: "user.manage" }]);
    expect(grants[0]?.reason).toContain("only owners may delete, trash, disable or reset admin/owner accounts");
  });
});

describe("InMemoryUserPurge", () => {
  it("refuses outright instead of pretending to purge", async () => {
    const purge = new InMemoryUserPurge();
    await expect(purge.purgeUser({ workspaceId: "ws", principalId: "p-1" })).rejects.toThrow(UserDeleteUnsupportedError);
    await expect(purge.purgeUser({ workspaceId: "ws", principalId: "p-1" })).rejects.toThrow("user delete requires the SQLite identity store");
  });
});
