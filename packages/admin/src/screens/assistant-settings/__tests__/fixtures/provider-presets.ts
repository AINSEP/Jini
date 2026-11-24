import type { ProviderPreset } from "../../visitor-credential-form-port.js";

/**
 * A host-shaped provider catalog for these tests — the same six presets (ids, protocols, kinds and
 * endpoints) a host binds as `presets`. The engine ships no catalog of its own; the real one is the
 * host's, so the rules under test take it as an argument.
 */
export const TEST_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "anthropic", title: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com", preferredModels: [], kind: "protocol", apiKeyPrefix: "sk-ant-" },
  { id: "openai", title: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", preferredModels: [], kind: "protocol", apiKeyPrefix: "sk-" },
  { id: "azure-openai", title: "Azure OpenAI", protocol: "azure", baseUrl: "", preferredModels: [], kind: "protocol" },
  { id: "google-gemini", title: "Google Gemini", protocol: "google", baseUrl: "https://generativelanguage.googleapis.com", preferredModels: [], kind: "protocol", apiKeyPrefix: "AIza" },
  { id: "openrouter", title: "OpenRouter", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1", preferredModels: [], kind: "gateway", apiKeyPrefix: "sk-or-" },
  { id: "ollama", title: "Ollama", protocol: "openai", baseUrl: "http://localhost:11434/v1", preferredModels: [], kind: "gateway", requiresApiKey: false },
];
