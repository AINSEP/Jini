import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../errors.js";
import { purgeTenantSettings } from "../purge-service.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import type { SettingValueRecord } from "../types.js";

/** L2 §4 purge-service: authorization is checked with the exact permission/entity, a single-subject
 *  purge touches ONLY that principal in that workspace, a tenant purge touches only that workspace,
 *  and each purged row leaves a `purge` revision naming the caller. */
const NOW = "2026-01-01T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
const val = (o: Partial<SettingValueRecord>): SettingValueRecord => ({ settingId: "s1", scope: "workspace", workspaceId: "w1", principalId: null, valueJson: 1, state: "set", defVersion: 3, seq: 1, updatedBy: "u", updatedAt: NOW, originPluginId: null, ...o } as SettingValueRecord);
function seeded() {
  return new InMemorySettingsRepo({
    workspaceValues: [val({ settingId: "s1" }), val({ settingId: "s2" }), val({ settingId: "s1", workspaceId: "w2" })],
    userValues: [val({ scope: "user", principalId: "p1" }), val({ scope: "user", principalId: "p1", settingId: "s2" }), val({ scope: "user", principalId: "p2" }), val({ scope: "user", principalId: "p1", workspaceId: "w2" })],
  });
}

describe("purgeTenantSettings", () => {
  it("authorizes with settings.definitions.manage on the workspace entity, and a denial purges nothing", async () => {
    const repo = seeded();
    const authorize = vi.fn(async () => ({ allowed: false, reason: "nope" }));
    await expect(purgeTenantSettings({ deps: { repo, clock, authorize }, input: { workspaceId: "w1", callerPrincipalId: "admin" } }))
      .rejects.toThrow(new ForbiddenError("principal 'admin' is not authorized for 'settings.definitions.manage' (nope)"));
    expect(authorize).toHaveBeenCalledWith({ principalId: "admin", permission: "settings.definitions.manage", workspaceId: "w1", entityType: "setting-workspace", entityId: "w1" });
    expect(await repo.listWorkspaceValues({ workspaceId: "w1" })).toHaveLength(2);
  });

  it("single-subject purge removes only that principal's rows in that workspace", async () => {
    const repo = seeded();
    const result = await purgeTenantSettings({ deps: { repo, clock, authorize: async () => ({ allowed: true, reason: "ok" }) }, input: { workspaceId: "w1", principalId: "p1", callerPrincipalId: "admin" } });
    expect(result).toEqual({ purgedCount: 2 });
    expect(await repo.listUserValues({ workspaceId: "w1", principalId: "p1" })).toEqual([]);
    expect(await repo.listUserValues({ workspaceId: "w1", principalId: "p2" })).toHaveLength(1);
    expect(await repo.listUserValues({ workspaceId: "w2", principalId: "p1" })).toHaveLength(1);
    expect(await repo.listWorkspaceValues({ workspaceId: "w1" })).toHaveLength(2);
    const revisions = [...await repo.listRevisions({ settingId: "s1" }), ...await repo.listRevisions({ settingId: "s2" })];
    expect(revisions.map(r => ({ op: r.op, scope: r.scope, workspaceId: r.workspaceId, principalId: r.principalId, actor: r.actor, defVersion: r.defVersion, createdAt: r.createdAt })))
      .toEqual(Array(2).fill({ op: "purge", scope: "user", workspaceId: "w1", principalId: "p1", actor: "admin", defVersion: 3, createdAt: NOW }));
  });

  it("tenant purge removes every workspace and user row of that workspace only", async () => {
    const repo = seeded();
    const result = await purgeTenantSettings({ deps: { repo, clock, authorize: async () => ({ allowed: true, reason: "ok" }) }, input: { workspaceId: "w1", callerPrincipalId: "admin" } });
    expect(result).toEqual({ purgedCount: 5 });
    expect(await repo.listWorkspaceValues({ workspaceId: "w1" })).toEqual([]);
    expect(await repo.listUserValuesByWorkspace({ workspaceId: "w1" })).toEqual([]);
    expect(await repo.listWorkspaceValues({ workspaceId: "w2" })).toHaveLength(1);
    expect(await repo.listUserValuesByWorkspace({ workspaceId: "w2" })).toHaveLength(1);
    const revisions = [...await repo.listRevisions({ settingId: "s1" }), ...await repo.listRevisions({ settingId: "s2" })];
    expect(revisions.filter(r => r.scope === "workspace").every(r => r.principalId === null && r.op === "purge")).toBe(true);
    expect(revisions.filter(r => r.scope === "user").map(r => r.principalId).sort()).toEqual(["p1", "p1", "p2"]);
  });
});
