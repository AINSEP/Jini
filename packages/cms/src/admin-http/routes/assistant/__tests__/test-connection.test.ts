import { describe, expect, it } from "vitest";

import { assistantTestConnectionRoute } from "../test-connection.js";
import type { ProbeCredentialResolution } from "../execution-shared.js";
import { PERMISSION, PRINCIPAL, raw, recordingAuthorize, recordingCredential, refusalOf, WORKSPACE_ID } from "./execution-helpers.js";

type Result = { ok: boolean; kind: string; detail?: string };

function deps(result: Result = { ok: true, kind: "ok" }, resolution?: ProbeCredentialResolution) {
  const credential = recordingCredential(resolution);
  const sent: unknown[] = [];
  return {
    credential, sent,
    deps: {
      workspaceId: WORKSPACE_ID, manageAssistantPermission: PERMISSION,
      resolveProbeCredential: credential.resolve,
      testConnection: async (request: unknown, optional: unknown = {}) => { sent.push([request, optional]); return result; },
    },
  };
}
const input = (overrides: Record<string, unknown> = {}) =>
  ({ protocol: "anthropic", baseUrl: "https://p.example", model: "m1", apiVersion: undefined, typedKey: "sk-typed", useStoredCredential: false, useAdminStoredCredential: false, ...overrides }) as never;
const run = (i: never, d = deps().deps, authorize = recordingAuthorize().authorize) =>
  assistantTestConnectionRoute.handle({ input: i, deps: d, context: PRINCIPAL, authorize });

describe("assistantTestConnectionRoute", () => {
  it("pins method, path, success status and no body cap", () => {
    expect(assistantTestConnectionRoute.method).toBe("post");
    expect(assistantTestConnectionRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/assistant/execution/test-connection");
    expect(assistantTestConnectionRoute.successStatus).toBeUndefined();
    expect(assistantTestConnectionRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses model alongside the shared probe fields; non-strings fall back", () => {
    expect(assistantTestConnectionRoute.parse(raw({ protocol: "google", baseUrl: "u", model: "m", apiKey: 5, useStoredCredential: true })))
      .toEqual({ ok: true, value: { protocol: "google", baseUrl: "u", model: "m", apiVersion: undefined, typedKey: "", useStoredCredential: true, useAdminStoredCredential: false } });
  });

  it("authorizes first, then refuses an unsupported protocol and a blank baseUrl or model without opening a credential", async () => {
    const auth = recordingAuthorize();
    const { deps: d, credential } = deps();
    expect(await refusalOf(() => run(input({ protocol: "" }), d, auth.authorize)))
      .toEqual({ status: 400, body: { error: "protocol must be one of anthropic|openai|azure|google", code: "VALIDATION_ERROR" } });
    for (const blank of [{ baseUrl: " " }, { model: "" }]) {
      expect(await refusalOf(() => run(input(blank), d))).toEqual({ status: 400, body: { error: "baseUrl and model are required", code: "VALIDATION_ERROR" } });
    }
    expect(auth.calls).toEqual([{ permission: PERMISSION, entityType: "assistant-execution" }]);
    expect(credential.calls).toEqual([]);
  });

  it("a denied principal never opens a credential", async () => {
    const { deps: d, credential } = deps();
    await expect(run(input(), d, recordingAuthorize(true).authorize)).rejects.toThrow(`denied ${PERMISSION}`);
    expect(credential.calls).toEqual([]);
  });

  it("answers the credential chokepoint's refusal as its flat 400 body and never probes", async () => {
    const failure = { error: "no saved endpoint", code: "STORED_CREDENTIAL_ENDPOINT_UNSET" };
    const { deps: d, sent } = deps(undefined, { ok: false, failure });
    expect(await refusalOf(() => run(input({ typedKey: "", useStoredCredential: true }), d))).toEqual({ status: 400, body: failure });
    expect(sent).toEqual([]);
  });

  it("probes with the resolved pair and the session principal, forwarding apiVersion only when present", async () => {
    const { deps: d, credential, sent } = deps(undefined, { ok: true, apiKey: "sk-stored", baseUrl: "https://stored.example" });
    await run(input({ typedKey: "", useStoredCredential: true, apiVersion: "v9" }), d);
    expect(credential.calls[0]?.principalId).toBe(PRINCIPAL.id);
    expect(sent).toEqual([[{ protocol: "anthropic", baseUrl: "https://stored.example", apiKey: "sk-stored", model: "m1" }, { apiVersion: "v9" }]]);
  });

  it("renders the verdict message: detail when present, else the default per outcome", async () => {
    const cases: Array<[Result, { ok: boolean; message: string }]> = [
      [{ ok: true, kind: "ok" }, { ok: true, message: "Connection succeeded" }],
      [{ ok: true, kind: "ok", detail: "  " }, { ok: true, message: "Connection succeeded" }],
      [{ ok: true, kind: "ok", detail: "fine" }, { ok: true, message: "fine" }],
      [{ ok: false, kind: "auth_failed" }, { ok: false, message: "Connection failed (auth_failed)" }],
      [{ ok: false, kind: "auth_failed", detail: "bad key" }, { ok: false, message: "bad key" }],
    ];
    for (const [result, value] of cases) expect(await run(input(), deps(result).deps)).toEqual({ ok: true, value });
  });

  it("rethrows a probe failure unchanged for the host 500", async () => {
    await expect(run(input(), { ...deps().deps, testConnection: async () => { throw new Error("boom"); } })).rejects.toThrow("boom");
  });
});

it("a whitespace-only failure detail does not hide the probe's failure kind", async () => {
  expect(await run(input(), deps({ ok: false, kind: "auth_failed", detail: " \t " }).deps))
    .toEqual({ ok: true, value: { ok: false, message: "Connection failed (auth_failed)" } });
});

it("a missing JSON body cannot supply probe credentials or a model", async () => {
  expect(await assistantTestConnectionRoute.parse({ body: undefined, params: { workspaceId: WORKSPACE_ID }, query: {} }))
    .toStrictEqual({ ok: true, value: { protocol: "", baseUrl: "", apiVersion: undefined, typedKey: "",
      useStoredCredential: false, useAdminStoredCredential: false, model: "",
    } });
});
