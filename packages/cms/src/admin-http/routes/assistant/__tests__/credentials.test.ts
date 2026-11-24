import { describe, expect, it } from "vitest";

import { assistantDeleteExecutionCredentialRoute } from "../delete-execution-credential.js";
import { assistantDeleteSiteCredentialRoute } from "../delete-site-credential.js";
import { assistantGetExecutionCredentialRoute } from "../get-execution-credential.js";
import { assistantGetSiteCredentialRoute } from "../get-site-credential.js";
import { assistantPutExecutionCredentialRoute, EXECUTION_CREDENTIAL_VALIDATION_CODE } from "../put-execution-credential.js";
import { assistantPutSiteCredentialRoute, SITE_CREDENTIAL_VALIDATION_CODE } from "../put-site-credential.js";
import { HOST_WRITE_ERRORS, HostUnconfiguredError, HostValidationError, MANAGE, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./settings-helpers.js";

/** @file The site credential trio (RBAC-gated) and the caller's own execution credential trio (self-scoped). */

/** A view as the host returns it: never the key, only whether one is set and its mask. */
const VIEW = { isSet: true, masked: "…abcd" };
const SITE_BASE = "/api/admin/v1/workspaces/:workspaceId/assistant/site-credential";
const EXEC_BASE = "/api/admin/v1/workspaces/:workspaceId/assistant/execution-credential";

describe("credential route shapes", () => {
  it("keep each method, path, success status and no body cap", () => {
    const routes = [
      [assistantGetSiteCredentialRoute, "get", SITE_BASE], [assistantPutSiteCredentialRoute, "put", SITE_BASE], [assistantDeleteSiteCredentialRoute, "delete", SITE_BASE],
      [assistantGetExecutionCredentialRoute, "get", EXEC_BASE], [assistantPutExecutionCredentialRoute, "put", EXEC_BASE], [assistantDeleteExecutionCredentialRoute, "delete", EXEC_BASE],
    ] as const;
    for (const [route, method, path] of routes) {
      expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual([method, path, undefined, undefined]);
    }
    for (const route of [assistantGetSiteCredentialRoute, assistantDeleteSiteCredentialRoute, assistantGetExecutionCredentialRoute, assistantDeleteExecutionCredentialRoute]) {
      expect(route.parse(raw())).toEqual({ ok: true, value: {} });
    }
    for (const route of [assistantPutSiteCredentialRoute, assistantPutExecutionCredentialRoute]) {
      expect(route.parse(raw({ model: "m" }))).toEqual({ ok: true, value: { body: { model: "m" } } });
      expect(route.parse(raw(null))).toEqual({ ok: true, value: { body: {} } });
      expect(route.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { body: {} } });
    }
  });
});

describe("site credential routes", () => {
  const siteDeps = (calls: unknown[], overrides: Record<string, unknown> = {}) => ({
    workspaceId: WORKSPACE_ID, managePermission: MANAGE, errorMappings: HOST_WRITE_ERRORS,
    readSiteCredential: async (input: unknown) => { calls.push({ read: input }); return VIEW; },
    writeSiteCredential: async (input: unknown) => { calls.push({ write: input }); return VIEW; },
    clearSiteCredential: async (input: unknown) => { calls.push({ clear: input }); return VIEW; },
    ...overrides,
  });

  it("each authorizes the injected permission on assistant-settings (no entity id) and answers the host view", async () => {
    const calls: unknown[] = [];
    const { authorize, calls: auth } = recordingAuthorize();
    const deps = siteDeps(calls, { managePermission: "host.permission" });
    expect(await assistantGetSiteCredentialRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { data: VIEW } });
    expect(await assistantPutSiteCredentialRoute.handle({ input: { body: { apiKey: "sk-1", model: "m" } }, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { data: VIEW } });
    expect(await assistantDeleteSiteCredentialRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { data: VIEW } });
    expect(auth).toEqual(Array(3).fill({ permission: "host.permission", entityType: "assistant-settings" }));
    expect(calls).toEqual([
      { read: { workspaceId: WORKSPACE_ID } },
      { write: { workspaceId: WORKSPACE_ID, apiKey: "sk-1", provider: undefined, baseUrl: undefined, model: "m" } },
      { clear: { workspaceId: WORKSPACE_ID } },
    ]);
  });

  it("refuses a present non-string field with the flat 400, only after authorization, and writes nothing", async () => {
    for (const [field, value] of [["apiKey", 123], ["provider", null], ["baseUrl", false], ["model", []]] as const) {
      const calls: unknown[] = [];
      const { authorize, calls: auth } = recordingAuthorize();
      expect(await refusalOf(() => assistantPutSiteCredentialRoute.handle({ input: { body: { [field]: value } }, deps: siteDeps(calls), context: PRINCIPAL, authorize })))
        .toEqual({ status: 400, body: { error: `${field} must be a string`, code: SITE_CREDENTIAL_VALIDATION_CODE } });
      expect(auth).toHaveLength(1);
      expect(calls).toEqual([]);
    }
    expect(SITE_CREDENTIAL_VALIDATION_CODE).toBe("SITE_CREDENTIAL_VALIDATION_ERROR");
    const denied = recordingAuthorize([MANAGE]).authorize;
    await expect(assistantPutSiteCredentialRoute.handle({ input: { body: { apiKey: 1 } }, deps: siteDeps([]), context: PRINCIPAL, authorize: denied })).rejects.toThrow(`denied ${MANAGE}`);
  });

  it("maps the host's write ladder (400, then 503 with its fixed copy) and rethrows the rest", async () => {
    const authorize = recordingAuthorize().authorize;
    const failing = (err: Error) => siteDeps([], { writeSiteCredential: async () => { throw err; } });
    expect(await refusalOf(() => assistantPutSiteCredentialRoute.handle({ input: { body: { apiKey: "" } }, deps: failing(new HostValidationError("apiKey must not be empty")), context: PRINCIPAL, authorize })))
      .toEqual({ status: 400, body: { error: "apiKey must not be empty", code: "HOST_VALIDATION_ERROR" } });
    expect(await refusalOf(() => assistantPutSiteCredentialRoute.handle({ input: { body: {} }, deps: failing(new HostUnconfiguredError("no key")), context: PRINCIPAL, authorize })))
      .toEqual({ status: 503, body: { error: "host operator copy", code: "SECRET_STORE_UNCONFIGURED" } });
    await expect(assistantPutSiteCredentialRoute.handle({ input: { body: {} }, deps: failing(new Error("db down")), context: PRINCIPAL, authorize })).rejects.toThrow("db down");
  });

  it("touches no store when authorization refuses, and fails closed without an authorizer", async () => {
    const calls: unknown[] = [];
    const deps = siteDeps(calls);
    const denied = recordingAuthorize([MANAGE]).authorize;
    for (const route of [assistantGetSiteCredentialRoute, assistantDeleteSiteCredentialRoute]) {
      await expect(route.handle({ input: {}, deps, context: PRINCIPAL, authorize: denied })).rejects.toThrow(`denied ${MANAGE}`);
      await expect(route.handle({ input: {}, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    }
    await expect(assistantPutSiteCredentialRoute.handle({ input: { body: {} }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(calls).toEqual([]);
  });
});

describe("execution credential routes", () => {
  const execDeps = (calls: unknown[], overrides: Record<string, unknown> = {}) => ({
    workspaceId: WORKSPACE_ID, errorMappings: HOST_WRITE_ERRORS,
    readExecutionCredential: async (input: unknown) => { calls.push({ read: input }); return VIEW; },
    writeExecutionCredential: async (input: unknown) => { calls.push({ write: input }); return VIEW; },
    clearExecutionCredential: async (input: unknown) => { calls.push({ clear: input }); return VIEW; },
    ...overrides,
  });
  const own = { workspaceId: WORKSPACE_ID, principalId: PRINCIPAL.id };

  it("scope every read, write and clear to the authenticated caller's own row, with no permission check", async () => {
    const calls: unknown[] = [];
    const deps = execDeps(calls);
    expect(await assistantGetExecutionCredentialRoute.handle({ input: {}, deps, context: PRINCIPAL })).toEqual({ ok: true, value: { data: VIEW } });
    const body = { apiKey: "sk-1", protocol: "openai", providerId: null, baseUrl: "https://example.org/v1", model: "m", maxTokens: 10 };
    expect(await assistantPutExecutionCredentialRoute.handle({ input: { body }, deps, context: PRINCIPAL })).toEqual({ ok: true, value: { data: VIEW } });
    expect(await assistantDeleteExecutionCredentialRoute.handle({ input: {}, deps, context: PRINCIPAL })).toEqual({ ok: true, value: { data: VIEW } });
    expect(calls).toEqual([{ read: own }, { write: { ...own, ...body } }, { clear: own }]);
  });

  it("refuses each malformed field with its own message, before any write", async () => {
    const cases = [
      ["apiKey", 123, "apiKey must be a string"], ["protocol", false, "protocol must be a string"], ["baseUrl", {}, "baseUrl must be a string"],
      ["model", [], "model must be a string"], ["providerId", 123, "providerId must be a string or null"],
      ["maxTokens", "1234", "maxTokens must be a number"], ["maxTokens", null, "maxTokens must be a number"],
    ] as const;
    for (const [field, value, message] of cases) {
      const calls: unknown[] = [];
      expect(await refusalOf(() => assistantPutExecutionCredentialRoute.handle({ input: { body: { [field]: value } }, deps: execDeps(calls), context: PRINCIPAL })))
        .toEqual({ status: 400, body: { error: message, code: EXECUTION_CREDENTIAL_VALIDATION_CODE } });
      expect(calls).toEqual([]);
    }
    expect(EXECUTION_CREDENTIAL_VALIDATION_CODE).toBe("EXECUTION_CREDENTIAL_VALIDATION_ERROR");
  });

  it("maps the host's write ladder and rethrows the rest", async () => {
    const failing = (err: Error) => execDeps([], { writeExecutionCredential: async () => { throw err; } });
    expect(await refusalOf(() => assistantPutExecutionCredentialRoute.handle({ input: { body: {} }, deps: failing(new HostUnconfiguredError("no key")), context: PRINCIPAL })))
      .toEqual({ status: 503, body: { error: "host operator copy", code: "SECRET_STORE_UNCONFIGURED" } });
    expect(await refusalOf(() => assistantPutExecutionCredentialRoute.handle({ input: { body: {} }, deps: failing(new HostValidationError("bad")), context: PRINCIPAL })))
      .toEqual({ status: 400, body: { error: "bad", code: "HOST_VALIDATION_ERROR" } });
    await expect(assistantPutExecutionCredentialRoute.handle({ input: { body: {} }, deps: failing(new Error("db down")), context: PRINCIPAL })).rejects.toThrow("db down");
  });

  it("fail closed without an authenticated principal (a wiring bug), touching no store", async () => {
    const calls: unknown[] = [];
    const deps = execDeps(calls);
    for (const route of [assistantGetExecutionCredentialRoute, assistantDeleteExecutionCredentialRoute]) {
      await expect(route.handle({ input: {}, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
    }
    await expect(assistantPutExecutionCredentialRoute.handle({ input: { body: { apiKey: 1 } }, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
    expect(calls).toEqual([]);
  });
});
