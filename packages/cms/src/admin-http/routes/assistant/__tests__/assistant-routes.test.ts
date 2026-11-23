import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { deleteExecutionCredentialRoute } from "../delete-execution-credential.js";
import { deleteSiteCredentialRoute } from "../delete-site-credential.js";
import { getExecutionCredentialRoute } from "../get-execution-credential.js";
import { getAssistantSettingsRoute } from "../get-settings.js";
import { getSiteCredentialRoute } from "../get-site-credential.js";
import { putExecutionCredentialRoute } from "../put-execution-credential.js";
import { putAssistantSettingsRoute } from "../put-settings.js";
import { putSiteCredentialRoute } from "../put-site-credential.js";
import { testAgentRoute } from "../test-agent.js";

const PREFIX = "/api/admin/v1/workspaces/:workspaceId/assistant";
const PERMISSION = "admin.assistant.manage";
const PRINCIPAL = { id: "admin-9" };
const signal = new AbortController().signal;
const raw = (body: unknown) => ({ body, query: {}, params: { workspaceId: "ws-7" } });

function recordingAuthorize({ deny = false }: { deny?: boolean } = {}) {
  const calls: unknown[] = [];
  const authorize = async (args: { permission: string; entityType: string }) => {
    calls.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied", code: "FORBIDDEN" } });
  };
  return { calls, authorize };
}

async function refusal(pending: unknown): Promise<RouteRefusalError["response"]> {
  const error = await Promise.resolve(pending).then(() => undefined, (e: unknown) => e);
  if (!(error instanceof RouteRefusalError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.response;
}

function parsed<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error("parse must succeed");
  return result.value;
}

describe("assistant admin route specs", () => {
  it("keeps every method and byte-identical path", () => {
    expect([
      deleteExecutionCredentialRoute, getExecutionCredentialRoute, putExecutionCredentialRoute,
      getSiteCredentialRoute, putSiteCredentialRoute, deleteSiteCredentialRoute,
      getAssistantSettingsRoute, putAssistantSettingsRoute, testAgentRoute,
    ].map((r) => `${r.method} ${r.path}`)).toEqual([
      `delete ${PREFIX}/execution-credential`, `get ${PREFIX}/execution-credential`, `put ${PREFIX}/execution-credential`,
      `get ${PREFIX}/site-credential`, `put ${PREFIX}/site-credential`, `delete ${PREFIX}/site-credential`,
      `get ${PREFIX}/settings`, `put ${PREFIX}/settings`, `post ${PREFIX}/execution/test-agent`,
    ]);
  });

  it("execution-credential GET/DELETE are scoped to the authenticated principal without an authorize call", async () => {
    const { calls, authorize } = recordingAuthorize();
    const seen: unknown[] = [];
    const get = await getExecutionCredentialRoute.handle({ input: undefined, deps: { getExecutionCredential: async (a) => { seen.push(a); return { isSet: true }; } }, context: PRINCIPAL, authorize }, { signal });
    const del = await deleteExecutionCredentialRoute.handle({ input: undefined, deps: { deleteExecutionCredential: async (a) => { seen.push(a); return { isSet: false }; } }, context: PRINCIPAL, authorize }, { signal });
    expect(get).toEqual({ ok: true, value: { data: { isSet: true } } });
    expect(del).toEqual({ ok: true, value: { data: { isSet: false } } });
    expect(seen).toEqual([{ principalId: "admin-9" }, { principalId: "admin-9" }]);
    expect(calls).toEqual([]);
    await expect(getExecutionCredentialRoute.handle({ input: undefined, deps: { getExecutionCredential: async () => null }, context: undefined, authorize }, { signal })).rejects.toThrow(/no authenticated principal/);
  });

  it("execution-credential PUT rejects a present wrong-typed field at parse with 400 EXECUTION_CREDENTIAL_VALIDATION_ERROR", async () => {
    const code = "EXECUTION_CREDENTIAL_VALIDATION_ERROR";
    for (const [body, error] of [
      [{ apiKey: 12345 }, "apiKey must be a string"], [{ maxTokens: "9" }, "maxTokens must be a number"],
      [{ providerId: 4 }, "providerId must be a string or null"],
    ] as const) {
      expect(await refusal(Promise.resolve().then(() => putExecutionCredentialRoute.parse(raw(body))))).toEqual({ status: 400, body: { error, code } });
    }
    expect(parsed(putExecutionCredentialRoute.parse(raw({ providerId: null, maxTokens: 4096 })))).toEqual({ apiKey: undefined, protocol: undefined, providerId: null, baseUrl: undefined, model: undefined, maxTokens: 4096 });
    expect(parsed(putExecutionCredentialRoute.parse(raw(null)))).toEqual({});
    expect(parsed(putExecutionCredentialRoute.parse(raw({ model: "m", stray: "x" })))).not.toHaveProperty("stray");
  });

  it("execution-credential PUT maps classified service failures and rethrows the rest unchanged", async () => {
    const { authorize } = recordingAuthorize();
    const boom = new Error("boom");
    const deps = (error: unknown, kind: "validation" | "secret-store-unconfigured" | undefined) => ({
      setExecutionCredential: async () => { throw error; }, executionCredentialErrorKind: () => kind, secretStoreUnconfiguredError: "set the site key",
    });
    const run = (d: ReturnType<typeof deps>) => putExecutionCredentialRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize }, { signal });
    expect(await refusal(run(deps(new Error("apiKey must not be empty"), "validation")))).toEqual({ status: 400, body: { error: "apiKey must not be empty", code: "EXECUTION_CREDENTIAL_VALIDATION_ERROR" } });
    expect(await refusal(run(deps(boom, "secret-store-unconfigured")))).toEqual({ status: 503, body: { error: "set the site key", code: "SECRET_STORE_UNCONFIGURED" } });
    await expect(run(deps(boom, undefined))).rejects.toBe(boom);
    const seen: unknown[] = [];
    const saved = await putExecutionCredentialRoute.handle({ input: { model: "m" }, deps: { ...deps(boom, undefined), setExecutionCredential: async (a) => { seen.push(a); return { isSet: true }; } }, context: PRINCIPAL, authorize }, { signal });
    expect(saved).toEqual({ ok: true, value: { data: { isSet: true } } });
    expect(seen).toEqual([{ principalId: "admin-9", patch: { model: "m" } }]);
  });

  it("site-credential GET/DELETE authorize the assistant permission on assistant-settings, and a denial reaches no service", async () => {
    const { calls, authorize } = recordingAuthorize();
    const deps = { adminAssistantPermission: PERMISSION, getSiteCredential: async () => ({ isSet: true }), deleteSiteCredential: async () => ({ isSet: false }) };
    expect(await getSiteCredentialRoute.handle({ input: undefined, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: { data: { isSet: true } } });
    expect(await deleteSiteCredentialRoute.handle({ input: undefined, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: { data: { isSet: false } } });
    expect(calls).toEqual([{ permission: PERMISSION, entityType: "assistant-settings" }, { permission: PERMISSION, entityType: "assistant-settings" }]);
    const denied = recordingAuthorize({ deny: true });
    let reached = false;
    const guarded = { ...deps, deleteSiteCredential: async () => { reached = true; return null; } };
    expect((await refusal(deleteSiteCredentialRoute.handle({ input: undefined, deps: guarded, context: PRINCIPAL, authorize: denied.authorize }, { signal }))).status).toBe(403);
    expect(reached).toBe(false);
  });

  it("site-credential PUT authorizes before validating and maps service failures", async () => {
    const order: string[] = [];
    const authorize = async () => { order.push("authorize"); };
    const deps = {
      adminAssistantPermission: PERMISSION, setSiteCredential: async (a: unknown) => { order.push("set"); return a; },
      siteCredentialErrorKind: () => undefined, secretStoreUnconfiguredError: "set the site key",
    };
    expect(parsed(putSiteCredentialRoute.parse(raw(null)))).toEqual({});
    expect(await refusal(putSiteCredentialRoute.handle({ input: { apiKey: 12345 }, deps, context: PRINCIPAL, authorize }, { signal }))).toEqual({ status: 400, body: { error: "apiKey must be a string", code: "SITE_CREDENTIAL_VALIDATION_ERROR" } });
    expect(order).toEqual(["authorize"]);
    expect(await putSiteCredentialRoute.handle({ input: { model: "kept" }, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: { data: { patch: { apiKey: undefined, provider: undefined, baseUrl: undefined, model: "kept" } } } });
    const unconfigured = { ...deps, setSiteCredential: async () => { throw new Error("no key"); }, siteCredentialErrorKind: () => "secret-store-unconfigured" as const };
    expect(await refusal(putSiteCredentialRoute.handle({ input: {}, deps: unconfigured, context: PRINCIPAL, authorize }, { signal }))).toEqual({ status: 503, body: { error: "set the site key", code: "SECRET_STORE_UNCONFIGURED" } });
  });

  it("settings GET waits for readiness before authorizing and folds in the admin-assistant switch", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const authorize = async () => { order.push("authorize"); };
    const pending = getAssistantSettingsRoute.handle({ input: undefined, deps: {
      adminAssistantPermission: PERMISSION, assistantSettingsReady: ready, adminAssistantEnabled: false,
      getPublicAssistantSettings: async () => { order.push("read"); return { publicEnabled: true }; },
    }, context: PRINCIPAL, authorize }, { signal });
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    expect(await pending).toEqual({ ok: true, value: { data: { publicEnabled: true }, adminAssistantEnabled: false } });
    expect(order).toEqual(["authorize", "read"]);
  });

  it("settings PUT passes the body as the patch (undefined -> {}) and answers 400 for a classified validation failure", async () => {
    const { authorize } = recordingAuthorize();
    const seen: unknown[] = [];
    const deps = {
      adminAssistantPermission: PERMISSION, assistantSettingsReady: Promise.resolve(),
      setPublicAssistantSettings: async (a: { patch: unknown; callerPrincipalId: string }) => { seen.push(a); return { publicEnabled: true }; },
      isSettingsValidationError: (error: unknown) => error instanceof TypeError,
    };
    const input = parsed(putAssistantSettingsRoute.parse(raw(undefined)));
    expect(await putAssistantSettingsRoute.handle({ input, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: { data: { publicEnabled: true } } });
    expect(seen).toEqual([{ patch: {}, callerPrincipalId: "admin-9" }]);
    const invalid = { ...deps, setPublicAssistantSettings: async () => { throw new TypeError("publicEnabled must be a boolean"); } };
    expect(await refusal(putAssistantSettingsRoute.handle({ input, deps: invalid, context: PRINCIPAL, authorize }, { signal }))).toEqual({ status: 400, body: { error: "publicEnabled must be a boolean", code: "ASSISTANT_SETTINGS_VALIDATION_ERROR" } });
    const boom = new Error("db down");
    await expect(putAssistantSettingsRoute.handle({ input, deps: { ...deps, setPublicAssistantSettings: async () => { throw boom; } }, context: PRINCIPAL, authorize }, { signal })).rejects.toBe(boom);
  });

  it("test-agent trims the body, authorizes assistant-execution, requires agentId, and forces a fresh detection", async () => {
    const { calls, authorize } = recordingAuthorize();
    const detections: unknown[] = [];
    const deps = {
      adminAssistantPermission: PERMISSION,
      detectAgents: async (required: { agentIds: string[] }, optional: { force: boolean }) => {
        detections.push([required, optional]);
        return [{ id: "cli", name: "CLI", available: true, authStatus: "ok", version: "1.0", models: [{ id: "m" }] }] as never;
      },
    };
    expect(parsed(testAgentRoute.parse(raw({ agentId: " cli ", model: " m " })))).toEqual({ agentId: "cli", model: "m" });
    expect(parsed(testAgentRoute.parse(raw(null)))).toEqual({ agentId: "", model: "" });
    expect(await refusal(testAgentRoute.handle({ input: { agentId: "", model: "" }, deps, context: PRINCIPAL, authorize }, { signal }))).toEqual({ status: 400, body: { error: "'agentId' is required", code: "BAD_REQUEST" } });
    expect(await testAgentRoute.handle({ input: { agentId: "cli", model: "m" }, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: { ok: true, message: "CLI 1.0 is installed and authenticated, and offers 'm'." } });
    expect(await testAgentRoute.handle({ input: { agentId: "gone", model: "" }, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: { ok: false, message: "'gone' was not found on this server's PATH." } });
    expect(calls).toEqual(Array(3).fill({ permission: PERMISSION, entityType: "assistant-execution" }));
    expect(detections).toEqual([[{ agentIds: ["cli"] }, { force: true }], [{ agentIds: ["gone"] }, { force: true }]]);
  });
});
