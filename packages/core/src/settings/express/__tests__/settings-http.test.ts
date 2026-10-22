import { expect, test, vi } from "vitest";
import { ForbiddenError, PrincipalNotFoundError, ValueValidationFailedError } from "../../index.js";
import { registerSettingsRoutes } from "../index.js";
import { fixture } from "./settings-fixture.js";

// Generalized from settings-workspace-scoping, settings-read-scoping, settings-auth and
// settings-principal-check: exercise handlers directly, using injected principals and services.
test("mounts eight handlers using only the caller's paths", () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  expect([...f.handlers.keys()].sort()).toEqual([
    "DELETE /prefs/value", "GET /prefs/definitions", "GET /prefs/effective", "GET /prefs/events", "GET /prefs/raw",
    "POST /prefs/definitions", "POST /prefs/reset", "PUT /prefs/value",
  ]);
});
test.each(["global", "workspace", "user"] as const)("refuses cross-workspace %s writes before invoking the service", async (scope) => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  for (const [method, route, body] of [
    ["PUT", "/prefs/value", { namespace: "preferences", key: "color", scope, valueJson: "blue", workspaceId: "workspace-b" }],
    ["DELETE", "/prefs/value", { namespace: "preferences", key: "color", scope, workspaceId: "workspace-b" }],
    ["POST", "/prefs/reset", { namespace: "preferences", scope, workspaceId: "workspace-b" }],
  ] as const) {
    const { capture } = await f.invoke(method, route, { body });
    expect(capture.statusCode).toBe(400);
    expect(capture.jsonBody).toMatchObject({ code: "VALIDATION_ERROR" });
  }
  expect(f.deps.service.set).not.toHaveBeenCalled();
  expect(f.deps.service.clear).not.toHaveBeenCalled();
  expect(f.deps.service.reset).not.toHaveBeenCalled();
});
test("404s a path workspace mismatch before resolving the principal", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("GET", "/prefs/effective", { params: { tenant: "workspace-b" } });
  expect(capture.statusCode).toBe(404); expect(f.deps.principalResolver).not.toHaveBeenCalled();
});
test("effective defaults to self while raw omits the user layer; query workspace never changes the target", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  await f.invoke("GET", "/prefs/effective", { query: { namespace: "preferences", workspaceId: "workspace-b" } });
  expect(f.deps.service.effective).toHaveBeenCalledWith({ namespace: "preferences", workspaceId: "workspace-a", principalId: "me" });
  await f.invoke("GET", "/prefs/raw", { query: { namespace: "preferences", key: "color" } });
  expect(f.deps.service.raw).toHaveBeenCalledWith({ namespace: "preferences", key: "color", workspaceId: "workspace-a", principalId: undefined });
});
test.each(["effective", "raw"])("%s reading another user's layer needs the explicit host permission", async (route) => {
  const f = fixture();
  vi.mocked(f.deps.authorize).mockImplementation(async ({ permission }) => ({ allowed: permission !== "prefs.other.read", reason: "no_grant" }));
  registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("GET", `/prefs/${route}`, { query: { namespace: "preferences", key: "color", principalId: "them" } });
  expect(capture.statusCode).toBe(403);
  expect(capture.jsonBody).toMatchObject({ code: "FORBIDDEN", details: { permission: "prefs.other.read", reason: "no_grant" } });
  expect(f.deps.service.raw).not.toHaveBeenCalled(); expect(f.deps.service.effective).not.toHaveBeenCalled();
});
test.each([null, 0, "", false])("set passes the legal value %j unchanged and defaults workspace targets", async (value) => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  await f.invoke("PUT", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "workspace", valueJson: value } });
  expect(f.deps.service.set).toHaveBeenCalledWith({ namespace: "preferences", key: "color", scope: "workspace", value,
    workspaceId: "workspace-a", principalId: undefined, callerPrincipalId: "me", authWorkspaceId: "workspace-a" });
});
test("global writes omit the target workspace but authorize in the ambient workspace", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  await f.invoke("PUT", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "global", valueJson: "blue" } });
  expect(f.deps.authorize).toHaveBeenCalledWith({ principalId: "me", workspaceId: "workspace-a", permission: "prefs.global", entityType: "setting-value" });
  expect(f.deps.service.set).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: undefined, authWorkspaceId: "workspace-a" }));
});
test("self and cross-user writes select separate required policy grants", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  for (const principalId of [undefined, "me", "them"]) {
    await f.invoke("DELETE", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "user", principalId } });
  }
  expect(vi.mocked(f.deps.authorize).mock.calls.map(([input]) => input.permission)).toEqual(["prefs.self", "prefs.self", "prefs.other"]);
});
test("authorization denial returns the existing structured body and never writes", async () => {
  const f = fixture(); vi.mocked(f.deps.authorize).mockResolvedValue({ allowed: false, reason: "disabled" });
  registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("PUT", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "workspace", valueJson: "blue" } });
  expect(capture.jsonBody).toEqual({ error: "principal 'me' is not authorized for 'prefs.workspace' (disabled)", code: "FORBIDDEN",
    details: { permission: "prefs.workspace", reason: "disabled" } });
  expect(f.deps.service.set).not.toHaveBeenCalled();
});
test.each([
  [new PrincipalNotFoundError("missing", "them", "workspace-a"), 404, "PRINCIPAL_NOT_FOUND"],
  [new ValueValidationFailedError("invalid"), 400, "VALUE_VALIDATION_FAILED"],
  [new ForbiddenError("denied"), 403, "FORBIDDEN"],
] as const)("maps CMS write errors without changing error codes", async (error, status, code) => {
  const f = fixture(); vi.mocked(f.deps.service.set).mockRejectedValue(error); registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("PUT", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "workspace", valueJson: "blue" } });
  expect(capture.statusCode).toBe(status); expect(capture.jsonBody).toEqual({ error: error.message, code });
});
test("null principal returns 401 and does not authorize", async () => {
  const f = fixture(); vi.mocked(f.deps.principalResolver).mockReturnValue(null); registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("GET", "/prefs/events");
  expect(capture.jsonBody).toEqual({ error: "unauthenticated", code: "UNAUTHENTICATED" }); expect(f.deps.authorize).not.toHaveBeenCalled();
});

// REGRESSION: fails if readiness and principal resolution share the handler's 500 catch.
test.each(["readiness", "principal"])("%s failure returns the authentication envelope before service access", async (stage) => {
  const f = fixture();
  if (stage === "readiness") f.deps.ready = Promise.reject(new Error("private readiness failure"));
  else vi.mocked(f.deps.principalResolver).mockImplementation(() => { throw new Error("private principal failure"); });
  registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("GET", "/prefs/effective", { query: { namespace: "preferences" } });
  expect(capture.statusCode).toBe(401);
  expect(capture.jsonBody).toEqual({ error: "unauthenticated", code: "UNAUTHENTICATED" });
  expect(f.deps.authorize).not.toHaveBeenCalled();
  expect(f.deps.service.effective).not.toHaveBeenCalled();
});
test("unknown definition operations retain a validation response", async () => {
  const f = fixture(); vi.mocked(f.deps.service.definitions).mockResolvedValue({ unknownOp: "constructor" }); registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("POST", "/prefs/definitions", { body: { definitions: [{ op: "constructor" }] } });
  expect(capture.statusCode).toBe(400); expect(capture.jsonBody).toEqual({ error: "unknown op 'constructor'", code: "VALIDATION_ERROR" });
});
test.each([null, "string", 17, []])("invalid body %j produces a validation error without a write", async (body) => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("PUT", "/prefs/value", { body });
  expect(capture.statusCode).toBe(400); expect(f.deps.service.set).not.toHaveBeenCalled();
});

test("lists projected definition fields in namespace/key order", async () => {
  const f = fixture();
  const first = { namespace: "a", key: "z", ownerKind: "core", scopes: 7, status: "active", version: 1 };
  const second = { namespace: "b", key: "a", ownerKind: "site", scopes: 6, status: "alias", version: 2 };
  vi.mocked(f.deps.service.listDefinitions).mockResolvedValue([
    second as import("../../index.js").SettingDefinitionRecord,
    first as import("../../index.js").SettingDefinitionRecord,
  ]);
  registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("GET", "/prefs/definitions");
  expect(capture.jsonBody).toEqual({ data: [first, second] });
});
test("reset, clear and definitions preserve success response envelopes", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  const reset = await f.invoke("POST", "/prefs/reset", { body: { namespace: "preferences", scope: "workspace" } });
  expect(reset.capture.jsonBody).toEqual({ namespace: "preferences", clearedCount: 1, revisionSeqs: [9] });
  const clear = await f.invoke("DELETE", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "workspace" } });
  expect(clear.capture.jsonBody).toEqual({ key: "preferences.color", scope: "workspace", value: null, revisionSeq: 8 });
  const definitions = await f.invoke("POST", "/prefs/definitions", { body: { definitions: [] } });
  expect(definitions.capture.jsonBody).toEqual({ applied: [] });
});
