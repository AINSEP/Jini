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
      workspaceId: "workspace", bytes, filename: "Draw-a-picture.png", contentType: "image/png", alt: undefined, caption: undefined, credit: undefined, description: undefined, createdByPrincipal: "agent", provenance: { kind: "generated" },
    } }, {});
    expect(deps.providers.generateImage).toHaveBeenCalledWith(expect.objectContaining({ allowStubFallback: true }), { signal: expect.any(AbortSignal) });
    expect(deps.storage.recordContentType).toHaveBeenCalledWith({ workspaceId: "workspace", sha256: "hash", contentType: "image/png" }, {});
    expect(deps.storage.upload.mock.invocationCallOrder[0]).toBeLessThan(deps.storage.recordContentType.mock.invocationCallOrder[0]!);
    expect(deps.storage.recordContentType.mock.invocationCallOrder[0]).toBeLessThan(deps.storage.resolvePublicUrls.mock.invocationCallOrder[0]!);
  });
});


it("an unknown saved-selection model does not hide the next eligible model", async () => {
  const { deps, catalogInput, ctx } = fixture();
  const registration = buildMediaGenerationRegistrations({ deps, catalogInput: { ...catalogInput, imageModelIds: ["missing", "plugin-first"] } })[0]!;
  deps.providers.readSavedSelections.mockResolvedValue({ plugin: { apiKeyConfigured: true, model: "plugin-first" } });
  expect(await registration.handler(ctx({ prompt: "Picture" }))).toMatchObject({ model: "plugin-first", provider: "actual-provider" });
});

it("omitted model tries the next configured provider, falling back only when no credential is usable", async () => {
  const { deps, registration, ctx } = fixture();
  deps.providers.readSavedCredential.mockImplementation(async ({ providerId }) => providerId === "other" ? { apiKey: "other-saved" } : null);
  deps.providers.readEnvCredential.mockReturnValue(null);
  const input = ctx({ prompt: "A garden" });
  expect(await registration.handler(input)).toMatchObject({ model: "plugin-second", provider: "actual-provider" });
  expect(deps.providers.generateImage.mock.calls).toEqual([[{
    model: "plugin-second", providerId: "other", credentials: { apiKey: "other-saved" },
    prompt: "A garden", allowStubFallback: false,
  }, { signal: input.signal }]]);
  deps.providers.readSavedCredential.mockResolvedValue(null);
  const unavailable = { generated: false as const, message: "Set up the fallback provider", credentialSetup: { setupToolId: "credential_save" } };
  deps.missingCredential.mockReturnValue(unavailable);
  expect(await registration.handler(input)).toEqual(unavailable);
  expect(deps.missingCredential.mock.calls).toEqual([[{ providerId: "plugin" }, {}]]);
  expect(deps.providers.generateImage.mock.calls).toHaveLength(1);
});

it("a provider already found without a key is not re-checked for its next model, and a symbol-only prompt gets the default filename", async () => {
  const { deps, catalogInput, ctx } = fixture();
  deps.findModel.mockImplementation(({ id }) => (id === "plugin-third" ? { provider: "other" } : { provider: "plugin" }));
  const registration = buildMediaGenerationRegistrations({ deps, catalogInput: { ...catalogInput, imageModelIds: ["plugin-first", "plugin-second", "plugin-third"] } })[0]!;
  deps.providers.readSavedCredential.mockImplementation(async ({ providerId }) => (providerId === "other" ? { apiKey: "other-saved" } : null));
  deps.providers.readEnvCredential.mockReturnValue(null);
  const tracker = { capture: vi.fn(async () => {}) };
  Object.assign(deps, { tracker });
  deps.storage.resolvePublicUrls.mockResolvedValue(new Map());
  expect(await registration.handler(ctx({ prompt: "!!! ???" }))).toMatchObject({ model: "plugin-third", media: { publicUrl: null } });
  // "plugin" is looked up once (for plugin-first), never again for plugin-second.
  expect(deps.providers.readSavedCredential.mock.calls.map(([input]) => input.providerId)).toEqual(["plugin", "other", "other"]);
  expect(deps.storage.upload.mock.calls[0]?.[0].input.filename).toBe("generated-image.png");
  expect(tracker.capture).toHaveBeenCalledWith({ name: "media_uploaded", userId: "agent" }, { properties: expect.objectContaining({ kind: "image", source: "assistant" }) });
});

it("a catalogued model id the registry cannot resolve is a named wiring fault, chosen or defaulted, before any dispatch", async () => {
  const { deps, catalogInput, ctx } = fixture();
  const registration = buildMediaGenerationRegistrations({ deps, catalogInput: { ...catalogInput, imageModelIds: ["missing", "plugin-first"] } })[0]!;
  for (const input of [{ prompt: "Picture" }, { prompt: "Picture", model: "missing" }]) {
    await expect(registration.handler(ctx(input))).rejects.toThrow("Media generation registry has no model missing");
  }
  expect(deps.providers.generateImage).not.toHaveBeenCalled();
  expect(deps.storage.upload).not.toHaveBeenCalled();
});
