import { describe, expect, it } from "vitest";
import { roleCreateRoute } from "../create-role.js";
import { BODIES, ERRORS, makeAccessDeps, raw, recordingAuthorize, refusalOf, signal, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

describe("roleCreateRoute", () => {
  it("keeps the method, path and 201 success status, with no body cap", () => {
    expect([roleCreateRoute.method, roleCreateRoute.path, roleCreateRoute.successStatus, roleCreateRoute.maxBodyBytes])
      .toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/roles", 201, undefined]);
  });

  it("reads name off the untyped body, falling back to an empty string", () => {
    expect(roleCreateRoute.parse(raw({}, { name: "Editors" }))).toEqual({ ok: true, value: { name: "Editors" } });
    expect(roleCreateRoute.parse(raw({}, { name: 7 }))).toEqual({ ok: true, value: { name: "7" } });
    expect(roleCreateRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { name: "" } });
  });

  it("creates a custom role through the real service and never asks the route authorizer (the service gates role.manage)", async () => {
    const { routeDeps, OWNER, repos } = await makeAccessDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await roleCreateRoute.handle({ input: { name: "Editors" }, deps: routeDeps, context: OWNER, authorize }, { signal });
    expect(result.ok && result.value.role).toMatchObject({ workspaceId: WORKSPACE_ID, name: "Editors", isBuiltin: false, version: 1 });
    expect(result.ok && Object.keys(result.value.role)).toEqual(["id", "workspaceId", "name", "isBuiltin", "version"]);
    expect(calls).toEqual([]);
    expect((await repos.roles.list({ workspaceId: WORKSPACE_ID })).some((role) => role.name === "Editors")).toBe(true);
  });

  it("refuses a caller without role.manage with the 403 FORBIDDEN body and creates nothing", async () => {
    const { routeDeps, BARE, repos } = await makeAccessDeps();
    const before = (await repos.roles.list({ workspaceId: WORKSPACE_ID })).length;
    const refusal = await refusalOf(() => roleCreateRoute.handle({ input: { name: "X" }, deps: routeDeps, context: BARE }));
    expect(refusal).toMatchObject({ status: 403, body: { code: "FORBIDDEN", details: { permission: "role.manage" } } });
    expect((await repos.roles.list({ workspaceId: WORKSPACE_ID })).length).toBe(before);
  });

  for (const [name, expected] of [["forbidden", BODIES.forbidden], ["validation", BODIES.validation]] as const) {
    it(`maps ${name} to its exact flat body`, async () => {
      expect(await refusalOf(() => roleCreateRoute.handle({ input: { name: "X" }, deps: throwingDeps(ERRORS[name]), context: { id: "p" } }))).toEqual(expected);
    });
  }

  it("rethrows an error this route never mapped (not-found included) for the host's 500", async () => {
    await expect(roleCreateRoute.handle({ input: { name: "X" }, deps: throwingDeps(ERRORS.notFound), context: { id: "p" } })).rejects.toBe(ERRORS.notFound);
    await expect(roleCreateRoute.handle({ input: { name: "X" }, deps: throwingDeps(new Error("db down")), context: { id: "p" } })).rejects.toThrow("db down");
  });

  it("fails closed without a principal, before assembling the service deps", async () => {
    const { routeDeps, serviceCalls } = await makeAccessDeps();
    await expect(roleCreateRoute.handle({ input: { name: "X" }, deps: routeDeps })).rejects.toThrow(/no authenticated principal/);
    expect(serviceCalls()).toBe(0);
  });
});
