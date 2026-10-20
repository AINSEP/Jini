import { describe, expect, test, vi } from "vitest";
import {
  AliasDepthExceededError, DefinitionInvalidError, DefinitionNotFoundError, DefinitionTombstonedError, ForbiddenError,
  RenameRetypeConflictError, ScopeNotAllowedError, SecretNotSupportedError, ValueValidationFailedError,
  type SettingDefinitionRecord,
} from "../../index.js";
import { registerSettingsRoutes, type SettingsHttpOptions } from "../index.js";
import { fixture } from "./settings-fixture.js";

// Security-relevant pins for every refusal and status code of the settings HTTP registrar.
const deny = (denied: string) => async ({ permission }: { permission: string }) =>
  ({ allowed: permission !== denied, reason: "no_grant" });
const forbidden = (permission: string) => ({
  error: `principal 'me' is not authorized for '${permission}' (no_grant)`, code: "FORBIDDEN", details: { permission, reason: "no_grant" },
});
const validationError = (error: string) => ({ error, code: "VALIDATION_ERROR" });
const setBody = { namespace: "preferences", key: "color", scope: "workspace", valueJson: "blue" };

describe("request gate", () => {
  test("a disposed registrar answers 503 before resolving the workspace or principal", async () => {
    const f = fixture(); const mounted = registerSettingsRoutes(f.deps); mounted.dispose();
    const { capture } = await f.invoke("GET", "/prefs/definitions", { params: {} });
    expect(capture.statusCode).toBe(503);
    expect(capture.jsonBody).toEqual({ error: "settings routes are disposed", code: "UNAVAILABLE" });
    expect(f.deps.principalResolver).not.toHaveBeenCalled();
  });
  test("a request with no workspace path param is a 404 without a code", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("GET", "/prefs/definitions", { params: {} });
    expect(capture.statusCode).toBe(404);
    expect(capture.jsonBody).toEqual({ error: "workspace was not found" });
    expect(f.deps.principalResolver).not.toHaveBeenCalled();
  });
  test("an async principal resolver is awaited and its id becomes the caller", async () => {
    const f = fixture(); vi.mocked(f.deps.principalResolver).mockResolvedValue({ id: "async-me" }); registerSettingsRoutes(f.deps);
    await f.invoke("GET", "/prefs/definitions");
    expect(f.deps.authorize).toHaveBeenCalledWith({ principalId: "async-me", permission: "prefs.list", workspaceId: "workspace-a", entityType: "setting-definition" });
  });
  test("an unmapped handler error is a fixed 500 that never discloses its message", async () => {
    const f = fixture(); vi.mocked(f.deps.service.listDefinitions).mockRejectedValue(new Error("private db path")); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("GET", "/prefs/definitions");
    expect(capture.statusCode).toBe(500);
    expect(capture.jsonBody).toEqual({ error: "internal error", code: "INTERNAL_ERROR" });
  });
});

describe("failure after headers are sent", () => {
  /** The scheduler throws after the stream wrote its 200 head, so the wrapper sees headersSent. */
  function failingAfterHead(optional: SettingsHttpOptions) {
    const f = fixture();
    f.deps.scheduler = { every: () => { throw new Error("scheduler unavailable"); } };
    registerSettingsRoutes(f.deps, optional);
    return f;
  }
  test("reports the error to the host and ends the response", async () => {
    const onError = vi.fn<NonNullable<SettingsHttpOptions["onError"]>>();
    const f = failingAfterHead({ onError });
    const { res, capture } = await f.invoke("GET", "/prefs/events");
    expect(onError).toHaveBeenCalledWith({ operation: "settings-request", error: expect.objectContaining({ message: "scheduler unavailable" }) });
    expect(res.end).toHaveBeenCalled();
    expect(capture.statusCode).toBe(200);
    expect(capture.jsonBody).toBeUndefined();
  });
  test("ends the response even when the host reporter throws", async () => {
    const f = failingAfterHead({ onError: () => { throw new Error("reporter broke"); } });
    const { res } = await f.invoke("GET", "/prefs/events");
    expect(res.writableEnded).toBe(true);
  });
  test("ends the response when no reporter is configured", async () => {
    const f = failingAfterHead({});
    const { res } = await f.invoke("GET", "/prefs/events");
    expect(res.writableEnded).toBe(true);
  });
});

describe("authorization refusals", () => {
  test.each([
    ["GET", "/prefs/definitions", {}, "prefs.list"],
    ["GET", "/prefs/effective", { query: { namespace: "preferences" } }, "prefs.read"],
    ["GET", "/prefs/raw", { query: { namespace: "preferences", key: "color" } }, "prefs.raw"],
    ["POST", "/prefs/definitions", { body: { definitions: [] } }, "prefs.manage"],
    ["PUT", "/prefs/value", { body: setBody }, "prefs.workspace"],
    ["DELETE", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "global" } }, "prefs.global"],
    ["POST", "/prefs/reset", { body: { namespace: "preferences", scope: "user" } }, "reset.self"],
    ["GET", "/prefs/events", {}, "prefs.read"],
  ] as const)("%s %s %j without %s is a 403 and touches no service", async (method, route, fields, permission) => {
    const f = fixture(); vi.mocked(f.deps.authorize).mockImplementation(deny(permission)); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke(method, route, fields);
    expect(capture.statusCode).toBe(403);
    expect(capture.jsonBody).toEqual(forbidden(permission));
    for (const call of Object.values(f.deps.service)) expect(call).not.toHaveBeenCalled();
    expect(f.deps.changeFeed.head).not.toHaveBeenCalled();
  });
  test("reading another user's effective layer with the grant targets that user", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    await f.invoke("GET", "/prefs/effective", { query: { namespace: "preferences", principalId: "them" } });
    expect(f.deps.authorize).toHaveBeenCalledWith({ principalId: "me", permission: "prefs.other.read", workspaceId: "workspace-a", entityType: "setting-value" });
    expect(f.deps.service.effective).toHaveBeenCalledWith({ namespace: "preferences", workspaceId: "workspace-a", principalId: "them" });
  });
  test("a denied cross-user read uses the read-specific 403 message", async () => {
    const f = fixture(); vi.mocked(f.deps.authorize).mockImplementation(deny("prefs.other.read")); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("GET", "/prefs/raw", { query: { namespace: "preferences", key: "color", principalId: "them" } });
    expect(capture.jsonBody).toEqual({ error: "principal 'me' is not authorized to read another principal's user-layer value (no_grant)",
      code: "FORBIDDEN", details: { permission: "prefs.other.read", reason: "no_grant" } });
  });
});

describe("input validation", () => {
  test.each([
    ["GET", "/prefs/effective", { query: {} }, "'namespace' query param is required"],
    ["GET", "/prefs/raw", { query: { key: "color" } }, "'namespace' and 'key' query params are required"],
    ["GET", "/prefs/raw", { query: { namespace: "preferences" } }, "'namespace' and 'key' query params are required"],
    ["POST", "/prefs/definitions", { body: { definitions: "all" } }, "'definitions' must be an array"],
    ["POST", "/prefs/definitions", { body: [] }, "'definitions' must be an array"],
    ["PUT", "/prefs/value", { body: { ...setBody, namespace: "" } }, "namespace, key, scope (global|workspace|user), and valueJson are required"],
    ["PUT", "/prefs/value", { body: { ...setBody, key: undefined } }, "namespace, key, scope (global|workspace|user), and valueJson are required"],
    ["PUT", "/prefs/value", { body: { ...setBody, scope: "tenant" } }, "namespace, key, scope (global|workspace|user), and valueJson are required"],
    ["PUT", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "workspace" } }, "namespace, key, scope (global|workspace|user), and valueJson are required"],
    ["DELETE", "/prefs/value", { body: { namespace: "preferences", key: "color" } }, "namespace, key, and scope (global|workspace|user) are required"],
    ["DELETE", "/prefs/value", { body: { key: "color", scope: "user" } }, "namespace, key, and scope (global|workspace|user) are required"],
    ["POST", "/prefs/reset", { body: { scope: "global" } }, "namespace and scope (global|workspace|user) are required"],
    ["POST", "/prefs/reset", { body: { namespace: "preferences", scope: "toString" } }, "namespace and scope (global|workspace|user) are required"],
  ] as const)("%s %s %j is a 400 validation error", async (method, route, fields, message) => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke(method, route, fields);
    expect(capture.statusCode).toBe(400);
    expect(capture.jsonBody).toEqual(validationError(message));
    for (const call of Object.values(f.deps.service)) expect(call).not.toHaveBeenCalled();
  });
  test("validation runs before the write authorization check", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    await f.invoke("PUT", "/prefs/value", { body: { namespace: "preferences" } });
    expect(f.deps.authorize).not.toHaveBeenCalled();
  });
  test.each([null, ""])("a body workspaceId of %j defaults to the route workspace", async (workspaceId) => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    await f.invoke("POST", "/prefs/reset", { body: { namespace: "preferences", scope: "workspace", workspaceId } });
    expect(f.deps.service.reset).toHaveBeenCalledWith({ namespace: "preferences", scope: "workspace", workspaceId: "workspace-a",
      callerPrincipalId: "me", authWorkspaceId: "workspace-a" });
  });
  test("a body workspaceId naming the route workspace is accepted", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("PUT", "/prefs/value", { body: { ...setBody, workspaceId: "workspace-a" } });
    expect(capture.jsonBody).toEqual({ key: "preferences.color", scope: "workspace", value: "saved", revisionSeq: 7 });
  });
  test("a cross-workspace write echoes the refused workspace in its validation message", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("PUT", "/prefs/value", { body: { ...setBody, workspaceId: "workspace-b" } });
    expect(capture.jsonBody).toEqual(validationError(
      "workspaceId 'workspace-b' does not match this route's workspace; a settings write cannot target another workspace"));
  });
  test("a user-scope write passes the stringified target principal", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    await f.invoke("PUT", "/prefs/value", { body: { ...setBody, scope: "user", principalId: 42 } });
    expect(f.deps.authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "prefs.other" }));
    expect(f.deps.service.set).toHaveBeenCalledWith(expect.objectContaining({ principalId: "42", scope: "user" }));
  });
  test("a non-object request body is treated as empty", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("POST", "/prefs/definitions", { body: "definitions" });
    expect(capture.jsonBody).toEqual(validationError("'definitions' must be an array"));
  });
});

describe("read responses", () => {
  test("raw returns 404 for an unknown definition", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("GET", "/prefs/raw", { query: { namespace: "preferences", key: "color" } });
    expect(capture.statusCode).toBe(404);
    expect(capture.jsonBody).toEqual({ error: "definition 'preferences.color' was not found", code: "DEFINITION_NOT_FOUND" });
  });
  test("raw returns the service row as-is", async () => {
    const f = fixture(); const row = { key: "preferences.color", global: 1, workspace: null, user: null, default: 0 };
    vi.mocked(f.deps.service.raw).mockResolvedValue(row); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("GET", "/prefs/raw", { query: { namespace: "preferences", key: "color", principalId: "me" } });
    expect(capture.jsonBody).toEqual(row);
    expect(f.deps.service.raw).toHaveBeenCalledWith({ namespace: "preferences", key: "color", workspaceId: "workspace-a", principalId: "me" });
  });
  test("definitions sort by key inside one namespace", async () => {
    const f = fixture();
    const row = (key: string) => ({ namespace: "a", key, ownerKind: "core", scopes: 2, status: "active", version: 1 }) as SettingDefinitionRecord;
    vi.mocked(f.deps.service.listDefinitions).mockResolvedValue([row("b"), row("a")]); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("GET", "/prefs/definitions");
    expect(capture.jsonBody).toEqual({ data: [row("a"), row("b")] });
  });
  test("definitions forwards the items and the caller to the service", async () => {
    const f = fixture(); registerSettingsRoutes(f.deps);
    await f.invoke("POST", "/prefs/definitions", { body: { definitions: [{ op: "deprecate" }] } });
    expect(f.deps.service.definitions).toHaveBeenCalledWith({ items: [{ op: "deprecate" }], callerPrincipalId: "me", authWorkspaceId: "workspace-a" });
  });
  test("a clear result with a value reports that value", async () => {
    const f = fixture(); vi.mocked(f.deps.service.clear).mockResolvedValue(Object.assign({ revisionSeq: 3 }, { value: "kept" })); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("DELETE", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "global" } });
    expect(capture.jsonBody).toEqual({ key: "preferences.color", scope: "global", value: "kept", revisionSeq: 3 });
    expect(f.deps.service.clear).toHaveBeenCalledWith({ namespace: "preferences", key: "color", scope: "global", workspaceId: undefined,
      principalId: undefined, callerPrincipalId: "me", authWorkspaceId: "workspace-a" });
  });
});

describe("error mappings", () => {
  test.each([
    [new SecretNotSupportedError({ message: "secret" }), 400, "SECRET_NOT_SUPPORTED"],
    [new DefinitionInvalidError("bad"), 400, "DEFINITION_INVALID"],
    [new RenameRetypeConflictError("conflict"), 409, "RENAME_RETYPE_CONFLICT"],
    [new AliasDepthExceededError("deep"), 409, "ALIAS_DEPTH_EXCEEDED"],
    [new DefinitionTombstonedError("gone"), 409, "DEFINITION_TOMBSTONED"],
    [new ForbiddenError("denied"), 403, "FORBIDDEN"],
    [new DefinitionNotFoundError("missing"), 500, "INTERNAL_ERROR"],
  ] as const)("definitions maps %s to %i %s", async (error, status, code) => {
    const f = fixture(); vi.mocked(f.deps.service.definitions).mockRejectedValue(error); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("POST", "/prefs/definitions", { body: { definitions: [] } });
    expect(capture.statusCode).toBe(status);
    expect(capture.jsonBody).toEqual({ error: status === 500 ? "internal error" : error.message, code });
  });
  test.each([
    [new DefinitionNotFoundError("missing"), 404, "DEFINITION_NOT_FOUND"],
    [new DefinitionTombstonedError("gone"), 409, "DEFINITION_TOMBSTONED"],
    [new ScopeNotAllowedError("scope"), 400, "SCOPE_NOT_ALLOWED"],
  ] as const)("set maps %s to %i %s", async (error, status, code) => {
    const f = fixture(); vi.mocked(f.deps.service.set).mockRejectedValue(error); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("PUT", "/prefs/value", { body: setBody });
    expect(capture.statusCode).toBe(status);
    expect(capture.jsonBody).toEqual({ error: error.message, code });
  });
  test("clear does not map value validation failures, so they are a fixed 500", async () => {
    const f = fixture(); vi.mocked(f.deps.service.clear).mockRejectedValue(new ValueValidationFailedError("bad value")); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("DELETE", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "workspace" } });
    expect(capture.statusCode).toBe(500);
    expect(capture.jsonBody).toEqual({ error: "internal error", code: "INTERNAL_ERROR" });
  });
  test("clear still maps a missing definition to 404", async () => {
    const f = fixture(); vi.mocked(f.deps.service.clear).mockRejectedValue(new DefinitionNotFoundError("missing")); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("DELETE", "/prefs/value", { body: { namespace: "preferences", key: "color", scope: "workspace" } });
    expect(capture.statusCode).toBe(404);
  });
  test.each([
    [new ForbiddenError("denied"), 403, "FORBIDDEN"],
    [new DefinitionNotFoundError("missing"), 500, "INTERNAL_ERROR"],
  ] as const)("reset maps only forbidden errors: %s is %i", async (error, status, code) => {
    const f = fixture(); vi.mocked(f.deps.service.reset).mockRejectedValue(error); registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("POST", "/prefs/reset", { body: { namespace: "preferences", scope: "global" } });
    expect(capture.statusCode).toBe(status);
    expect(capture.jsonBody).toMatchObject({ code });
  });
});

describe("event stream registration", () => {
  test("a response destroyed before the stream opens gets no head, frames or schedules", async () => {
    const f = fixture();
    vi.mocked(f.deps.principalResolver).mockImplementation(({ response }) => { Object.assign(response, { destroyed: true }); return { id: "me" }; });
    const mounted = registerSettingsRoutes(f.deps);
    const { capture } = await f.invoke("GET", "/prefs/events");
    expect(capture.headers).toEqual({});
    expect(capture.frames).toBe("");
    expect(f.scheduled.size).toBe(0);
    mounted.dispose();
  });
  test("a dispose that lands between the stream opening and its registration still closes the stream", async () => {
    const f = fixture(); const every = f.deps.scheduler.every; let mounted: { dispose(): void } | undefined;
    f.deps.scheduler = { every: (input) => {
      // Queued while the stream is still opening, so it runs before the route registers the closer.
      if (f.scheduled.size === 0) queueMicrotask(() => { mounted?.dispose(); });
      return every(input);
    } };
    mounted = registerSettingsRoutes(f.deps);
    const { res } = await f.invoke("GET", "/prefs/events");
    expect(res.writableEnded).toBe(true);
    expect(f.scheduled.size).toBe(0);
  });
  test("disposing after a stream opened closes it and cancels its schedules", async () => {
    const f = fixture(); const mounted = registerSettingsRoutes(f.deps);
    const { res } = await f.invoke("GET", "/prefs/events");
    mounted.dispose();
    expect(res.writableEnded).toBe(true);
    expect(f.scheduled.size).toBe(0);
  });
});
