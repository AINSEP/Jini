import { describe, expect, it } from "vitest";
import { projectKeyUseRoute, type ProjectKeyUseRouteDeps } from "../project-key-use.js";
import { PRINCIPAL, raw, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file The project key use spec: owner-only, store presence, body rule, two ordered authorizations, ToolInputError mapping. */

class ToolInputError extends Error { override name = "ToolInputError"; }

function deps(overrides: Partial<ProjectKeyUseRouteDeps> = {}) {
  const uses: unknown[] = [];
  const lookups: string[] = [];
  const value: ProjectKeyUseRouteDeps = {
    workspaceId: WORKSPACE_ID, ownerOnlyMessage: "owner only (host copy)",
    ownerPrincipalId: async () => PRINCIPAL.id,
    projectKeys: {
      permissionFor: async ({ keyId }) => { lookups.push(keyId); return "admin.plugins.enable"; },
      use: async (input) => { uses.push(input); return { ...input, usedByThisSite: input.use }; },
    },
    ...overrides,
  };
  return { value, uses, lookups };
}

function recorder(denied: readonly string[] = []) {
  const calls: unknown[] = [];
  return { calls, authorize: async (args: { permission: string; entityType?: string }, ...scope: unknown[]) => {
    calls.push(scope.length ? [args, ...scope] : args);
    if (denied.includes(args.permission)) throw new Error(`denied ${args.permission}`);
  } };
}

const run = (d: ProjectKeyUseRouteDeps, body: unknown, authorize = recorder().authorize) =>
  projectKeyUseRoute.handle({ input: { keyId: "k1", body }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("projectKeyUseRoute", () => {
  it("pins method, path, default status and no cap; parse passes keyId (String, no fallback) and the raw body", () => {
    expect(projectKeyUseRoute.method).toBe("put");
    expect(projectKeyUseRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/project-keys/:keyId/use");
    expect(projectKeyUseRoute.successStatus).toBeUndefined();
    expect(projectKeyUseRoute.maxBodyBytes).toBeUndefined();
    expect(projectKeyUseRoute.parse(raw({ keyId: "a:b" }, { use: true }))).toEqual({ ok: true, value: { keyId: "a:b", body: { use: true } } });
    expect(projectKeyUseRoute.parse(raw({}, null))).toEqual({ ok: true, value: { keyId: "undefined", body: null } });
  });

  it("asks custom-credentials.read, then the key's own save permission (no entity type, no scope), then uses the key", async () => {
    const { authorize, calls } = recorder();
    const d = deps();
    expect(await run(d.value, { use: true }, authorize)).toEqual({ ok: true, value: { keyId: "k1", use: true, usedByThisSite: true } });
    expect(calls).toEqual([{ permission: "custom-credentials.read" }, { permission: "admin.plugins.enable" }]);
    expect(d.uses).toEqual([{ keyId: "k1", use: true }]);
  });

  it("refuses a non-owner with the host copy, before the store check, the body rule or any lookup", async () => {
    const d = deps({ ownerPrincipalId: async () => "someone-else", projectKeys: undefined });
    expect(await refusalOf(() => run(d.value, "bad"))).toEqual({ status: 403, body: { error: "owner only (host copy)" } });
    expect(await refusalOf(() => run(deps({ ownerPrincipalId: async () => undefined }).value, { use: true }))).toMatchObject({ status: 403 });
  });

  it("no key store 503 before the body rule; body must be exactly { use: boolean }", async () => {
    expect(await refusalOf(() => run(deps({ projectKeys: undefined }).value, "bad"))).toEqual({ status: 503, body: { error: "This site has no project key store." } });
    for (const body of [null, { use: "true" }, { use: true, extra: 1 }, []]) {
      const d = deps();
      expect(await refusalOf(() => run(d.value, body))).toEqual({ status: 400, body: { error: "use must be true or false" } });
      expect(d.lookups).toEqual([]);
    }
  });

  it("a denied base read stops before the key lookup; a denied key permission stops before use", async () => {
    const d = deps();
    await expect(run(d.value, { use: true }, recorder(["custom-credentials.read"]).authorize)).rejects.toThrow("denied");
    expect(d.lookups).toEqual([]);
    await expect(run(d.value, { use: true }, recorder(["admin.plugins.enable"]).authorize)).rejects.toThrow("denied");
    expect(d.uses).toEqual([]);
  });

  it("maps a ToolInputError (by name) to a flat 400; anything else is rethrown; fails closed without authorizer or principal", async () => {
    const failing = (error: Error) => deps({ projectKeys: { permissionFor: async () => { throw error; }, use: async () => { throw new Error("unreachable"); } } }).value;
    expect(await refusalOf(() => run(failing(new ToolInputError("Unknown project key")), { use: true }))).toEqual({ status: 400, body: { error: "Unknown project key" } });
    await expect(run(failing(new Error("private vault location")), { use: true })).rejects.toThrow("private vault location");
    await expect(projectKeyUseRoute.handle({ input: { keyId: "k1", body: { use: true } }, deps: deps().value, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(projectKeyUseRoute.handle({ input: { keyId: "k1", body: { use: true } }, deps: deps().value, authorize: recorder().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});
