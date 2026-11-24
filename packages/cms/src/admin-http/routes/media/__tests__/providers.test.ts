import { describe, expect, it } from "vitest";
import { mediaGetProvidersRoute } from "../get-providers.js";
import { mediaPutProvidersRoute, type MediaPutProvidersRouteDeps } from "../put-providers.js";
import { raw, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

class HostValidationError extends Error {}
class HostUnconfiguredError extends Error {}
/** Host-worded refusals: the copy below is a value no real host ships, so the test proves it was injected. */
const REFUSALS: MediaPutProvidersRouteDeps["saveErrorMappings"] = [
  { matches: ({ err }) => err instanceof HostValidationError, status: 400, code: "TEST_VALIDATION" },
  { matches: ({ err }) => err instanceof HostUnconfiguredError, status: 503, code: "TEST_UNCONFIGURED", error: "test store is off" },
];
const MAP = { openai: { configured: true, last4: "abcd" } };

describe("mediaGetProvidersRoute", () => {
  it("keeps the method, path, status and no body cap; parses nothing", () => {
    expect([mediaGetProvidersRoute.method, mediaGetProvidersRoute.path, mediaGetProvidersRoute.successStatus, mediaGetProvidersRoute.maxBodyBytes])
      .toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/media/providers", undefined, undefined]);
    expect(mediaGetProvidersRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes media.read with no entity id and answers the bare map", async () => {
    const { authorize, calls } = recordingAuthorize();
    const asked: unknown[] = [];
    const deps = { workspaceId: WORKSPACE_ID, getProviders: async (input: { workspaceId: string }) => { asked.push(input); return MAP; } };
    expect(await mediaGetProvidersRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: MAP });
    expect(calls).toEqual([{ permission: "media.read", entityType: "media" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID }]);
    let reads = 0;
    const counting = { workspaceId: WORKSPACE_ID, getProviders: async () => { reads += 1; return {}; } };
    await expect(mediaGetProvidersRoute.handle({ input: {}, deps: counting, authorize: recordingAuthorize(["media.read"]).authorize })).rejects.toThrow("denied");
    await expect(mediaGetProvidersRoute.handle({ input: {}, deps: counting })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
  });
});

describe("mediaPutProvidersRoute", () => {
  const putDeps = (save: MediaPutProvidersRouteDeps["saveProviders"]): MediaPutProvidersRouteDeps => ({ workspaceId: WORKSPACE_ID, saveProviders: save, saveErrorMappings: REFUSALS, outwardErrorMessage: ({ error }) => error.message });

  it("keeps the method, path, status and no body cap; a missing body is the empty set", () => {
    expect([mediaPutProvidersRoute.method, mediaPutProvidersRoute.path, mediaPutProvidersRoute.successStatus, mediaPutProvidersRoute.maxBodyBytes])
      .toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/media/providers", undefined, undefined]);
    expect(mediaPutProvidersRoute.parse(raw({}, { openai: { apiKey: "k" } }))).toEqual({ ok: true, value: { providers: { openai: { apiKey: "k" } } } });
    expect(mediaPutProvidersRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { providers: {} } });
    expect(mediaPutProvidersRoute.parse(raw({}, null))).toEqual({ ok: true, value: { providers: {} } });
  });

  it("authorizes admin.integrations.manage with no entity id, saves the whole set and answers the markers", async () => {
    const { authorize, calls } = recordingAuthorize();
    const saved: unknown[] = [];
    const deps = putDeps(async (input) => { saved.push(input); return MAP; });
    expect(await mediaPutProvidersRoute.handle({ input: { providers: { openai: { apiKey: "k" } } }, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: MAP });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "media" }]);
    expect(saved).toEqual([{ workspaceId: WORKSPACE_ID, providers: { openai: { apiKey: "k" } } }]);
  });

  it("answers the host's mapped refusals (own message or the host copy) and rethrows the rest", async () => {
    const { authorize } = recordingAuthorize();
    const failWith = (error: Error) => putDeps(async () => { throw error; });
    const call = (deps: MediaPutProvidersRouteDeps) => mediaPutProvidersRoute.handle({ input: { providers: {} }, deps, context: PRINCIPAL, authorize });
    expect(await refusalOf(() => call(failWith(new HostValidationError("unknown provider 'x'"))))).toEqual({ status: 400, body: { error: "unknown provider 'x'", code: "TEST_VALIDATION" } });
    expect(await refusalOf(() => call(failWith(new HostUnconfiguredError("private detail"))))).toEqual({ status: 503, body: { error: "test store is off", code: "TEST_UNCONFIGURED" } });
    await expect(call(failWith(new Error("vault gone")))).rejects.toThrow("vault gone");
    let saves = 0;
    await expect(mediaPutProvidersRoute.handle({ input: { providers: {} }, deps: putDeps(async () => { saves += 1; return {}; }), authorize: recordingAuthorize(["admin.integrations.manage"]).authorize })).rejects.toThrow("denied");
    expect(saves).toBe(0);
  });
});
