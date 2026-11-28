import { expect, it, vi } from "vitest";
import { createUserTrashAdapter, type UserTrashAdapterDeps } from "../user-trash-adapter.js";
import type { UserPurgePort } from "../../user-purge-types.js";

function fixture() {
  const order: string[] = [];
  let locked = false;
  const store: UserTrashAdapterDeps["store"] = {
    readPrincipal: vi.fn(async () => { order.push("read"); return { status: "disabled", displayName: "Name" }; }),
    readDisplayUsername: vi.fn(async () => "name"),
    compareAndSetStatus: vi.fn(async () => { order.push("cas"); return 0; }),
    revokeSessions: vi.fn(async () => { order.push("revoke"); return 3; }),
    appendEvent: vi.fn(async () => { order.push("event"); }),
    underPrincipalLock: async ({ run }) => { order.push("lock"); locked = true; try { return await run(); } finally { locked = false; order.push("unlock"); } },
  };
  const policy = { entityType: "user", assertAccountAction: vi.fn(async () => { order.push("guard"); }) };
  const purge = { purgeUser: vi.fn(async () => {
    expect(locked).toBe(true); order.push("purge");
    return { roles: 0, policies: 0, sessions: 0, apiKeys: 0, userSettings: 0 };
  }) };
  return { store, policy, purge, order, adapter: createUserTrashAdapter({ store, policy, purge, idGen: { next: () => "event" }, clock: { nowIso: () => "now" } }) };
}
const target = { workspaceId: "ws", entityId: "user", at: "at", expectedVersion: null };

it("a status race does not revoke sessions or emit a trash event", async () => {
  const f = fixture();
  expect(await f.adapter.hide(target, { actor: { principalId: "caller" } })).toEqual({ ok: false, reason: "version-changed" });
  expect(f.store.compareAndSetStatus).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws", principalId: "user", expected: "disabled", next: "disabled", disabledAt: "at" });
  expect(f.policy.assertAccountAction).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws", principalId: "user", action: "trash" }, { callerPrincipalId: "caller" });
  expect(f.store.revokeSessions).not.toHaveBeenCalled();
  expect(f.store.appendEvent).not.toHaveBeenCalled();
  expect(f.order).toEqual(["lock", "read", "guard", "cas", "unlock"]);
});

it("a failed protected-account guard precedes all durable writes", async () => {
  const f = fixture();
  f.policy.assertAccountAction.mockRejectedValue(new Error("protected"));
  await expect(f.adapter.hide(target)).rejects.toThrow("protected");
  expect(f.store.compareAndSetStatus).not.toHaveBeenCalled();
  expect(f.store.revokeSessions).not.toHaveBeenCalled();
  expect(f.store.appendEvent).not.toHaveBeenCalled();
  expect(f.purge.purgeUser).not.toHaveBeenCalled();
});

it("zero-row user CAS emits no identity event", async () => {
  const f = fixture();
  expect(await f.adapter.unhide(target, { priorMarker: "active" })).toEqual({ ok: false, reason: "version-changed" });
  expect(f.store.appendEvent).not.toHaveBeenCalled();
  expect(f.store.revokeSessions).not.toHaveBeenCalled();
});

it("purge joins the principal lock rather than opening a second transaction", async () => {
  const f = fixture();
  expect(await f.adapter.purge(target)).toBe("purged");
  expect(f.order).toEqual(["lock", "read", "guard", "purge", "unlock"]);
  expect(f.purge.purgeUser).toHaveBeenCalledTimes(1);
});


it("a blocked user purge leaves identity and sessions untouched", async () => {
  const f = fixture();
  // Keep the guard's order record while it refuses: mockRejectedValue would replace the recording implementation.
  f.policy.assertAccountAction.mockImplementation(async () => { f.order.push("guard"); throw new Error("protected owner"); });
  await expect(f.adapter.purge(target)).rejects.toThrow("protected owner");
  expect(f.purge.purgeUser).not.toHaveBeenCalled();
  expect(f.store.compareAndSetStatus).not.toHaveBeenCalled();
  expect(f.store.revokeSessions).not.toHaveBeenCalled();
  expect(f.store.appendEvent).not.toHaveBeenCalled();
  expect(f.order).toEqual(["lock", "read", "guard", "unlock"]);
});

it("an absent principal is not-found for hide and unhide and already-gone for purge, before the guard or any write", async () => {
  const f = fixture();
  vi.mocked(f.store.readPrincipal).mockResolvedValue(null);
  expect(await f.adapter.hide(target)).toEqual({ ok: false, reason: "not-found" });
  expect(await f.adapter.unhide(target, { priorMarker: "active" })).toEqual({ ok: false, reason: "not-found" });
  expect(await f.adapter.purge(target)).toBe("already-gone");
  expect(f.policy.assertAccountAction).not.toHaveBeenCalled();
  expect(f.store.compareAndSetStatus).not.toHaveBeenCalled();
  expect(f.purge.purgeUser).not.toHaveBeenCalled();
});

it("hide by an actor revokes sessions and records the trashed event with the actor and prior status", async () => {
  const f = fixture();
  vi.mocked(f.store.compareAndSetStatus).mockImplementation(async () => { f.order.push("cas"); return 1; });
  expect(await f.adapter.hide(target, { actor: { principalId: "caller" } })).toEqual({ ok: true, version: null, priorMarker: "disabled" });
  expect(f.store.readDisplayUsername).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws", principalId: "user", fallback: "Name" });
  expect(f.store.appendEvent).toHaveBeenCalledExactlyOnceWith({ event: { id: "event", name: "identity.user.trashed", occurredAt: "now", aggregateId: "user",
    workspaceId: "ws", actorId: "caller", payload: { principalId: "user", username: "name", priorStatus: "disabled", sessionsRevoked: 3 } } });
  expect(f.order).toEqual(["lock", "read", "guard", "cas", "revoke", "event", "unlock"]);
});

it("unhide without a prior marker restores to disabled, keeps disabled_at and records no actor", async () => {
  const f = fixture();
  vi.mocked(f.store.compareAndSetStatus).mockResolvedValue(1);
  expect(await f.adapter.unhide(target)).toEqual({ ok: true, version: null });
  expect(f.store.compareAndSetStatus).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws", principalId: "user", expected: "disabled", next: "disabled" });
  expect(f.store.appendEvent).toHaveBeenCalledExactlyOnceWith({ event: { id: "event", name: "identity.user.restored", occurredAt: "now", aggregateId: "user",
    workspaceId: "ws", payload: { principalId: "user", username: "name", restoredStatus: "disabled" } } });
});

it("unhide by an actor to active clears disabled_at and records the actor", async () => {
  const f = fixture();
  vi.mocked(f.store.compareAndSetStatus).mockResolvedValue(1);
  await f.adapter.unhide(target, { priorMarker: "active", actor: { principalId: "caller" } });
  expect(f.store.compareAndSetStatus).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws", principalId: "user", expected: "disabled", next: "active", disabledAt: null });
  expect(vi.mocked(f.store.appendEvent).mock.calls[0]?.[0].event.actorId).toBe("caller");
});

it("purge builds the deleted event from the removed counts: manual with the actor, retention without one", async () => {
  const f = fixture();
  const removed = { roles: 1, policies: 2, sessions: 3, apiKeys: 4, userSettings: 5 };
  const built: unknown[] = [];
  const calls: unknown[][] = [];
  const purge: UserPurgePort = { purgeUser: async ({ workspaceId, principalId, reason, buildEvent }) => {
    calls.push([workspaceId, principalId, reason]);
    built.push(reason === undefined ? buildEvent({ removed }) : buildEvent({ removed }, { reason }));
    return removed;
  } };
  const adapter = createUserTrashAdapter({ store: f.store, policy: f.policy, purge, idGen: { next: () => "event" }, clock: { nowIso: () => "now" } });
  expect(await adapter.purge(target, { actor: { principalId: "caller" } })).toBe("purged");
  expect(await adapter.purge(target)).toBe("purged");
  const base = { id: "event", name: "identity.user.deleted", occurredAt: "now", aggregateId: "user", workspaceId: "ws" };
  expect(built).toEqual([
    { ...base, actorId: "caller", payload: { principalId: "user", username: "name", removed, reason: "manual" } },
    { ...base, payload: { principalId: "user", username: "name", removed, reason: "retention" } },
  ]);
  expect(calls).toEqual([["ws", "user", "manual"], ["ws", "user", "retention"]]);
});

it("works without an account guard: hide and purge proceed and an active principal is still never purged", async () => {
  const f = fixture();
  vi.mocked(f.store.compareAndSetStatus).mockResolvedValue(1);
  const adapter = createUserTrashAdapter({ store: f.store, policy: { entityType: "user" }, purge: f.purge, idGen: { next: () => "event" }, clock: { nowIso: () => "now" } });
  expect(adapter.entityType).toBe("user");
  expect((await adapter.hide(target)).ok).toBe(true);
  expect(await adapter.purge(target)).toBe("purged");
  vi.mocked(f.store.readPrincipal).mockResolvedValue({ status: "active", displayName: "Name" });
  expect(await adapter.purge(target)).toBe("version-changed");
  expect(f.purge.purgeUser).toHaveBeenCalledTimes(1);
});
