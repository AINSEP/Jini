import { expect, it, vi } from "vitest";
import { createUserTrashAdapter, type UserTrashAdapterDeps } from "../user-trash-adapter.js";

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
