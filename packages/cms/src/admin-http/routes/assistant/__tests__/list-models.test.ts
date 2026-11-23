import { describe, expect, it } from "vitest";

import { assistantListModelsRoute } from "../list-models.js";
import type { ProbeCredentialResolution } from "../execution-shared.js";
import { PERMISSION, PRINCIPAL, raw, recordingAuthorize, recordingCredential, refusalOf, WORKSPACE_ID } from "./execution-helpers.js";

const NO_KEY = "host: no key saved";
type Result = { ok: boolean; kind?: string; detail?: string; models?: Array<{ id: string; label?: string }> };

function deps(result: Result = { ok: true, models: [{ id: "m1", label: "M1" }] }, resolution?: ProbeCredentialResolution) {
  const credential = recordingCredential(resolution);
  const sent: unknown[] = [];
  return {
    credential, sent,
    deps: {
      workspaceId: WORKSPACE_ID, manageAssistantPermission: PERMISSION, noServerKeyMessage: NO_KEY,
      resolveProbeCredential: credential.resolve,
      listModels: async (request: unknown, optional: unknown = {}) => { sent.push([request, optional]); return result; },
    },
  };
}
const input = (overrides: Record<string, unknown> = {}) =>
  ({ protocol: "openai", baseUrl: "https://p.example", apiVersion: undefined, typedKey: "sk-typed", useStoredCredential: false, useAdminStoredCredential: false, ...overrides }) as never;
const run = (i: never, d = deps().deps, authorize = recordingAuthorize().authorize) =>
  assistantListModelsRoute.handle({ input: i, deps: d, context: PRINCIPAL, authorize });

describe("assistantListModelsRoute", () => {
  it("pins method, path, success status and no body cap", () => {
    expect(assistantListModelsRoute.method).toBe("post");
    expect(assistantListModelsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/assistant/execution/models");
    expect(assistantListModelsRoute.successStatus).toBeUndefined();
    expect(assistantListModelsRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses string fields verbatim, non-strings to their fallbacks, and the two opt-ins only as strict true", () => {
    expect(assistantListModelsRoute.parse(raw({ protocol: "azure", baseUrl: " u ", apiKey: "k", apiVersion: "v1", useStoredCredential: true, useAdminStoredCredential: "true" })))
      .toEqual({ ok: true, value: { protocol: "azure", baseUrl: " u ", apiVersion: "v1", typedKey: "k", useStoredCredential: true, useAdminStoredCredential: false } });
    expect(assistantListModelsRoute.parse(raw(undefined)))
      .toEqual({ ok: true, value: { protocol: "", baseUrl: "", apiVersion: undefined, typedKey: "", useStoredCredential: false, useAdminStoredCredential: false } });
  });

  it("authorizes first, then refuses an unsupported protocol and a blank baseUrl without opening a credential", async () => {
    const auth = recordingAuthorize();
    const { deps: d, credential, sent } = deps();
    expect(await refusalOf(() => run(input({ protocol: "x" }), d, auth.authorize)))
      .toEqual({ status: 400, body: { error: "protocol must be one of anthropic|openai|azure|google", code: "VALIDATION_ERROR" } });
    expect(await refusalOf(() => run(input({ baseUrl: "  " }), d)))
      .toEqual({ status: 400, body: { error: "baseUrl is required", code: "VALIDATION_ERROR" } });
    expect(auth.calls).toEqual([{ permission: PERMISSION, entityType: "assistant-execution" }]);
    expect(credential.calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a denied principal never opens a credential", async () => {
    const { deps: d, credential } = deps();
    await expect(run(input(), d, recordingAuthorize(true).authorize)).rejects.toThrow(`denied ${PERMISSION}`);
    expect(credential.calls).toEqual([]);
  });

  it("answers the credential chokepoint's refusal as its flat 400 body and never probes", async () => {
    const failure = { error: "saved for 'a', cannot be probed against 'b'", code: "STORED_CREDENTIAL_ENDPOINT_MISMATCH" };
    const { deps: d, sent } = deps(undefined, { ok: false, failure });
    expect(await refusalOf(() => run(input({ typedKey: "" , useStoredCredential: true }), d))).toEqual({ status: 400, body: failure });
    expect(sent).toEqual([]);
  });

  it("passes the session principal (never the body) to the chokepoint and probes with its resolved pair", async () => {
    const { deps: d, credential, sent } = deps({ ok: true, models: [{ id: "m1", label: "M1" }, { id: "m2" }] }, { ok: true, apiKey: "sk-stored", baseUrl: "https://stored.example/" });
    const result = await run(input({ typedKey: "", useAdminStoredCredential: true, apiVersion: "2024" }), d);
    expect(credential.calls).toEqual([{ requestedBaseUrl: "https://p.example", typedKey: "", useStoredCredential: false, useAdminStoredCredential: true, principalId: PRINCIPAL.id }]);
    expect(sent).toEqual([[{ protocol: "openai", baseUrl: "https://stored.example/", apiKey: "sk-stored" }, { apiVersion: "2024" }]]);
    expect(result).toEqual({ ok: true, value: { ok: true, models: ["m1", "m2"] } });
  });

  it("omits apiVersion when absent and the message when the runtime gave none; a missing-models result is []", async () => {
    const { deps: d, sent } = deps({ ok: false, kind: "network" });
    expect(await run(input(), d)).toEqual({ ok: true, value: { ok: false, models: [] } });
    expect(sent).toEqual([[{ protocol: "openai", baseUrl: "https://p.example", apiKey: "sk-typed" }, {}]]);
  });

  it("replaces an empty-key auth failure with the injected host copy, but keeps the runtime detail for a real key", async () => {
    expect(await run(input({ typedKey: "" }), deps({ ok: false, kind: "auth_failed", detail: "runtime copy" }).deps))
      .toEqual({ ok: true, value: { ok: false, models: [], message: NO_KEY } });
    expect(await run(input(), deps({ ok: false, kind: "auth_failed", detail: "401 from provider" }).deps))
      .toEqual({ ok: true, value: { ok: false, models: [], message: "401 from provider" } });
  });

  it("rethrows a probe failure unchanged, and fails closed without a principal", async () => {
    const d = { ...deps().deps, listModels: async () => { throw new Error("dns down"); } };
    await expect(run(input(), d)).rejects.toThrow("dns down");
    await expect(assistantListModelsRoute.handle({ input: input(), deps: deps().deps, context: undefined, authorize: recordingAuthorize().authorize }))
      .rejects.toThrow(/no authenticated principal/);
  });
});
