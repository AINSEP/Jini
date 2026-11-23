import { describe, expect, it } from "vitest";

import { listModelsRoute, type ListModelsRouteDeps } from "../list-models.js";
import { testConnectionRoute, type TestConnectionRouteDeps } from "../test-connection.js";
import { GOOGLE, PERMISSION, PREFIX, PRINCIPAL, raw, recordingAuthorize, refusal, signal } from "./helpers.js";

type ProbeDeps = ListModelsRouteDeps & TestConnectionRouteDeps;

/** Fake probe deps: both stored readers and both provider probes record what reached them. */
function probeDeps(overrides: Partial<ProbeDeps> = {}) {
  const calls = { list: [] as unknown[], test: [] as unknown[], site: 0, admin: [] as string[] };
  const deps: ProbeDeps = {
    adminAssistantPermission: PERMISSION,
    noServerKeyMessage: "host copy: save a key on the server",
    resolveStoredSiteCredential: async () => { calls.site += 1; return { apiKey: "site-key", baseUrl: GOOGLE }; },
    resolveStoredAdminCredential: async ({ principalId }) => { calls.admin.push(principalId); return { apiKey: "admin-key", baseUrl: GOOGLE }; },
    listProviderModels: async (required, optional) => { calls.list.push([required, optional]); return { ok: true, kind: "ok", models: [{ id: "m1" }, { id: "m2" }] }; },
    testProviderConnection: async (required, optional) => { calls.test.push([required, optional]); return { ok: true, kind: "ok" }; },
    ...overrides,
  };
  return { deps, calls };
}

const PROTOCOL_ERROR = { error: "protocol must be one of anthropic|openai|azure|google", code: "VALIDATION_ERROR" };

describe("listModelsRoute", () => {
  const call = (input: unknown, deps: ProbeDeps, authorize = recordingAuthorize().authorize) =>
    listModelsRoute.handle({ input, deps, context: PRINCIPAL, authorize }, { signal });

  it("pins method, path, default status and no body cap; parse hands the raw body to the handler", () => {
    expect([listModelsRoute.method, listModelsRoute.path, listModelsRoute.successStatus, listModelsRoute.maxBodyBytes])
      .toEqual(["post", `${PREFIX}/execution/models`, undefined, undefined]);
    const body = { protocol: "google" };
    expect(listModelsRoute.parse(raw(body))).toEqual({ ok: true, value: body });
  });

  it("authorizes the assistant permission on assistant-execution (no entity) before touching the body or a credential", async () => {
    const { deps, calls } = probeDeps();
    const recorder = recordingAuthorize();
    await call({ protocol: "google", baseUrl: GOOGLE, apiKey: "typed" }, deps, recorder.authorize);
    expect(recorder.calls).toEqual([{ permission: PERMISSION, entityType: "assistant-execution" }]);
    const denied = recordingAuthorize({ deny: true });
    expect((await refusal(call({ protocol: "nope", useStoredCredential: true }, deps, denied.authorize))).status).toBe(403);
    expect([calls.site, calls.admin.length, calls.list.length]).toEqual([0, 0, 1]);
  });

  it("refuses an unsupported protocol, an absent body and a blank baseUrl with the flat 400 bodies, reading no credential", async () => {
    const { deps, calls } = probeDeps();
    expect(await refusal(call({ protocol: "mistral", baseUrl: GOOGLE }, deps))).toEqual({ status: 400, body: PROTOCOL_ERROR });
    expect(await refusal(call(undefined, deps))).toEqual({ status: 400, body: PROTOCOL_ERROR });
    expect(await refusal(call({ protocol: "google", baseUrl: "   ", useStoredCredential: true }, deps)))
      .toEqual({ status: 400, body: { error: "baseUrl is required", code: "VALIDATION_ERROR" } });
    expect(await refusal(call({ protocol: "google", baseUrl: 42 }, deps)))
      .toEqual({ status: 400, body: { error: "baseUrl is required", code: "VALIDATION_ERROR" } });
    expect([calls.site, calls.list.length]).toEqual([0, 0]);
  });

  it("probes with the typed key, answers only model ids and omits an absent message; apiVersion only when given", async () => {
    const { deps, calls } = probeDeps();
    expect(await call({ protocol: "google", baseUrl: GOOGLE, apiKey: "typed" }, deps)).toEqual({ ok: true, value: { ok: true, models: ["m1", "m2"] } });
    await call({ protocol: "azure", baseUrl: GOOGLE, apiKey: "typed", apiVersion: "2024-10-21" }, deps);
    expect(calls.list).toEqual([
      [{ protocol: "google", baseUrl: GOOGLE, apiKey: "typed" }, {}],
      [{ protocol: "azure", baseUrl: GOOGLE, apiKey: "typed" }, { apiVersion: "2024-10-21" }],
    ]);
  });

  it("an auth failure with no key answers the host's injected copy; with a key, the runtime's own detail", async () => {
    const failing = { listProviderModels: async () => ({ ok: false, kind: "auth_failed", detail: "provider said 401" }) };
    const { deps } = probeDeps(failing);
    expect(await call({ protocol: "google", baseUrl: GOOGLE }, deps))
      .toEqual({ ok: true, value: { ok: false, models: [], message: "host copy: save a key on the server" } });
    expect(await call({ protocol: "google", baseUrl: GOOGLE, apiKey: "typed" }, deps))
      .toEqual({ ok: true, value: { ok: false, models: [], message: "provider said 401" } });
  });

  it("stored opt-ins: the admin row is opened for the SESSION principal, and a mismatched endpoint is the 400 failure body", async () => {
    const { deps, calls } = probeDeps();
    await call({ protocol: "google", baseUrl: GOOGLE, useAdminStoredCredential: true, principalId: "someone-else" }, deps);
    expect(calls.admin).toEqual([PRINCIPAL.id]);
    expect(calls.list).toEqual([[{ protocol: "google", baseUrl: GOOGLE, apiKey: "admin-key" }, {}]]);
    const mismatch = await refusal(call({ protocol: "google", baseUrl: "https://attacker.example.com", useStoredCredential: true }, deps));
    expect(mismatch).toEqual({ status: 400, body: {
      error: `the stored site assistant credential is saved for '${GOOGLE}' and cannot be probed against 'https://attacker.example.com' — save the new endpoint first, or supply an apiKey for it in this request`,
      code: "STORED_CREDENTIAL_ENDPOINT_MISMATCH",
    } });
    await call({ protocol: "google", baseUrl: GOOGLE, useStoredCredential: "yes" }, deps);
    expect(calls.site).toBe(1);
  });

  it("rethrows an unmapped probe failure unchanged and fails closed without authorizer or principal", async () => {
    const { deps } = probeDeps({ listProviderModels: async () => { throw new Error("boom"); } });
    await expect(call({ protocol: "google", baseUrl: GOOGLE }, deps)).rejects.toThrow("boom");
    await expect(listModelsRoute.handle({ input: {}, deps, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    const authorize = recordingAuthorize().authorize;
    await expect(listModelsRoute.handle({ input: { protocol: "google", baseUrl: GOOGLE }, deps, context: undefined, authorize }, { signal })).rejects.toThrow(/no authenticated principal/);
  });
});

describe("testConnectionRoute", () => {
  const call = (input: unknown, deps: ProbeDeps, authorize = recordingAuthorize().authorize) =>
    testConnectionRoute.handle({ input, deps, context: PRINCIPAL, authorize }, { signal });

  it("pins method and path, and authorizes before refusing", async () => {
    expect([testConnectionRoute.method, testConnectionRoute.path, testConnectionRoute.maxBodyBytes]).toEqual(["post", `${PREFIX}/execution/test-connection`, undefined]);
    const { deps } = probeDeps();
    const recorder = recordingAuthorize();
    await refusal(call({}, deps, recorder.authorize));
    expect(recorder.calls).toEqual([{ permission: PERMISSION, entityType: "assistant-execution" }]);
  });

  it("refuses a bad protocol, then a blank baseUrl or model, with the flat 400 bodies", async () => {
    const { deps, calls } = probeDeps();
    expect(await refusal(call(null, deps))).toEqual({ status: 400, body: PROTOCOL_ERROR });
    const missing = { status: 400, body: { error: "baseUrl and model are required", code: "VALIDATION_ERROR" } };
    expect(await refusal(call({ protocol: "openai", baseUrl: GOOGLE, model: " " }, deps))).toEqual(missing);
    expect(await refusal(call({ protocol: "openai", baseUrl: "", model: "gpt" }, deps))).toEqual(missing);
    expect(calls.test).toEqual([]);
  });

  it("probes with the resolved credential and the model, forwarding apiVersion only when given", async () => {
    const { deps, calls } = probeDeps();
    await call({ protocol: "google", baseUrl: GOOGLE, model: "gemini", apiKey: "typed" }, deps);
    await call({ protocol: "azure", baseUrl: GOOGLE, model: "gpt", useAdminStoredCredential: true, apiVersion: "2024-10-21" }, deps);
    expect(calls.test).toEqual([
      [{ protocol: "google", baseUrl: GOOGLE, apiKey: "typed", model: "gemini" }, {}],
      [{ protocol: "azure", baseUrl: GOOGLE, apiKey: "admin-key", model: "gpt" }, { apiVersion: "2024-10-21" }],
    ]);
  });

  it.each([
    [{ ok: true, kind: "ok" }, "Connection succeeded"],
    [{ ok: true, kind: "ok", detail: "  " }, "Connection succeeded"],
    [{ ok: true, kind: "ok", detail: "200 in 40ms" }, "200 in 40ms"],
    [{ ok: false, kind: "auth_failed" }, "Connection failed (auth_failed)"],
    [{ ok: false, kind: "timeout", detail: "no answer" }, "no answer"],
  ])("renders %j as its message", async (result, message) => {
    const { deps } = probeDeps({ testProviderConnection: async () => result });
    expect(await call({ protocol: "google", baseUrl: GOOGLE, model: "m", apiKey: "k" }, deps)).toEqual({ ok: true, value: { ok: result.ok, message } });
  });
});
