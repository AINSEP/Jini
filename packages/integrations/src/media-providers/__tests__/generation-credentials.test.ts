import { expect, it, vi } from "vitest";
import { resolveCredentialForProvider, resolveDefaultImageModel } from "../generation-credentials.js";
import { projectMediaProviderCatalog, type MediaProviderCatalogSource } from "../catalog-projection.js";

it("chooses the first eligible model in the existing catalog order", async () => {
  const readSavedCredential = vi.fn(async ({ providerId }: { providerId: string }) => providerId === "second" ? { apiKey: "saved" } : null);
  const model = await resolveDefaultImageModel({ imageModelIds: ["first", "second", "third"], defaultModelId: "fallback", routeDeps: {
    workspaceId: "w", findModel: ({ id }) => ({ provider: id }), providers: { readSavedSelections: async () => ({}), readSavedCredential, readEnvCredential: () => ({}) },
  } });
  expect(model).toBe("second");
  expect(readSavedCredential.mock.calls.map(([input]) => input.providerId)).toEqual(["first", "second"]);
});

it("a valid saved key wins before the environment is read", async () => {
  const readEnvCredential = vi.fn(() => ({ apiKey: "environment" }));
  expect(await resolveCredentialForProvider({ providerId: "provider", routeDeps: { workspaceId: "w", providers: {
    readSavedCredential: async () => ({ apiKey: "saved", baseUrl: "https://saved.example" }), readEnvCredential,
  } } })).toEqual({ apiKey: "saved", baseUrl: "https://saved.example" });
  expect(readEnvCredential).not.toHaveBeenCalled();
});

it("collapses duplicate aliases and omits credential-bearing default URLs", () => {
  const registry = { providers: { list: () => [
    { provider: { provider: { id: "legacy", label: "Provider", defaultBaseUrl: "https://example.test?token=secret" }, models: [{ id: "model" }, { id: "model" }] } },
    { provider: { provider: { id: "canonical", label: "Duplicate" }, models: [] } },
  ] } } as unknown as MediaProviderCatalogSource;
  expect(projectMediaProviderCatalog({ registry, aliases: { legacy: "canonical" } })).toEqual([{ id: "canonical", label: "Provider", models: ["model"] }]);
});
