// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionPort } from "@jini-ai/ui/core";
import type { SiteAssistantCredential, SiteAssistantCredentialPatch } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { useVisitorCredentialForm } from "../use-visitor-credential-form.hooks.js";
import type { VisitorCredentialFormDependencies, VisitorCredentialFormPort } from "../visitor-credential-form-port.js";
import { TEST_PROVIDER_PRESETS } from "./fixtures/provider-presets.js";

// The host's characterization suite drives the same hook through its real wiring; these cover the
// engine seam with fakes: hydration, credential selection and the submission resets.
function credential(overrides: Partial<SiteAssistantCredential> = {}): SiteAssistantCredential {
  return { isSet: false, masked: null, provider: "anthropic", baseUrl: null, model: null, updatedAt: null, ...overrides };
}

function fakePort(initial = credential()) {
  let current = initial;
  const writes: SiteAssistantCredentialPatch[] = [];
  const port: VisitorCredentialFormPort = {
    getAssistantSiteCredential: async () => ({ data: current }),
    setAssistantSiteCredential: async (patch) => {
      writes.push(patch);
      current = { ...current, ...(patch.apiKey ? { isSet: true } : {}), updatedAt: "now" };
      return { data: current };
    },
  };
  return { port, writes };
}

function deps(port: VisitorCredentialFormPort, overrides: Partial<VisitorCredentialFormDependencies> = {}): VisitorCredentialFormDependencies {
  const executionPort: ExecutionPort = { testConnection: async () => ({ ok: true }), listModels: async () => ["m1"] } as unknown as ExecutionPort;
  return {
    port,
    presets: TEST_PROVIDER_PRESETS,
    defaultPresetId: "anthropic",
    preferredModel: "preferred",
    createExecutionPort: () => executionPort,
    rules: {
      describeApiError: ({ e, fallback }) => (e instanceof Error ? `api:${e.message}` : fallback),
      describeProbeError: ({ e, fallback }) => (e instanceof Error ? e.message : fallback),
      storedKeyIsForOtherEndpoint: () => false,
      hasUsableKey: ({ apiKey, stored }) => Boolean(apiKey.trim()) || stored?.isSet === true,
      storedKeyBlocksProbe: () => false,
    },
    ...overrides,
  };
}

async function mount(d: VisitorCredentialFormDependencies) {
  const hook = renderHook(() => useVisitorCredentialForm(d));
  await waitFor(() => expect(hook.result.current.loadState.status).toBe("ready"));
  return hook;
}

describe("useVisitorCredentialForm (engine seam)", () => {
  it("starts on the host's default preset and hydrates from the injected port", async () => {
    const { port } = fakePort(credential({ isSet: true, provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "m" }));
    const { result } = await mount(deps(port, { rules: { ...deps(port).rules, storedKeyIsForOtherEndpoint: () => true } }));
    expect(result.current.config).toMatchObject({ protocol: "openai", providerId: "openrouter", model: "m" });
    expect(result.current.hasStoredKey).toBe(true);
    expect(result.current.storedKeyIsForOtherEndpoint).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("reports the host's load-error copy", async () => {
    const port: VisitorCredentialFormPort = { getAssistantSiteCredential: () => Promise.reject(new Error("down")), setAssistantSiteCredential: vi.fn() };
    const { result } = renderHook(() => useVisitorCredentialForm(deps(port)));
    await waitFor(() => expect(result.current.loadState).toEqual({ status: "error", message: "api:down" }));
  });

  it("selects a preset by id from the host catalog, marks dirty, resets probes; unknown ids are ignored", async () => {
    const { port } = fakePort();
    const { result } = await mount(deps(port));
    await act(async () => { await result.current.runTestConnection(); });
    expect(result.current.connectionTest.status).toBe("ok");
    act(() => result.current.selectPresetById({ presetId: "google-gemini" }));
    expect(result.current.config).toMatchObject({ providerId: "google-gemini", baseUrl: "https://generativelanguage.googleapis.com" });
    expect(result.current.preset?.id).toBe("google-gemini");
    expect(result.current.connectionTest).toEqual({ status: "idle" });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.selectPresetById({ presetId: "no-such-preset" }));
    expect(result.current.config.providerId).toBe("google-gemini");
  });

  it("Save key sends the key alone and clears the field; Save settings clears dirty", async () => {
    const { port, writes } = fakePort();
    const { result } = await mount(deps(port, { createExecutionPort: () => ({}) as ExecutionPort }));
    act(() => result.current.editConfig({ ...result.current.config, apiKey: " sk-typed ", model: "chosen" }));
    await act(async () => { await result.current.saveKey(); });
    expect(writes[0]).toEqual({ apiKey: "sk-typed" });
    expect(result.current.config.apiKey).toBe("");
    expect(result.current.saveState).toEqual({ status: "saved", at: "now" });
    expect(result.current.dirty).toBe(true);
    await act(async () => { await result.current.saveSettings(); });
    expect(writes[1]).toEqual({ provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "chosen" });
    expect(result.current.dirty).toBe(false);
    expect(result.current.settingsSaveState).toEqual({ status: "saved", at: "now" });
  });

  it("Test Key seeds the empty model with the host's preferred model", async () => {
    const { port } = fakePort();
    const executionPort = { listModels: async () => ["a", "preferred"] } as unknown as ExecutionPort;
    const { result } = await mount(deps(port, { createExecutionPort: () => executionPort }));
    await act(async () => { await result.current.runKeyTest(); });
    expect(result.current.discovery).toEqual({ status: "ok", models: ["a", "preferred"] });
    expect(result.current.config.model).toBe("preferred");
  });
});
