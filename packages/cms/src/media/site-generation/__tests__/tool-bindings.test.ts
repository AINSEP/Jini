import { expect, test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { bindMediaGenerationTools } from "../tool-registrations.js";

function fixture() {
  const saved = vi.fn(async () => ({ apiKey: "saved", baseUrl: null, model: null }));
  const env = vi.fn(() => ({ apiKey: "env" }));
  const generate = vi.fn(async () => ({ bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), providerId: "provider", usedStubFallback: false }));
  const binding = bindMediaGenerationTools({
    imageModelIds: ["metadata"], imageModelIdsFrom: () => ["live"], defaultModelId: "live", mediaAssetReadToolId: "content_read.media_asset",
    findModel: () => ({ provider: "provider" }), defaultGenerateMedia: generate,
    uploadMedia: vi.fn(async () => ({ media: { id: "asset", slug: "asset", source: { sha256: "hash" }, status: "active", version: 1 } })) as never,
    uploadCaps: { maxUploadBytes: 1024 }, credentialBindings: {} as never,
    getMediaProviderCredentials: vi.fn(async () => ({})), resolveMediaProviderCredential: saved,
    resolveProviderCredentialsFromEnv: env, readEnvironment: () => ({ KEY: "env" }), envVars: {}, aliases: {},
    buildNoCredentialError: () => ({ message: "configure credential" }), issueCredentialSetup: () => ({}) as never,
  });
  const deps = { workspaceId: "site", authorize: async () => ({ allowed: true, reason: "grant" }), mediaProviderRegistry: {},
    mediaContentTypeStore: { set: vi.fn() } } as unknown as Parameters<typeof binding.buildMediaGenerationRegistrations>[0];
  const resolvePublicUrls = vi.fn(async () => new Map([["asset", "/m/asset/"]]));
  const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "human" }, run: { id: "run" }, signal: new AbortController().signal, input: { prompt: "Picture", model: "live" } };
  return { binding, deps, resolvePublicUrls, ctx, saved, env, generate };
}

test("direct and contributor builds select the live catalog or the injected metadata fallback", () => {
  const f = fixture();
  expect(f.binding.buildMediaGenerationRegistrations(f.deps, f)[0]!.descriptor.inputSchema).toMatchObject({ properties: { model: { enum: ["live"] } } });
  expect(f.binding.contributeMediaGenerationTools(f).build(f.deps, {})[0]!.descriptor.inputSchema).toMatchObject({ properties: { model: { enum: ["live"] } } });
  expect(f.binding.buildMediaGenerationRegistrations({ ...f.deps, mediaProviderRegistry: undefined }, f)[0]!.descriptor.inputSchema).toMatchObject({ properties: { model: { enum: ["metadata"] } } });
});

test("saved keys win over environment keys and broken saved keys never fall back", async () => {
  const f = fixture();
  const [tool] = f.binding.buildMediaGenerationRegistrations(f.deps, f);
  await tool!.handler(f.ctx);
  expect(f.generate).toHaveBeenCalledWith(expect.objectContaining({ credentials: { apiKey: "saved" } }), { signal: f.ctx.signal });
  expect(f.env).not.toHaveBeenCalled();
  const broken = new Error("broken saved key");
  f.saved.mockRejectedValue(broken);
  await expect(tool!.handler(f.ctx)).rejects.toBe(broken);
  expect(f.env).not.toHaveBeenCalled();
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test("missing keys refuse generation unless the caller opts into a placeholder", async () => {
  const f = fixture();
  f.saved.mockResolvedValue(null as never);
  f.env.mockReturnValue({} as never);
  const [tool] = f.binding.buildMediaGenerationRegistrations(f.deps, f);
  expect(await tool!.handler(f.ctx)).toMatchObject({ generated: false, message: "configure credential" });
  expect(f.generate).not.toHaveBeenCalled();
  await tool!.handler({ ...f.ctx, input: { ...f.ctx.input as object, allowStubFallback: true } });
  expect(f.generate).toHaveBeenCalledWith(expect.objectContaining({ credentials: {}, options: expect.objectContaining({ allowStubFallback: true }) }), { signal: f.ctx.signal });
});
