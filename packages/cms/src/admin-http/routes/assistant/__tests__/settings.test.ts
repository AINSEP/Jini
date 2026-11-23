import { describe, expect, it } from "vitest";

import { assistantGetSettingsRoute } from "../get-settings.js";
import { assistantPutSettingsRoute } from "../put-settings.js";
import { rejectAssistantError } from "../shared.js";
import { gate, HOST_WRITE_ERRORS, HostValidationError, MANAGE, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./settings-helpers.js";

/** @file The public-assistant switch: GET/PUT `.../assistant/settings`, plus the shared error-table reader. */

const SETTINGS = { publicEnabled: true, widget: "react" };
const ready = Promise.resolve();

function getDeps(overrides: Partial<Parameters<typeof assistantGetSettingsRoute.handle>[0]["deps"]> = {}) {
  return { workspaceId: WORKSPACE_ID, assistantSettingsReady: ready, managePermission: MANAGE, adminAssistantEnabled: false, readAssistantSettings: async () => SETTINGS, ...overrides };
}

function putDeps(overrides: Partial<Parameters<typeof assistantPutSettingsRoute.handle>[0]["deps"]> = {}) {
  return { workspaceId: WORKSPACE_ID, assistantSettingsReady: ready, managePermission: MANAGE, writeAssistantSettings: async () => SETTINGS, errorMappings: HOST_WRITE_ERRORS, ...overrides };
}

describe("assistantGetSettingsRoute", () => {
  it("keeps the method, path, success status and no body cap", () => {
    expect(assistantGetSettingsRoute.method).toBe("get");
    expect(assistantGetSettingsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/assistant/settings");
    expect(assistantGetSettingsRoute.successStatus).toBeUndefined();
    expect(assistantGetSettingsRoute.maxBodyBytes).toBeUndefined();
    expect(assistantGetSettingsRoute.parse(raw())).toEqual({ ok: true, value: {} });
  });

  it("authorizes the injected permission on assistant-settings with no entity id and folds in the injected admin flag", async () => {
    const { authorize, calls } = recordingAuthorize();
    const reads: unknown[] = [];
    const deps = getDeps({ managePermission: "host.permission", adminAssistantEnabled: true, readAssistantSettings: async (input) => { reads.push(input); return SETTINGS; } });
    const result = await assistantGetSettingsRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "host.permission", entityType: "assistant-settings" }]);
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { data: SETTINGS, adminAssistantEnabled: true } });
  });

  it("waits for the readiness gate before authorizing", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { ready: assistantSettingsReady, open } = gate();
    const pending = assistantGetSettingsRoute.handle({ input: {}, deps: getDeps({ assistantSettingsReady }), context: PRINCIPAL, authorize });
    await Promise.resolve();
    expect(calls).toEqual([]);
    open();
    // The default fixture's flag is `false`: the answer carries the injected value, not a constant.
    expect(await pending).toEqual({ ok: true, value: { data: SETTINGS, adminAssistantEnabled: false } });
    expect(calls).toHaveLength(1);
  });

  it("does not read when authorization refuses, fails closed without an authorizer, and rethrows a read failure", async () => {
    let reads = 0;
    const deps = getDeps({ readAssistantSettings: async () => { reads += 1; return SETTINGS; } });
    await expect(assistantGetSettingsRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize([MANAGE]).authorize })).rejects.toThrow(`denied ${MANAGE}`);
    await expect(assistantGetSettingsRoute.handle({ input: {}, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
    const failing = getDeps({ readAssistantSettings: async () => { throw new Error("ledger down"); } });
    await expect(assistantGetSettingsRoute.handle({ input: {}, deps: failing, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("ledger down");
  });
});

describe("assistantPutSettingsRoute", () => {
  it("keeps the method and path and passes the body (or {}) through as the patch", () => {
    expect(assistantPutSettingsRoute.method).toBe("put");
    expect(assistantPutSettingsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/assistant/settings");
    expect(assistantPutSettingsRoute.successStatus).toBeUndefined();
    expect(assistantPutSettingsRoute.maxBodyBytes).toBeUndefined();
    expect(assistantPutSettingsRoute.parse(raw({ publicEnabled: true }))).toEqual({ ok: true, value: { patch: { publicEnabled: true } } });
    expect(assistantPutSettingsRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { patch: {} } });
    expect(assistantPutSettingsRoute.parse(raw(null))).toEqual({ ok: true, value: { patch: {} } });
  });

  it("waits for readiness, authorizes, then writes as the authenticated caller and answers the settings as stored", async () => {
    const { authorize, calls } = recordingAuthorize();
    const writes: unknown[] = [];
    const { ready: assistantSettingsReady, open } = gate();
    const deps = putDeps({ assistantSettingsReady, writeAssistantSettings: async (input) => { writes.push(input); return SETTINGS; } });
    const pending = assistantPutSettingsRoute.handle({ input: { patch: { publicEnabled: true } }, deps, context: PRINCIPAL, authorize });
    await Promise.resolve();
    expect(calls).toEqual([]);
    open();
    expect(await pending).toEqual({ ok: true, value: { data: SETTINGS } });
    expect(calls).toEqual([{ permission: MANAGE, entityType: "assistant-settings" }]);
    expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, patch: { publicEnabled: true }, callerPrincipalId: PRINCIPAL.id }]);
  });

  it("maps the host's validation rung to its exact flat body and rethrows anything unmapped", async () => {
    const authorize = recordingAuthorize().authorize;
    const refused = putDeps({ writeAssistantSettings: async () => { throw new HostValidationError("widget must be supported"); } });
    expect(await refusalOf(() => assistantPutSettingsRoute.handle({ input: { patch: {} }, deps: refused, context: PRINCIPAL, authorize })))
      .toEqual({ status: 400, body: { error: "widget must be supported", code: "HOST_VALIDATION_ERROR" } });
    const failing = putDeps({ writeAssistantSettings: async () => { throw new Error("ledger down"); } });
    await expect(assistantPutSettingsRoute.handle({ input: { patch: {} }, deps: failing, context: PRINCIPAL, authorize })).rejects.toThrow("ledger down");
  });

  it("does not write when authorization refuses, and fails closed without an authorizer or a principal", async () => {
    let writes = 0;
    const deps = putDeps({ writeAssistantSettings: async () => { writes += 1; return SETTINGS; } });
    await expect(assistantPutSettingsRoute.handle({ input: { patch: {} }, deps, context: PRINCIPAL, authorize: recordingAuthorize([MANAGE]).authorize })).rejects.toThrow(`denied ${MANAGE}`);
    await expect(assistantPutSettingsRoute.handle({ input: { patch: {} }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(assistantPutSettingsRoute.handle({ input: { patch: {} }, deps, context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    expect(writes).toBe(0);
  });
});

describe("rejectAssistantError", () => {
  it("answers the first matching rung, keeps fixed copy and extra body fields, and rethrows the unmapped error itself", async () => {
    const conflict = { matches: ({ err }: { err: unknown }) => err instanceof RangeError, status: 409, code: "CONFLICT", extra: { reload: true } };
    expect(await refusalOf(() => rejectAssistantError({ err: new RangeError("stale"), mappings: [conflict, ...HOST_WRITE_ERRORS] })))
      .toEqual({ status: 409, body: { error: "stale", code: "CONFLICT", reload: true } });
    expect(await refusalOf(() => rejectAssistantError({ err: new (class extends Error {})("x"), mappings: [{ matches: () => true, status: 403, code: "FORBIDDEN", error: "fixed copy" }] })))
      .toEqual({ status: 403, body: { error: "fixed copy", code: "FORBIDDEN" } });
    const unmapped = new Error("boom");
    expect(() => rejectAssistantError({ err: unmapped, mappings: HOST_WRITE_ERRORS })).toThrow(unmapped);
  });
});
