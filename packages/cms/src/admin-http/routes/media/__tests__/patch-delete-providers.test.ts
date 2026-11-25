import { isRouteReply } from "@jini-ai/core/contracts/server";
import { describe, expect, it } from "vitest";

import { mediaDeleteProviderRoute, type MediaDeleteProviderRouteDeps } from "../delete-provider.js";
import { mediaPatchProviderRoute, type MediaPatchProviderRouteDeps } from "../patch-provider.js";
import { PRINCIPAL, raw, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file The one-row PATCH and DELETE media-provider specs: one provider per request, authorized before any credential port runs. */

const PATH = "/api/admin/v1/workspaces/:workspaceId/media/providers/:providerId";
const MARKERS = { openai: { configured: true, last4: "abcd" } };
const READ_MODEL = { providers: MARKERS, revision: "rev-7" };
class HostValidationError extends Error {}
const REFUSALS: MediaPatchProviderRouteDeps["saveErrorMappings"] = [
  { matches: ({ err }) => err instanceof HostValidationError, status: 400, code: "TEST_VALIDATION" },
];

/** A shared, ordered log of what ran: the authorizer's asks and the credential port's calls. */
function orderedLog(denied: readonly string[] = []) {
  const log: string[] = [];
  const authorize = async ({ permission }: { permission: string; entityType?: string }) => {
    log.push(`authorize:${permission}`);
    if (denied.includes(permission)) throw new Error(`denied ${permission}`);
  };
  return { log, authorize };
}

function patchDeps(log: string[], calls: unknown[] = []): MediaPatchProviderRouteDeps {
  return {
    workspaceId: WORKSPACE_ID,
    patchProvider: async (input) => { log.push("patchProvider"); calls.push(input); return READ_MODEL; },
    saveErrorMappings: REFUSALS,
    outwardErrorMessage: ({ error }) => error.message,
  };
}

function deleteDeps(log: string[], calls: unknown[] = []): MediaDeleteProviderRouteDeps {
  return {
    workspaceId: WORKSPACE_ID,
    removeProvider: async (input) => { log.push("removeProvider"); calls.push(input); return READ_MODEL; },
    saveErrorMappings: REFUSALS,
    outwardErrorMessage: ({ error }) => error.message,
  };
}

describe("mediaPatchProviderRoute", () => {
  it("keeps the method and path; parses the provider id and the raw body", () => {
    expect([mediaPatchProviderRoute.method, mediaPatchProviderRoute.path, mediaPatchProviderRoute.successStatus]).toEqual(["patch", PATH, undefined]);
    expect(mediaPatchProviderRoute.parse(raw({ providerId: "openai" }, { apiKey: "test-token-1" }))).toEqual({ ok: true, value: { providerId: "openai", body: { apiKey: "test-token-1" } } });
  });

  it("saves one provider's fields and answers the redacted read model with its revision", async () => {
    const { log, authorize } = orderedLog();
    const calls: unknown[] = [];
    const result = await mediaPatchProviderRoute.handle({ input: { providerId: "openai", body: { apiKey: "test-token-1", model: "m-1" } }, deps: patchDeps(log, calls), context: PRINCIPAL, authorize }, { signal });
    expect(result.ok && isRouteReply(result.value)).toBe(true);
    expect(result).toEqual({ ok: true, value: { status: 200, body: MARKERS, headers: { etag: '"rev-7"' } } });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, providerId: "openai", fields: { apiKey: "test-token-1", model: "m-1" } }]);
    expect(JSON.stringify(result)).not.toContain("test-token-1");
  });

  it("a per-provider PATCH cannot submit a second provider", async () => {
    const bodies: unknown[] = [
      { openai: { apiKey: "test-token-a" }, fal: { apiKey: "test-token-b" } },
      { apiKey: "test-token-a", fal: { apiKey: "test-token-b" } },
      { providers: { fal: { apiKey: "test-token-b" } } },
      { apiKey: { nested: "test-token-a" } },
      [{ apiKey: "test-token-a" }],
      null,
      "test-token-a",
    ];
    for (const body of bodies) {
      const { log, authorize } = orderedLog();
      const refusal = await refusalOf(() => mediaPatchProviderRoute.handle({ input: { providerId: "openai", body }, deps: patchDeps(log), context: PRINCIPAL, authorize }));
      expect(refusal).toEqual({ status: 400, body: { error: "Send the settings for one provider only: its API key, base URL or model, each as text.", code: "MEDIA_PROVIDER_FIELDS_INVALID" } });
      expect(JSON.stringify(refusal)).not.toContain("test-token");
      expect(log).toEqual(["authorize:admin.integrations.manage"]);
    }
  });

  it("refuses an empty or malformed provider id without calling the port", async () => {
    for (const providerId of ["", "   ", "a\u0000b", "x".repeat(201)]) {
      const { log, authorize } = orderedLog();
      expect(await refusalOf(() => mediaPatchProviderRoute.handle({ input: { providerId, body: { model: "m" } }, deps: patchDeps(log), context: PRINCIPAL, authorize })))
        .toEqual({ status: 400, body: { error: "Choose a media provider.", code: "MEDIA_PROVIDER_ID_INVALID" } });
      expect(log).toEqual(["authorize:admin.integrations.manage"]);
    }
  });

  it("answers the host's mapped refusals and rethrows the rest", async () => {
    const { authorize } = orderedLog();
    const failing = (error: Error): MediaPatchProviderRouteDeps => ({ ...patchDeps([]), patchProvider: async () => { throw error; } });
    const call = (deps: MediaPatchProviderRouteDeps) => mediaPatchProviderRoute.handle({ input: { providerId: "openai", body: { model: "m" } }, deps, context: PRINCIPAL, authorize });
    expect(await refusalOf(() => call(failing(new HostValidationError("unknown provider"))))).toEqual({ status: 400, body: { error: "unknown provider", code: "TEST_VALIDATION" } });
    await expect(call(failing(new Error("vault gone")))).rejects.toThrow("vault gone");
  });
});

describe("mediaDeleteProviderRoute", () => {
  it("keeps the method and path; parses the provider id", () => {
    expect([mediaDeleteProviderRoute.method, mediaDeleteProviderRoute.path, mediaDeleteProviderRoute.successStatus]).toEqual(["delete", PATH, undefined]);
    expect(mediaDeleteProviderRoute.parse(raw({ providerId: "plugin-vendor" }))).toEqual({ ok: true, value: { providerId: "plugin-vendor" } });
    expect(mediaDeleteProviderRoute.parse(raw({}))).toEqual({ ok: true, value: { providerId: "" } });
  });

  it("removes exactly the named provider and answers the redacted read model with its revision", async () => {
    const { log, authorize } = orderedLog();
    const calls: unknown[] = [];
    const result = await mediaDeleteProviderRoute.handle({ input: { providerId: "plugin-vendor" }, deps: deleteDeps(log, calls), context: PRINCIPAL, authorize }, { signal });
    expect(result).toEqual({ ok: true, value: { status: 200, body: MARKERS, headers: { etag: '"rev-7"' } } });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, providerId: "plugin-vendor" }]);
    const bad = orderedLog();
    expect(await refusalOf(() => mediaDeleteProviderRoute.handle({ input: { providerId: "" }, deps: deleteDeps(bad.log), context: PRINCIPAL, authorize: bad.authorize })))
      .toEqual({ status: 400, body: { error: "Choose a media provider.", code: "MEDIA_PROVIDER_ID_INVALID" } });
    expect(bad.log).toEqual(["authorize:admin.integrations.manage"]);
  });

  it("answers the host's mapped refusals and rethrows the rest", async () => {
    const { authorize } = orderedLog();
    const failing = (error: Error): MediaDeleteProviderRouteDeps => ({ ...deleteDeps([]), removeProvider: async () => { throw error; } });
    const call = (deps: MediaDeleteProviderRouteDeps) => mediaDeleteProviderRoute.handle({ input: { providerId: "openai" }, deps, context: PRINCIPAL, authorize });
    expect(await refusalOf(() => call(failing(new HostValidationError("unknown provider"))))).toEqual({ status: 400, body: { error: "unknown provider", code: "TEST_VALIDATION" } });
    await expect(call(failing(new Error("vault gone")))).rejects.toThrow("vault gone");
  });
});

describe("one-row provider writes — admission", () => {
  it("PATCH and DELETE authorize before calling their credential ports", async () => {
    const patchRun = orderedLog();
    await mediaPatchProviderRoute.handle({ input: { providerId: "openai", body: { model: "m" } }, deps: patchDeps(patchRun.log), context: PRINCIPAL, authorize: patchRun.authorize });
    expect(patchRun.log).toEqual(["authorize:admin.integrations.manage", "patchProvider"]);
    const deleteRun = orderedLog();
    await mediaDeleteProviderRoute.handle({ input: { providerId: "openai" }, deps: deleteDeps(deleteRun.log), context: PRINCIPAL, authorize: deleteRun.authorize });
    expect(deleteRun.log).toEqual(["authorize:admin.integrations.manage", "removeProvider"]);

    const deniedPatch = orderedLog(["admin.integrations.manage"]);
    await expect(mediaPatchProviderRoute.handle({ input: { providerId: "openai", body: { model: "m" } }, deps: patchDeps(deniedPatch.log), context: PRINCIPAL, authorize: deniedPatch.authorize })).rejects.toThrow("denied");
    expect(deniedPatch.log).toEqual(["authorize:admin.integrations.manage"]);
    const deniedDelete = orderedLog(["admin.integrations.manage"]);
    await expect(mediaDeleteProviderRoute.handle({ input: { providerId: "openai" }, deps: deleteDeps(deniedDelete.log), context: PRINCIPAL, authorize: deniedDelete.authorize })).rejects.toThrow("denied");
    expect(deniedDelete.log).toEqual(["authorize:admin.integrations.manage"]);

    const unwired: string[] = [];
    await expect(mediaPatchProviderRoute.handle({ input: { providerId: "openai", body: { model: "m" } }, deps: patchDeps(unwired) })).rejects.toThrow(/no authorizer/);
    await expect(mediaDeleteProviderRoute.handle({ input: { providerId: "openai" }, deps: deleteDeps(unwired) })).rejects.toThrow(/no authorizer/);
    expect(unwired).toEqual([]);
  });
});
