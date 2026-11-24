import { describe, expect, it } from "vitest";
import type { ByokConfig } from "../visitor-credential-form-port.js";
import { TEST_PRESET_RULES } from "./fixtures/preset-rules.js";
import { TEST_PROVIDER_PRESETS as DEFAULT_PROVIDER_PRESETS } from "./fixtures/provider-presets.js";
import type { SiteAssistantCredential } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import {
  configuredPresetIds,
  connectionTestStateFromResult,
  defaultVisitorCredentialConfig,
  hasSavedVisitorCredential,
  hasStoredCredential,
  hydrateVisitorCredentialConfig,
  isPresetSuppliedEndpoint,
  visitorProviderGroups,
  withDiscoveredModel,
} from "../visitor-credential-form.rules.js";
import { visitorAssistantStatus, VISITOR_STATUS_COPY } from "../use-visitor-assistant-panel.hooks.js";

// Author Checklist: literal outcomes, real rules and provider library, no I/O or shared state.
// F4.3/F6.2: non-default providers distinguish protocol, endpoint and nullish fallback branches.
// Moved with the rules from the host's feature `rules.ts` tests; the catalog is injected as `presets`.
const presets = DEFAULT_PROVIDER_PRESETS;
/** The host's default preset (an owner default the host binds). */
const DEFAULT_VISITOR_PRESET_ID = "anthropic";

function config(overrides: Partial<ByokConfig> = {}): ByokConfig {
  return {
    protocol: "google", providerId: "google-gemini", apiKey: "typed-secret",
    baseUrl: "https://generativelanguage.googleapis.com", model: "current-model", ...overrides,
  };
}

function stored(overrides: Partial<SiteAssistantCredential> = {}): SiteAssistantCredential {
  return { isSet: true, masked: "••••abcd", provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "stored-model", updatedAt: null, ...overrides };
}

describe("stored credential presence", () => {
  it("requires the server's isSet flag, even when other metadata is present", () => {
    expect(hasStoredCredential({ stored: null })).toBe(false);
    expect(hasStoredCredential({ stored: stored({ isSet: false }) })).toBe(false);
    expect(hasStoredCredential({ stored: stored() })).toBe(true);
  });
});

describe("automatic discovery destination gate", () => {
  // BUG, F4.4/F6.2: Azure's empty URL placeholder is not a preset-supplied destination.
  // Clearing an endpoint must not authorize automatic credential-bearing discovery.
  it.each(["", " \t\n"])("rejects a missing destination %j", (url) => {
    expect(isPresetSuppliedEndpoint({ presets, baseUrl: url })).toBe(false);
  });

  // A startsWith comparison would transmit a key to a suffix host or changed path (F4.4).
  it.each([
    "https://api.anthropic.com", "https://api.openai.com/v1",
    "https://generativelanguage.googleapis.com", "https://openrouter.ai/api/v1",
    "http://localhost:11434/v1",
  ])("accepts the exact preset endpoint %s, including surrounding whitespace", (url) => {
    expect(isPresetSuppliedEndpoint({ presets, baseUrl: url })).toBe(true);
    expect(isPresetSuppliedEndpoint({ presets, baseUrl: ` \t${url}\n` })).toBe(true);
  });

  it.each([
    "https://api.anthropic.com.attacker.example", "https://api.openai.com/v1/other",
    "https://api.openai.com/v1/", "http://localhost:11435/v1",
    "https://api.openai.co", "https://custom.example/v1",
  ])("rejects an operator endpoint or incomplete hostname: %s", (url) => {
    expect(isPresetSuppliedEndpoint({ presets, baseUrl: url })).toBe(false);
  });
});

describe("configured provider chip identities", () => {
  // Returning all presets or reading the active key for every provider would fail (F1.3/F4.3).
  it("marks only complete provider-specific drafts, including keyless Ollama", () => {
    const draft = config({ model: "", savedByProviderId: {
      anthropic: { apiKey: "ant-key", baseUrl: "https://api.anthropic.com", model: "claude-model" },
      openai: { apiKey: "oai-key", baseUrl: "https://api.openai.com/v1", model: "openai-model" },
      openrouter: { apiKey: "router-key", baseUrl: "https://openrouter.ai/api/v1", model: "  " },
      ollama: { apiKey: "", baseUrl: "http://localhost:11434/v1", model: "local-model" },
    } });
    expect([...configuredPresetIds({ presets, config: draft, isProviderConfigured: TEST_PRESET_RULES.isProviderConfigured })].sort()).toEqual(["anthropic", "ollama", "openai"]);
    expect(draft.model).toBe("");
  });

  it("does not mark other providers from the current provider's credentials", () => {
    expect([...configuredPresetIds({ presets, config: config(), isProviderConfigured: TEST_PRESET_RULES.isProviderConfigured })]).toEqual(["google-gemini"]);
  });
});

describe("visitor credential hydration", () => {
  it.each([
    ["anthropic", "https://api.anthropic.com", "anthropic"],
    ["openai", "https://openrouter.ai/api/v1", "openrouter"],
    ["azure", "https://tenant.openai.azure.com", "azure-openai"],
    ["openai", "https://unlisted.example/v1", null],
  ] as const)("restores %s / %s with the correct preset identity", (protocol, baseUrl, providerId) => {
    const current = Object.freeze(config());
    expect(hydrateVisitorCredentialConfig({ presets, current, stored: stored({ provider: protocol, baseUrl }) })).toEqual({
      protocol, providerId, apiKey: "typed-secret", baseUrl, model: "stored-model",
    });
    expect(current.protocol).toBe("google");
    expect(current.model).toBe("current-model");
  });

  it("keeps the protocol and preset for an unknown server provider while hydrating its values", () => {
    expect(hydrateVisitorCredentialConfig({ presets, current: config({ protocol: "anthropic", providerId: "anthropic" }), stored: stored({ provider: "future-provider", baseUrl: "https://future.example", model: "future-model" }) }))
      .toEqual({ protocol: "anthropic", providerId: "anthropic", apiKey: "typed-secret", baseUrl: "https://future.example", model: "future-model" });
  });

  it("preserves current values for null stored fields but respects explicit empty strings", () => {
    expect(hydrateVisitorCredentialConfig({ presets, current: config({ baseUrl: "https://local.example/v1", model: "draft-model" }), stored: stored({ provider: "google", baseUrl: null, model: null }) }))
      .toEqual({ protocol: "google", providerId: null, apiKey: "typed-secret", baseUrl: "https://local.example/v1", model: "draft-model" });
    expect(hydrateVisitorCredentialConfig({ presets, current: config(), stored: stored({ provider: "google", baseUrl: "", model: "" }) }))
      .toEqual({ protocol: "google", providerId: null, apiKey: "typed-secret", baseUrl: "", model: "" });
  });
});

describe("defaultVisitorCredentialConfig", () => {
  it("starts on the default (Anthropic) preset with an empty key and model", () => {
    const anthropic = DEFAULT_PROVIDER_PRESETS.find((preset) => preset.id === DEFAULT_VISITOR_PRESET_ID)!;
    expect(defaultVisitorCredentialConfig({ presets, defaultPresetId: DEFAULT_VISITOR_PRESET_ID })).toEqual({
      protocol: anthropic.protocol, providerId: anthropic.id, apiKey: "", baseUrl: anthropic.baseUrl, model: "",
    });
  });

  it("falls back to the catalog's first preset when the default one is not in it", () => {
    const others = DEFAULT_PROVIDER_PRESETS.filter((preset) => preset.id !== DEFAULT_VISITOR_PRESET_ID);
    expect(defaultVisitorCredentialConfig({ presets: others, defaultPresetId: DEFAULT_VISITOR_PRESET_ID })).toMatchObject({ providerId: others[0]!.id, baseUrl: others[0]!.baseUrl });
  });
});

describe("saved-credential detection", () => {
  it("treats the server's empty default row as nothing saved, and any saved field as saved", () => {
    const empty = stored({ isSet: false, baseUrl: null, model: null, updatedAt: null });
    expect(hasSavedVisitorCredential(empty)).toBe(false);
    expect(hasSavedVisitorCredential({ ...empty, model: "m" })).toBe(true);
    expect(hasSavedVisitorCredential({ ...empty, updatedAt: "2026-01-01" })).toBe(true);
    // Nothing saved: hydration keeps the form's own default rather than the server's provider.
    const current = config();
    expect(hydrateVisitorCredentialConfig({ presets, current, stored: { ...empty, provider: "openai" } })).toBe(current);
  });
});

describe("provider select groups", () => {
  it("lists protocols then gateways, flagging only configured presets", () => {
    const groups = visitorProviderGroups({ configuredIds: new Set(["anthropic", "openrouter"]), presets, groupPresets: TEST_PRESET_RULES.groupPresets });
    expect(groups.map((g) => g.label)).toEqual(["Protocols", "Gateways"]);
    const flagged = groups.flatMap((g) => g.options.filter((o) => o.configured).map((o) => o.preset.id)).sort();
    expect(flagged).toEqual(["anthropic", "openrouter"]);
    expect(groups.flatMap((g) => g.options).length).toBe(presets.length);
  });
});

describe("discovered-model seeding", () => {
  it("prefers the host's preferred model, else the first, and never overwrites an entered model", () => {
    const empty = config({ model: "" });
    expect(withDiscoveredModel({ current: empty, models: ["a", "pref"], preferredModel: "pref" }).model).toBe("pref");
    expect(withDiscoveredModel({ current: empty, models: ["a", "b"], preferredModel: "pref" }).model).toBe("a");
    expect(withDiscoveredModel({ current: empty, models: [], preferredModel: "pref" })).toBe(empty);
    const chosen = config({ model: "mine" });
    expect(withDiscoveredModel({ current: chosen, models: ["pref"], preferredModel: "pref" })).toBe(chosen);
  });
});

describe("connection test result", () => {
  it("maps missing, ok and failed results", () => {
    expect(connectionTestStateFromResult({ result: undefined })).toEqual({ status: "error", message: "Connection test failed" });
    expect(connectionTestStateFromResult({ result: { ok: true, message: "fine" } })).toEqual({ status: "ok", message: "fine" });
    expect(connectionTestStateFromResult({ result: { ok: false, message: "" } })).toEqual({ status: "error", message: "Connection test failed" });
    expect(connectionTestStateFromResult({ result: { ok: false, message: "nope" } })).toEqual({ status: "error", message: "nope" });
  });
});

describe("visitor status pill", () => {
  it("needs a key wins over the switch; the switch can always turn off", () => {
    expect(visitorAssistantStatus({ publicEnabled: true, hasStoredKey: false })).toEqual({ status: "needs-key", canEnable: true });
    expect(visitorAssistantStatus({ publicEnabled: false, hasStoredKey: false })).toEqual({ status: "needs-key", canEnable: false });
    expect(visitorAssistantStatus({ publicEnabled: true, hasStoredKey: true })).toEqual({ status: "on", canEnable: true });
    expect(visitorAssistantStatus({ publicEnabled: false, hasStoredKey: true })).toEqual({ status: "off", canEnable: true });
    expect(VISITOR_STATUS_COPY["needs-key"].label).toBe("Needs a key");
  });
});
