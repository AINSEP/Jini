import { groupPresets, isProviderConfigured, type ApiProtocol, type ByokConfig, type ConnectionTestState, type ProviderPreset } from "@jini-ai/ui/core";
import type { SiteAssistantCredential } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import type { VisitorProviderGroup } from "./visitor-credential-form-port.js";

/**
 * @file Pure logic for the visitor credential form — everything that computes a value rather than
 * rendering one. Several of these were plain `const`s or inline expressions inside
 * `VisitorCredentialForm`'s body — reachable only by rendering the whole tab and driving state
 * through it — and are exported so each can be asserted directly. The provider catalog is the
 * host's, so every rule that reads it takes `presets`.
 */

/** Whether the server currently has a credential stored for this site — the "leave the stored key
 *  alone" case `saveVisitorSettings` relies on when it writes a patch with no `apiKey`.
 *
 * @complexity Time/space: O(1).
 * @overallScore 100
 */
export function hasStoredCredential({ stored }: { stored: SiteAssistantCredential | null }, _optional = {}): boolean {
  return stored?.isSet === true;
}

/**
 * SECURITY GATE on automatic discovery — `true` only when the endpoint is one a PRESET supplied,
 * never one the operator typed.
 *
 * This closes a confirmed credential-transmission bug rather than avoiding a hypothetical one. See
 * `ADS-memory/reports/findings/2026-08-04-byok-discovery-keystroke-key-leak.md`: Jini's
 * `ExecutionTab` lists `config.byok.baseUrl` as a discovery dependency and passes the whole
 * `ByokConfig` — which carries `apiKey` — with no debounce. Consequence, measured live by another
 * session: with a key already present, typing an endpoint transmits that live key to every
 * intermediate prefix of the hostname. `https://api.example.com` sends it to `https://a`,
 * `https://ap`, `https://api`, and so on — each prefix that resolves is a third party receiving a
 * credential the operator never meant to give it. It composes badly with the SSRF guard's
 * deliberate allowance of loopback on any port, which turns a typed `http://localhost:NNNN` into a
 * key-bearing walk of local ports.
 *
 * A debounce alone does NOT fix this, which is why this gate exists in addition to one: debouncing
 * cuts ~30 requests to a handful, but any pause mid-typing still fires, and a pause mid-typing is
 * exactly when the URL is a partial hostname. The number of unintended recipients goes down; it
 * does not go to zero.
 *
 * So the rule here is about the DESTINATION, not the timing: auto-discovery may only ever send the
 * key somewhere a preset already vouched for. A custom or hand-typed endpoint still works — it just
 * requires the operator to press "Test connection", which is an explicit, deliberate act of
 * pointing a credential at a host they chose. That is the "gate the effect on a committed baseUrl"
 * option the finding lists, tightened to "committed by an explicit action".
 *
 * @complexity Time: O(p) in the number of provider presets (a small, fixed constant); space: O(1).
 * @overallScore 100
 */
export function isPresetSuppliedEndpoint({ baseUrl, presets }: { baseUrl: string; presets: readonly ProviderPreset[] }, _optional = {}): boolean {
  const trimmed = baseUrl.trim();
  // Azure OpenAI's preset ships `baseUrl: ''` as a placeholder, so without this guard a cleared
  // field "matches" it and authorizes key-bearing discovery with no destination at all (F4.4/F6.2).
  if (trimmed === "") return false;
  return presets.some((p) => !p.custom && p.baseUrl === trimmed);
}

/** Which provider presets this form's current credentials already satisfy — the filled/unfilled
 *  dot each `ProviderChipGroup` chip renders. Reads the per-provider drafts, so a chip's filled dot
 *  means "this provider has complete credentials in this form", not "this one is saved on the
 *  server"; only the save line under the key field makes the second claim.
 *
 * @complexity Time: O(p) in the number of provider presets; space: O(k) for the k configured ids.
 * @overallScore 100
 */
export function configuredPresetIds({ config, presets }: { config: ByokConfig; presets: readonly ProviderPreset[] }, _optional = {}): Set<string> {
  return new Set(presets.filter((p) => isProviderConfigured({ config, preset: p })).map((p) => p.id));
}

/**
 * The form's config after hydration from the server's stored view — `protocol`/`providerId` as well as
 * `baseUrl`/`model`.
 *
 * `saveVisitorSettings` writes `provider: config.protocol`, so a hydration that skipped the provider
 * left an Anthropic (or any non-Google) credential under the form's Google default, and the next
 * model-only "Save settings" relabelled the stored row Google. The server keeps no preset id, so
 * `providerId` is recovered from the endpoint: the preset whose protocol and base URL both match, else
 * the preset of that protocol whose URL the operator supplies (Azure), else `null` — the custom
 * endpoint, which is what an endpoint no preset owns is. A `provider` string that is not a protocol
 * this form knows leaves protocol and preset as they were rather than guessing.
 *
 * @complexity Time: O(p) in the number of provider presets; space: O(1).
 */
export function hydrateVisitorCredentialConfig(
  { current, stored, presets }: { current: ByokConfig; stored: SiteAssistantCredential; presets: readonly ProviderPreset[] },
  _optional: Record<string, never> = {},
): ByokConfig {
  // Nothing saved yet: the server still answers with its own default `provider`, which would
  // override the form's Anthropic default with a provider the operator never chose (2026-10-09).
  if (!hasSavedVisitorCredential(stored)) return current;
  const baseUrl = stored.baseUrl ?? current.baseUrl;
  const model = stored.model ?? current.model;
  const protocol = knownProtocol({ provider: stored.provider, presets });
  if (protocol === null) return { ...current, baseUrl, model };
  const candidates = presets.filter((p) => !p.custom && p.protocol === protocol);
  const preset = candidates.find((p) => p.baseUrl === baseUrl) ?? candidates.find((p) => p.baseUrl === "");
  return { ...current, protocol, providerId: preset?.id ?? null, baseUrl, model };
}

/** `provider` as an {@link ApiProtocol} when some preset speaks it, else `null`.
 *  @complexity Time: O(p) in the number of provider presets; space: O(1). */
function knownProtocol({ provider, presets }: { provider: string; presets: readonly ProviderPreset[] }, _optional = {}): ApiProtocol | null {
  return presets.find((p) => p.protocol === provider)?.protocol ?? null;
}

/**
 * The form's starting config: the default preset's protocol and endpoint, an empty key and an empty
 * model. The model stays empty on purpose: the model list is a property of the key, so it waits
 * for one (see the hook's `discovery`). Hydration replaces this when something is saved.
 *
 * @complexity Time: O(p) in the number of provider presets; space: O(1).
 */
export function defaultVisitorCredentialConfig(
  { presets, defaultPresetId }: { presets: readonly ProviderPreset[]; defaultPresetId: string },
  _optional: Record<string, never> = {},
): ByokConfig {
  const preset = presets.find((p) => p.id === defaultPresetId) ?? (presets[0] as ProviderPreset);
  return { protocol: preset.protocol, providerId: preset.id, apiKey: "", baseUrl: preset.baseUrl, model: "" };
}

/** True once the server holds anything for this site: a key, or saved provider settings. A row with
 *  none of these is the server's empty default, not the operator's choice.
 *  @complexity Time/space: O(1). */
export function hasSavedVisitorCredential(stored: SiteAssistantCredential): boolean {
  return stored.isSet === true || stored.baseUrl !== null || stored.model !== null || stored.updatedAt !== null;
}

/**
 * The Provider select's two optgroups, protocols then gateways (`groupPresets`' order), each option
 * flagged when this form already holds complete credentials for it (the old chips' filled dot).
 *
 * @complexity Time: O(p) in the number of provider presets; space: O(p).
 */
export function visitorProviderGroups(
  { configuredIds, presets }: { configuredIds: ReadonlySet<string>; presets: readonly ProviderPreset[] },
  _optional: Record<string, never> = {},
): VisitorProviderGroup[] {
  const { protocols, gateways } = groupPresets({ presets: [...presets] });
  const toOptions = (group: readonly ProviderPreset[]) => group.map((preset) => ({ preset, configured: configuredIds.has(preset.id) }));
  return [
    { label: "Protocols", options: toOptions(protocols) },
    { label: "Gateways", options: toOptions(gateways) },
  ];
}

/** Seeds an empty model field from the discovered list: the server's own default when the key
 *  offers it, else the first entry. A model already entered, or an empty list, changes nothing. */
export function withDiscoveredModel(
  { current, models, preferredModel }: { current: ByokConfig; models: readonly string[]; preferredModel: string },
  _optional: Record<string, never> = {},
): ByokConfig {
  if (current.model.trim() || models.length === 0) return current;
  return { ...current, model: models.find((m) => m === preferredModel) ?? (models[0] as string) };
}

/** {@link withDiscoveredModel} as a `setConfig` updater. */
export function seedDiscoveredModel(
  { models, preferredModel }: { models: readonly string[]; preferredModel: string },
  _optional: Record<string, never> = {},
): (current: ByokConfig) => ByokConfig {
  return (current) => withDiscoveredModel({ current, models, preferredModel });
}

/** Turns the port's raw `testConnection` result into the screen's `ConnectionTestState` — pulled
 *  out of `runVisitorTestConnection` per the complexity-pass extraction rule. This was an
 *  inline optional-chain/`||`/ternary cluster that put the parent at 10/5 — over the ceiling on
 *  cyclomatic alone once it tightened to ≤9/≤9 mid-pass. Same treatment as the host view's
 *  `visitorCredentialSaveStatusMessage` sibling. */
export function connectionTestStateFromResult({ result }: { result: { ok: boolean; message?: string } | undefined }, _options: Record<string, never> = {}): ConnectionTestState {
  if (!result) return { status: "error", message: "Connection test failed" };
  if (result.ok) return { status: "ok", message: result.message };
  return { status: "error", message: result.message || "Connection test failed" };
}
