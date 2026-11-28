import { expect, it, vi } from "vitest";
import { resolveCredentialForProvider, resolveDefaultImageModel } from "../generation-credentials.js";

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

it("rejects a catalog id the registry cannot resolve without consulting arbitrary credentials", async () => {
  const readSavedCredential = vi.fn(async () => null);
  const readEnvCredential = vi.fn(() => ({}));
  await expect(resolveDefaultImageModel({ imageModelIds: ["vanished-model"], defaultModelId: "fallback", routeDeps: {
    workspaceId: "w", findModel: () => undefined, providers: { readSavedSelections: async () => ({}), readSavedCredential, readEnvCredential },
  } })).rejects.toThrow("Media generation registry has no model vanished-model");
  expect(readSavedCredential.mock.calls).toEqual([]);
  expect(readEnvCredential.mock.calls).toEqual([]);
});

it("prefers a configured saved model, otherwise checks each provider once and uses the explicit fallback", async () => {
  const readSavedCredential = vi.fn(async (_input: { workspaceId: string; providerId: string }, _options?: Record<string, never>) => null);
  const readEnvCredential = vi.fn((_input: { providerId: string }, _options?: Record<string, never>) => ({}));
  const providers = { readSavedSelections: async () => ({ studio: { apiKeyConfigured: true, model: "studio-v2" } }), readSavedCredential, readEnvCredential };
  const routeDeps = { workspaceId: "w", findModel: ({ id }: { id: string }) => ({ provider: id.startsWith("studio-") ? "studio" : "other" }), providers };
  const input = { routeDeps, imageModelIds: ["other-v1", "studio-v1", "studio-v2"], defaultModelId: "fallback" };
  expect(await resolveDefaultImageModel(input)).toBe("studio-v2");
  expect(readSavedCredential.mock.calls).toEqual([]);
  expect(await resolveDefaultImageModel({ ...input, routeDeps: { ...routeDeps, providers: { ...providers, readSavedSelections: async () => ({}) } } })).toBe("fallback");
  expect(readSavedCredential.mock.calls).toEqual([[{ workspaceId: "w", providerId: "other" }, {}], [{ workspaceId: "w", providerId: "studio" }, {}]]);
  expect(readEnvCredential.mock.calls).toEqual([[{ providerId: "other" }, {}], [{ providerId: "studio" }, {}]]);
});

it("falls back to an environment key only when no row is saved, and returns null when the environment has none", async () => {
  const readSavedCredential = vi.fn(async (_input: { workspaceId: string; providerId: string }, _options?: Record<string, never>) => null);
  const environment: Record<string, { apiKey?: string; baseUrl?: string }> = { keyed: { apiKey: "env-key", baseUrl: "https://env.example" }, bare: {} };
  const readEnvCredential = vi.fn(({ providerId }: { providerId: string }, _options?: Record<string, never>) => environment[providerId] ?? {});
  const routeDeps = { workspaceId: "w", providers: { readSavedCredential, readEnvCredential } };
  expect(await resolveCredentialForProvider({ providerId: "keyed", routeDeps })).toEqual({ apiKey: "env-key", baseUrl: "https://env.example" });
  expect(await resolveCredentialForProvider({ providerId: "bare", routeDeps })).toBeNull();
  expect(readSavedCredential.mock.calls).toEqual([[{ workspaceId: "w", providerId: "keyed" }, {}], [{ workspaceId: "w", providerId: "bare" }, {}]]);
  expect(readEnvCredential.mock.calls).toEqual([[{ providerId: "keyed" }, {}], [{ providerId: "bare" }, {}]]);
});

it("a saved key without a base URL is returned without one", async () => {
  expect(await resolveCredentialForProvider({ providerId: "provider", routeDeps: { workspaceId: "w", providers: {
    readSavedCredential: async () => ({ apiKey: "saved", baseUrl: "" }), readEnvCredential: () => ({ apiKey: "environment" }),
  } } })).toStrictEqual({ apiKey: "saved" });
});
