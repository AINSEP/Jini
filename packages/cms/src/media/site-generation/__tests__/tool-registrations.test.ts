import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";
import { buildMediaGenerationRegistrations, type MediaGenerationToolDeps } from "../tool-registrations.js";

const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const media: MediaRecord = {
  id: "asset", workspaceId: "workspace", slug: "picture", title: "Picture", alt: "", caption: "", credit: "",
  source: { sha256: "hash" }, status: "active", version: 1, createdAt: "2026-11-25T00:00:00Z",
  updatedAt: "2026-11-25T00:00:00Z", width: null, height: null, cssClass: null, htmlAttributes: null,
};
function fixture() {
  const deps = {
    workspaceId: "workspace", authorize: vi.fn(async () => ({ allowed: true, reason: "granted" })),
    storage: {
      upload: vi.fn(async () => ({ media })), recordContentType: vi.fn(async () => {}),
      resolvePublicUrls: vi.fn(async () => new Map([[media.id, "https://public.example/picture"]])),
    },
    providers: {
      readSavedSelections: vi.fn<MediaGenerationToolDeps["providers"]["readSavedSelections"]>(async () => ({})),
      readSavedCredential: vi.fn<MediaGenerationToolDeps["providers"]["readSavedCredential"]>(async () => ({ apiKey: "saved-key" })),
      readEnvCredential: vi.fn<MediaGenerationToolDeps["providers"]["readEnvCredential"]>(() => ({ apiKey: "env-key" })),
      generateImage: vi.fn<MediaGenerationToolDeps["providers"]["generateImage"]>(async () => ({ bytes, providerId: "actual-provider", usedStubFallback: false })),
    },
    findModel: vi.fn(({ id }: { id: string }) => id === "plugin-first" ? { provider: "plugin" } : id === "plugin-second" ? { provider: "other" } : undefined),
    missingCredential: vi.fn<MediaGenerationToolDeps["missingCredential"]>(),
  } satisfies MediaGenerationToolDeps;
  const catalogInput = { imageModelIds: ["plugin-first", "plugin-second"], defaultModelId: "plugin-first", mediaAssetReadToolId: "read_asset" };
  const registration = buildMediaGenerationRegistrations({ deps, catalogInput })[0]!;
  const controller = new AbortController();
  const ctx = (input: unknown): ToolExecutionContext => ({ input, executionId: "execution", principal: { id: "agent" }, run: { id: "run" }, signal: controller.signal });
  return { deps, catalogInput, registration, controller, ctx };
}

describe("media generation execution", () => {
  it("saved credential errors never reach env or dispatch", async () => {
    for (const input of [{ prompt: "Picture", model: "plugin-first" }, { prompt: "Picture" }]) {
      const { deps, registration, ctx } = fixture();
      const failure = new Error("saved credential cannot be opened");
      deps.providers.readSavedCredential.mockRejectedValue(failure);
      await expect(registration.handler(ctx(input))).rejects.toBe(failure);
      expect(deps.providers.readSavedCredential).toHaveBeenCalledOnce();
      expect(deps.providers.readEnvCredential).not.toHaveBeenCalled();
      expect(deps.providers.generateImage).not.toHaveBeenCalled();
      expect(deps.storage.upload).not.toHaveBeenCalled();
    }
  });

  it("explicit validation and the published enum use one ordered catalog", async () => {
    const { deps, catalogInput, registration, ctx } = fixture();
    expect(registration.descriptor.inputSchema).toMatchObject({ properties: { model: { enum: ["plugin-first", "plugin-second"] } } });
    await expect(registration.handler(ctx({ prompt: "Picture", model: "gpt-image-2" }))).rejects.toThrow(/registered image model/);
    expect(deps.providers.readSavedSelections).not.toHaveBeenCalled();
    expect(deps.providers.readSavedCredential).not.toHaveBeenCalled();
    expect(deps.providers.readEnvCredential).not.toHaveBeenCalled();
    expect(deps.providers.generateImage).not.toHaveBeenCalled();
    for (const model of catalogInput.imageModelIds) {
      expect(await registration.handler(ctx({ prompt: "Picture", model }))).toMatchObject({ model, provider: "actual-provider", media: { placeholder: false } });
    }
    expect(deps.providers.generateImage).toHaveBeenNthCalledWith(1, { model: "plugin-first", prompt: "Picture", providerId: "plugin", credentials: { apiKey: "saved-key" }, allowStubFallback: false }, { signal: expect.any(AbortSignal) });
    expect(deps.providers.generateImage).toHaveBeenNthCalledWith(2, { model: "plugin-second", prompt: "Picture", providerId: "other", credentials: { apiKey: "saved-key" }, allowStubFallback: false }, { signal: expect.any(AbortSignal) });
    expect(deps.authorize.mock.invocationCallOrder[0]).toBeLessThan(deps.providers.readSavedCredential.mock.invocationCallOrder[0]!);
    expect(deps.providers.readSavedSelections).not.toHaveBeenCalled();
  });

  it("a late generator result after Stop never writes", async () => {
    const { deps, registration, controller, ctx } = fixture();
    let resolve!: (value: { bytes: Uint8Array; providerId: string; usedStubFallback: boolean }) => void;
    let started!: () => void;
    const dispatched = new Promise<void>(done => { started = done; });
    deps.providers.generateImage.mockImplementation(() => { started(); return new Promise(done => { resolve = done; }); });
    const result = registration.handler(ctx({ prompt: "Picture", model: "plugin-first" }));
    await dispatched;
    const rejected = expect(result).rejects.toThrow();
    controller.abort();
    resolve({ bytes, providerId: "actual-provider", usedStubFallback: false });
    await rejected;
    expect(deps.providers.generateImage).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
    expect(deps.storage.upload).not.toHaveBeenCalled();
    expect(deps.storage.recordContentType).not.toHaveBeenCalled();
    expect(deps.storage.resolvePublicUrls).not.toHaveBeenCalled();
  });

  it("stub provenance credits no model or provider", async () => {
    const { deps, registration, ctx } = fixture();
    deps.providers.generateImage.mockResolvedValue({ bytes, providerId: "stub-provider", usedStubFallback: true });
    expect(await registration.handler(ctx({ prompt: "Draw a picture!", model: "plugin-first", allowStubFallback: true }))).toMatchObject({ model: "plugin-first", provider: "stub-provider", media: { placeholder: true, createdBy: null } });
    expect(deps.storage.upload).toHaveBeenCalledWith({ input: {
      workspaceId: "workspace", bytes, filename: "Draw-a-picture.png", contentType: "image/png", createdByPrincipal: "agent", provenance: { kind: "generated" },
    } }, {});
    expect(deps.providers.generateImage).toHaveBeenCalledWith(expect.objectContaining({ allowStubFallback: true }), { signal: expect.any(AbortSignal) });
    expect(deps.storage.recordContentType).toHaveBeenCalledWith({ workspaceId: "workspace", sha256: "hash", contentType: "image/png" }, {});
    expect(deps.storage.upload.mock.invocationCallOrder[0]).toBeLessThan(deps.storage.recordContentType.mock.invocationCallOrder[0]!);
    expect(deps.storage.recordContentType.mock.invocationCallOrder[0]).toBeLessThan(deps.storage.resolvePublicUrls.mock.invocationCallOrder[0]!);
  });
});
