import { describe, expect, it, vi } from "vitest";

import { ForbiddenError, PrincipalNotFoundError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { clear, set } from "../write-service.js";
import type { SettingDefinitionRecord } from "../types.js";
import { InMemorySettingsPrincipalLookup } from "./principal.fixture.js";

/** L2 §8.4: one scope-guard clause per case — workspace/auth mismatch, global partition forcing,
 *  user-scope principal defaulting and the cross-principal membership check. */
const NOW = "2026-07-11T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
let n = 0;
const ids = { newId: () => `id-${++n}` };

function definition(scopes: number, overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return { settingId: "s-1", version: 1, workspaceId: null, namespace: "core.presentation", key: "theme", ownerKind: "core", ownerId: null,
    schema: { type: "string" }, defaultValue: "paper", scopes, secret: false, status: "active", aliasOfNamespace: null, aliasOfKey: null,
    coercionTag: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}
function deps(def: SettingDefinitionRecord, principals = new InMemorySettingsPrincipalLookup([])) {
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const authorize = vi.fn(async () => ({ allowed: true, reason: "matched" }));
  return { repo, authorize, principals, deps: { repo, clock, ids, authorize, principals } };
}
const base = { namespace: "core.presentation", key: "theme", value: "atlas", callerPrincipalId: "actor-1" };

describe("workspace target must equal the authorized workspace", () => {
  it.each(["workspace", "user"] as const)("scope=%s with workspaceId ≠ authWorkspaceId → ForbiddenError, nothing written", async (scope) => {
    const ctx = deps(definition(6));
    const attempt = set({ deps: ctx.deps, input: { ...base, scope, workspaceId: "ws-2", authWorkspaceId: "ws-1" } });
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attempt).rejects.toThrow("principal 'actor-1' authorized against workspace 'ws-1' but the write targets workspace 'ws-2'");
    expect(ctx.authorize).not.toHaveBeenCalled();
    expect(await ctx.repo.listRevisions({ settingId: "s-1" })).toEqual([]);
    await expect(clear({ deps: ctx.deps, input: { namespace: base.namespace, key: base.key, callerPrincipalId: "actor-1", scope, workspaceId: "ws-2", authWorkspaceId: "ws-1" } })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("matching ids are allowed and the revision lands in that workspace", async () => {
    const ctx = deps(definition(2));
    await set({ deps: ctx.deps, input: { ...base, scope: "workspace", workspaceId: "ws-1", authWorkspaceId: "ws-1" } });
    const [revision] = await ctx.repo.listRevisions({ settingId: "s-1" });
    expect(revision).toMatchObject({ scope: "workspace", workspaceId: "ws-1", principalId: null, actor: "actor-1", op: "set" });
  });

  it("scope=global is exempt from the mismatch check and always writes workspaceId null, principalId null", async () => {
    const ctx = deps(definition(1));
    await set({ deps: ctx.deps, input: { ...base, scope: "global", workspaceId: "ws-2", authWorkspaceId: "ws-1", principalId: "someone" } });
    const [revision] = await ctx.repo.listRevisions({ settingId: "s-1" });
    expect(revision).toMatchObject({ scope: "global", workspaceId: null, principalId: null });
  });
});

describe("user scope principal handling", () => {
  it("defaults the stored principal to the caller when principalId is omitted", async () => {
    const ctx = deps(definition(4));
    await set({ deps: ctx.deps, input: { ...base, scope: "user", workspaceId: "ws-1" } });
    const [revision] = await ctx.repo.listRevisions({ settingId: "s-1" });
    expect(revision).toMatchObject({ scope: "user", workspaceId: "ws-1", principalId: "actor-1" });
    expect((await ctx.repo.getUserValue({ workspaceId: "ws-1", principalId: "actor-1", settingId: "s-1" }))?.valueJson).toBe("atlas");
  });

  it("an explicit principalId equal to the caller skips the membership lookup", async () => {
    const lookup = new InMemorySettingsPrincipalLookup([]);
    const spy = vi.spyOn(lookup, "findActiveById");
    const ctx = deps(definition(4), lookup);
    await set({ deps: ctx.deps, input: { ...base, scope: "user", workspaceId: "ws-1", principalId: "actor-1" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("another principal is looked up IN the request workspace and refused when absent there", async () => {
    const lookup = new InMemorySettingsPrincipalLookup([{ id: "other", workspaceId: "ws-9", kind: "user", displayName: "O", status: "active", createdAt: NOW }]);
    const spy = vi.spyOn(lookup, "findActiveById");
    const ctx = deps(definition(4), lookup);
    const attempt = set({ deps: ctx.deps, input: { ...base, scope: "user", workspaceId: "ws-1", principalId: "other" } });
    await expect(attempt).rejects.toBeInstanceOf(PrincipalNotFoundError);
    expect(spy).toHaveBeenCalledWith({ workspaceId: "ws-1", id: "other" });
    expect(await ctx.repo.listRevisions({ settingId: "s-1" })).toEqual([]);
  });

  it("workspace scope never consults the principal lookup even when a principalId is passed", async () => {
    const lookup = new InMemorySettingsPrincipalLookup([]);
    const spy = vi.spyOn(lookup, "findActiveById");
    const ctx = deps(definition(2), lookup);
    await set({ deps: ctx.deps, input: { ...base, scope: "workspace", workspaceId: "ws-1", principalId: "other" } });
    expect(spy).not.toHaveBeenCalled();
    const [revision] = await ctx.repo.listRevisions({ settingId: "s-1" });
    expect(revision).toMatchObject({ principalId: null });
  });
});

describe("clear() revision partition mirrors set()", () => {
  it("global clear writes workspaceId null and principalId null even when both are passed", async () => {
    const ctx = deps(definition(1));
    await clear({ deps: ctx.deps, input: { namespace: base.namespace, key: base.key, callerPrincipalId: "actor-1", scope: "global", workspaceId: "ws-2", authWorkspaceId: "ws-1", principalId: "p" } });
    const [revision] = await ctx.repo.listRevisions({ settingId: "s-1" });
    expect(revision).toMatchObject({ scope: "global", workspaceId: null, principalId: null, op: "clear", actor: "actor-1" });
  });
  it("workspace clear keeps the workspace and drops the principal", async () => {
    const ctx = deps(definition(2));
    await clear({ deps: ctx.deps, input: { namespace: base.namespace, key: base.key, callerPrincipalId: "actor-1", scope: "workspace", workspaceId: "ws-1", principalId: "p" } });
    const [revision] = await ctx.repo.listRevisions({ settingId: "s-1" });
    expect(revision).toMatchObject({ scope: "workspace", workspaceId: "ws-1", principalId: null });
  });
  it("user clear defaults the principal to the caller, or keeps an explicit one", async () => {
    const ctx = deps(definition(4), new InMemorySettingsPrincipalLookup([{ id: "other", workspaceId: "ws-1", kind: "user", displayName: "O", status: "active", createdAt: NOW }]));
    await clear({ deps: ctx.deps, input: { namespace: base.namespace, key: base.key, callerPrincipalId: "actor-1", scope: "user", workspaceId: "ws-1" } });
    await clear({ deps: ctx.deps, input: { namespace: base.namespace, key: base.key, callerPrincipalId: "actor-1", scope: "user", workspaceId: "ws-1", principalId: "other" } });
    const revisions = await ctx.repo.listRevisions({ settingId: "s-1" });
    expect(revisions.map(r => r.principalId).sort()).toEqual(["actor-1", "other"]);
    expect(revisions.every(r => r.workspaceId === "ws-1")).toBe(true);
  });
  it("a denied clear names the permission and reason and writes nothing", async () => {
    const ctx = deps(definition(2));
    ctx.authorize.mockResolvedValueOnce({ allowed: false, reason: "no-role" });
    await expect(clear({ deps: ctx.deps, input: { namespace: base.namespace, key: base.key, callerPrincipalId: "actor-1", scope: "workspace", workspaceId: "ws-1" } }))
      .rejects.toThrow(/principal 'actor-1' is not authorized for '.+' \(no-role\)/);
    expect(await ctx.repo.listRevisions({ settingId: "s-1" })).toEqual([]);
    expect(ctx.authorize).toHaveBeenCalledWith(expect.objectContaining({ principalId: "actor-1", workspaceId: "ws-1", entityType: "setting-value" }));
  });
});
