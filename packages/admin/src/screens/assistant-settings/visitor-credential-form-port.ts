import type { ProviderPreset as CatalogProviderPreset } from "@jini-ai/core";
import type { SiteAssistantCredential, SiteAssistantCredentialPatch } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";

/**
 * @file What `use-visitor-credential-form.hooks.ts` needs from the outside world, as interfaces
 * rather than direct imports, plus the controller shape it returns.
 *
 * Was previously `VisitorCredentialApi`, declared inline in the hook itself (the "F05 coupling fix",
 * audit `TM-20260810-01` — see `saveVisitorKey` for the extraction this port formalizes). Split out
 * and renamed to match the `<Name>Port` convention; no behavior changed by the move.
 *
 * Structurally the matching slice of the host's API client, declared here rather than imported whole
 * so the hook depends on the two methods it uses instead of on an ambient singleton.
 */

/* ---------- provider-form shapes (local; structurally equal to the host UI library's) ----------
 * Admin imports no UI package (see `react/kit.tsx`'s header): these are local copies of the BYOK
 * form shapes this screen reads and writes, so its published types pin no UI library. The host
 * proves compatibility where it binds `presetRules` and `createExecutionPort`, so a UI-library shape
 * change fails the host's typecheck at that binding. */

/** Wire protocol a BYOK endpoint speaks. */
export type ApiProtocol = "anthropic" | "openai" | "azure" | "google";

/** One host-supplied endpoint preset — the shared catalog shape, over this form's protocols. */
export type ProviderPreset = CatalogProviderPreset<ApiProtocol>;

/** One provider's saved credential draft, kept per preset id while another preset is selected. */
export interface ByokProviderCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number | undefined;
}

/** The form's credential draft. `savedByProviderId` is written only by the injected
 *  `nextConfigForPresetSelect`; this screen carries it through untouched. */
export interface ByokConfig {
  protocol: ApiProtocol;
  /** `null` selects the custom/manual endpoint rather than a preset. */
  providerId: string | null;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number | undefined;
  savedByProviderId?: Readonly<Record<string, ByokProviderCredentials>>;
}

/** The probe transport — only the two calls this screen makes. */
export interface ExecutionPort {
  /** Resolves `ok: false` when the endpoint answered with a refusal; rejects when no answer came. */
  testConnection(config: ByokConfig): Promise<{ ok: boolean; message?: string }>;
  /** Optional live model discovery; rejects on any failure rather than resolving `[]`. */
  listModels?(config: ByokConfig): Promise<readonly string[]>;
}

/** The connection-test line's state. */
export type ConnectionTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message?: string | undefined }
  | { status: "error"; message: string };

/** The model-discovery hint's state; `error` is distinct from an empty `ok`. */
export type ModelDiscoveryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; models: readonly string[] }
  | { status: "error"; message: string };

/** The provider-catalog rules the host's UI library owns, injected so this screen stays UI-free. */
export interface VisitorPresetRules {
  /** Splits the catalog into the protocol row and the gateway row, catalog order kept. */
  groupPresets(required: { presets: readonly ProviderPreset[] }, optional?: Record<string, never>): {
    protocols: readonly ProviderPreset[];
    gateways: readonly ProviderPreset[];
  };
  /** Whether `config` holds complete credentials for `preset` (its own saved draft, not the live one). */
  isProviderConfigured(required: { config: ByokConfig; preset: ProviderPreset | null }, optional?: Record<string, never>): boolean;
  /** The config after selecting `preset`: snapshots the outgoing provider's draft, loads the incoming one's. */
  nextConfigForPresetSelect(required: { config: ByokConfig; preset: ProviderPreset }, optional?: Record<string, never>): ByokConfig;
  /** The preset `config` currently selects, or `null` for the custom endpoint. */
  resolveSelectedPreset(required: { presets: readonly ProviderPreset[]; config: ByokConfig }, optional?: Record<string, never>): ProviderPreset | null;
}
export interface VisitorCredentialFormPort {
  getAssistantSiteCredential(): Promise<{ data: SiteAssistantCredential }>;
  setAssistantSiteCredential(patch: SiteAssistantCredentialPatch, optional?: Record<string, never>): Promise<{ data: SiteAssistantCredential }>;
}

/** The stored-key rules and error describers the host owns (its error class, its endpoint pin, its copy). */
export interface VisitorCredentialFormRules {
  /** The host's API-error copy for this screen (named setting on FORBIDDEN, unconfigured secret store, …). */
  describeApiError(required: { e: unknown; fallback: string }): string;
  /** The host's probe-error copy (its endpoint-pin refusals in plain language). */
  describeProbeError(required: { e: unknown; fallback: string }): string;
  /** A key is stored but for a DIFFERENT endpoint than the form's (a provider switch). */
  storedKeyIsForOtherEndpoint(required: { stored: SiteAssistantCredential | null; baseUrl: string }): boolean;
  /** A key a probe can use here — typed, or stored for this endpoint. */
  hasUsableKey(required: { apiKey: string; stored: SiteAssistantCredential | null; baseUrl: string }): boolean;
  /** Nothing typed and the stored key belongs to another endpoint: a probe could only be refused. */
  storedKeyBlocksProbe(required: { apiKey: string; stored: SiteAssistantCredential | null; baseUrl: string }): boolean;
}

/** Everything the host binds once for `useVisitorCredentialForm`. */
export interface VisitorCredentialFormDependencies {
  /** The site-credential client — required, so the real client is supplied exactly once by the host. */
  port: VisitorCredentialFormPort;
  rules: VisitorCredentialFormRules;
  /** The UI library's preset grouping/selection rules — required, bound once by the host. */
  presetRules: VisitorPresetRules;
  /** The host's provider catalog. */
  presets: readonly ProviderPreset[];
  /** The preset the form starts on when nothing is saved (an owner default). */
  defaultPresetId: string;
  /** The model discovery seeds first when a key offers it — the server's own default model. */
  preferredModel: string;
  /** Builds the probe transport when the caller injects none. */
  createExecutionPort: () => ExecutionPort;
}

/** Save's user-visible state. `saved` carries the server's own view back so the line under the key
 *  field can report what is actually stored rather than what was sent. */
export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: string | null }
  | { status: "error"; message: string };

/** One `<optgroup>` of the Visitor tab's Provider select. */
export interface VisitorProviderGroup {
  label: "Protocols" | "Gateways";
  options: { preset: ProviderPreset; configured: boolean }[];
}

export interface VisitorCredentialFormController {
  /** Defaults are not server truth until the initial read succeeds. */
  loadState: { status: "loading" } | { status: "ready" } | { status: "error"; message: string };
  config: ByokConfig;
  /** Every edit that originates from a CONTROL goes through here, so `dirty` reflects the operator
   *  and never hydration or discovery. */
  editConfig: (next: ByokConfig) => void;
  preset: ProviderPreset | null;
  discovery: ModelDiscoveryState;
  connectionTest: ConnectionTestState;
  /** The server's write-only view of what is currently stored (`isSet` + `masked`), never the key. */
  stored: SiteAssistantCredential | null;
  /** The "Save key" button's own save state. Never advanced by {@link saveSettings}. */
  saveState: SaveState;
  /** The "Save settings" button's own save state, deliberately separate from {@link saveState}: two
   *  buttons writing two disjoint patches need two answers, and one shared state is exactly what let
   *  a settings-only press report that a key had been stored. */
  settingsSaveState: SaveState;
  /**
   * True once the operator has actually changed something — what "Save settings" is enabled by.
   *
   * State rather than a ref because a button's disabled-ness has to re-render on it. Set ONLY from
   * `editConfig`, so neither hydration nor discovery seeding a model counts as an edit; without
   * that separation the button would light up on load offering to write back the values the server
   * just sent, and — if the initial GET had failed — to write this form's hardcoded defaults over a
   * perfectly good stored credential.
   */
  dirty: boolean;
  /** A key a probe can use here — just typed, or stored on the server FOR THIS ENDPOINT. That is what
   *  makes the two probe controls meaningful, which is the only thing they need to decide. */
  hasUsableKey: boolean;
  hasStoredKey: boolean;
  /** A key is stored, but the server saved it for another endpoint than the form's (a provider
   *  switch). With nothing typed, no probe sends it and the key line asks for this provider's key.
   *  See the host's `storedKeyIsForOtherEndpoint` rule. */
  storedKeyIsForOtherEndpoint: boolean;
  /** Which provider presets the current credentials already satisfy — feeds each `ProviderChipGroup`'s
   *  filled/unfilled dot. */
  configuredPresetIds: Set<string>;
  selectPreset: (next: ProviderPreset) => void;
  /** The Provider `<select>`'s two optgroups (protocols, gateways), each option flagged when
   *  {@link configuredPresetIds} has it — the old chips' filled dot, now an option suffix. */
  providerGroups: VisitorProviderGroup[];
  /** The `<select>`'s change handler: looks the preset up by id and runs {@link selectPreset}, so
   *  autosave and field population are identical to the chips it replaced. Unknown ids are ignored. */
  selectPresetById: (required: { presetId: string }, optional?: Record<string, never>) => void;
  /** Writes the KEY only — see `saveVisitorKey`. */
  saveKey: () => Promise<void>;
  /** Writes provider/baseUrl/model only, never a key — see `saveVisitorSettings`. */
  saveSettings: () => Promise<void>;
  runKeyTest: () => Promise<void>;
  runTestConnection: () => Promise<void>;
}
