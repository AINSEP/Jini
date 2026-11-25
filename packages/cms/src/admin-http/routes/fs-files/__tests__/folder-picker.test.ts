import { ok, routeReply } from "@jini-ai/core/contracts/server";
import { describe, expect, it } from "vitest";
import { createFsFolderPickerRoutes, type FsFolderPickerRouteDeps } from "../folder-picker.js";
import { MANAGE_PERMISSION, PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

const BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/fs-files/folder-picker";
const SIGN_IN = "test: sign in to pick";

/** A fixture whose every port records what ran, so a refusal can prove nothing after it did. */
function fixture(overrides: Partial<Pick<FsFolderPickerRouteDeps, "localHost">> & { available?: boolean; local?: boolean; session?: boolean; pick?: () => Promise<string | null>; denied?: readonly string[] } = {}) {
  const calls: string[] = [];
  const recorder = recordingAuthorize(overrides.denied ?? []);
  const authorize = async (args: { permission: string }) => { calls.push("authorize"); await recorder.authorize(args); };
  const deps: FsFolderPickerRouteDeps = {
    workspaceId: WORKSPACE_ID,
    localHost: overrides.localHost ?? true,
    folderPicker: { available: overrides.available ?? true, pick: async () => { calls.push("pick"); return overrides.pick ? overrides.pick() : "/picked"; } },
    managePermission: MANAGE_PERMISSION,
    sessionRequiredMessage: SIGN_IN,
    isLocalRequest: () => { calls.push("local"); return overrides.local ?? true; },
    isSessionCredential: () => { calls.push("session"); return overrides.session ?? true; },
  };
  const routes = createFsFolderPickerRoutes();
  // `null` = a mount with no authorizer (an explicit `undefined` would take the default).
  const run = (method: "get" | "post", auth: typeof authorize | null = authorize) =>
    routes[method].handle({ input: {}, deps, context: PRINCIPAL, authorize: (auth ?? undefined) as never }, { signal });
  return { calls, authorizeCalls: recorder.calls, routes, run };
}

const notFound = ok({ value: routeReply({ status: 404, body: { error: "not found" } }) });

describe("createFsFolderPickerRoutes", () => {
  it("keeps the methods, path, parse and the no-store header on every answer", () => {
    const { routes } = fixture();
    expect(routes.get.method).toBe("get");
    expect(routes.post.method).toBe("post");
    for (const spec of [routes.get, routes.post]) {
      expect(spec.path).toBe(BASE_PATH);
      expect(spec.responseHeaders).toEqual({ "Cache-Control": "no-store" });
      expect(spec.successStatus).toBeUndefined();
      expect(spec.parse(raw())).toEqual({ ok: true, value: {} });
    }
  });

  it("a local session holding the permission sees the picker and gets the chosen path", async () => {
    const f = fixture();
    expect(await f.run("get")).toEqual(ok({ value: { available: true } }));
    expect(await f.run("post")).toEqual(ok({ value: { path: "/picked" } }));
    expect(f.authorizeCalls).toEqual([{ permission: MANAGE_PERMISSION }, { permission: MANAGE_PERMISSION }]);
    expect(f.calls).toEqual(["local", "session", "authorize", "local", "session", "authorize", "pick"]);
  });

  it("a non-local launch or a missing chooser 404s before any other check runs", async () => {
    for (const f of [fixture({ localHost: false }), fixture({ available: false })]) {
      expect(await f.run("get")).toEqual(notFound);
      expect(await f.run("post")).toEqual(notFound);
      expect(f.calls).toEqual([]);
    }
  });

  it("SECURITY: a request not from this machine is refused before the credential check, authorization or the dialog", async () => {
    const f = fixture({ local: false });
    const refused = ok({ value: routeReply({ status: 403, body: { reasonCode: "local-host-only" } }) });
    expect(await f.run("get")).toEqual(refused);
    expect(await f.run("post")).toEqual(refused);
    expect(f.calls).toEqual(["local", "local"]);
  });

  it("SECURITY: an API key never opens the dialog and is refused with the credential-kind 403", async () => {
    const f = fixture({ session: false });
    expect(await f.run("post")).toEqual(ok({ value: routeReply({ status: 403, body: { error: SIGN_IN, code: "FORBIDDEN", details: { permission: MANAGE_PERMISSION, reason: "credential_kind_not_permitted" } } }) }));
    expect(f.calls).toEqual(["local", "session"]);
  });

  it("SECURITY: a session without the permission never opens the dialog", async () => {
    const f = fixture({ denied: [MANAGE_PERMISSION] });
    await expect(f.run("post")).rejects.toThrow(`denied ${MANAGE_PERMISSION}`);
    expect(f.calls).toEqual(["local", "session", "authorize"]);
  });

  it("SECURITY: a mount without an authorizer fails closed before the dialog", async () => {
    const f = fixture();
    await expect(f.run("post", null)).rejects.toThrow("no authorizer");
    expect(f.calls).not.toContain("pick");
  });

  it("one dialog at a time: a second pick while one is open is a 409, and the slot frees afterwards", async () => {
    let release!: (value: string | null) => void;
    const f = fixture({ pick: () => new Promise((resolve) => { release = resolve; }) });
    const first = f.run("post");
    await new Promise((resolve) => setImmediate(resolve));
    expect(await f.run("post")).toEqual(ok({ value: routeReply({ status: 409, body: { reasonCode: "busy" } }) }));
    release(null);
    expect(await first).toEqual(ok({ value: { path: null } }));
    expect(f.calls.filter((call) => call === "pick")).toHaveLength(1);
    expect(fixture().routes.post).not.toBe(f.routes.post);
  });

  it("a chooser failure rethrows the original error for the host's redacted 500 and frees the slot", async () => {
    const failure = new Error("chooser stderr /Users/someone");
    let fail = true;
    const f = fixture({ pick: async () => { if (fail) throw failure; return "/again"; } });
    await expect(f.run("post")).rejects.toBe(failure);
    fail = false;
    expect(await f.run("post")).toEqual(ok({ value: { path: "/again" } }));
  });
});
