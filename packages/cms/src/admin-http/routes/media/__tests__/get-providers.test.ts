import { describe, expect, it } from "vitest";
import { mediaGetProvidersRoute } from "../get-providers.js";
import { PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

describe("mediaGetProvidersRoute", () => {
  it("keeps the method and path and parses to an empty input", () => {
    expect(mediaGetProvidersRoute.method).toBe("get");
    expect(mediaGetProvidersRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/providers");
    expect(mediaGetProvidersRoute.parse(raw({ workspaceId: WORKSPACE_ID }))).toEqual({ ok: true, value: {} });
  });

  it("authorizes media.read id-free, then answers the bare provider map for this workspace", async () => {
    const { authorize, calls } = recordingAuthorize();
    const reads: unknown[] = [];
    const providers = { openai: { apiKeyConfigured: true, apiKeyTail: "abcd" } };
    const deps = { workspaceId: WORKSPACE_ID, getMediaProviderCredentials: async (input: { workspaceId: string }) => { reads.push(input); return providers; } };
    const result = await mediaGetProvidersRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "media.read", entityType: "media" }]);
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: providers });
  });

  it("answers an empty map as-is, distinct from an unreachable store", async () => {
    const { authorize } = recordingAuthorize();
    const deps = { workspaceId: WORKSPACE_ID, getMediaProviderCredentials: async () => ({}) };
    expect(await mediaGetProvidersRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: {} });
  });

  it("does not read credentials when authorization refuses", async () => {
    let reads = 0;
    const deps = { workspaceId: WORKSPACE_ID, getMediaProviderCredentials: async () => { reads += 1; return {}; } };
    await expect(mediaGetProvidersRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(reads).toBe(0);
  });
});
