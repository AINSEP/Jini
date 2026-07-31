/**
 * Origin: the inline `execution` tab body in `SettingsDialog.tsx`
 * (lines 4080-5336), classified MIXED by
 * `foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.3 — a generic
 * "Local CLI vs. bring-your-own-key" execution switch wrapped in
 * origin-specific managed-runtime/wallet chrome.
 *
 * What is ported: the mode switch, the provider/gateway chip groups, and the
 * BYOK credential form (the origin had already factored these fields into
 * `components/byok/*`, which is why this slice is assembly rather than
 * surgery).
 *
 * What is deliberately left behind: the origin's managed-runtime wallet
 * (balance polling, top-up, sign-in coachmarks, the `SettingsHighlight`
 * one-shot focus hint) and its analytics tracking calls — all product-bound,
 * none of it generic.
 */

/** `'local-cli'` runs a detected code-agent CLI on this machine; `'byok'`
 *  talks to a model endpoint with the operator's own credentials. The origin
 *  spelled these `'daemon'` and `'api'` — renamed here to say what they mean
 *  rather than how the origin's transport happened to be wired. */
export type ExecutionMode = 'local-cli' | 'byok';

/** Wire protocol a BYOK endpoint speaks. Vendor-shaped, not product-shaped:
 *  these name public API dialects, the same way `features/i18n` names locales. */
export type ApiProtocol = 'anthropic' | 'openai' | 'azure' | 'google';

/** Where a preset renders in the chip strip. The origin drew one row of
 *  protocol presets and one of gateway presets; hosts that don't care can
 *  leave this unset and get a single row. */
export type ProviderPresetKind = 'protocol' | 'gateway';

/** One selectable endpoint preset. A host supplies its own catalog — this
 *  package ships `DEFAULT_PROVIDER_PRESETS` as a starting point, not as a
 *  fixed list (same convention as `LanguageTab`'s host-supplied locales). */
export interface ProviderPreset {
  id: string;
  title: string;
  protocol: ApiProtocol;
  baseUrl: string;
  /** Ranked suggestions shown in the model field. Never authoritative — a
   *  host with live model discovery should pass `ExecutionPort.listModels`. */
  preferredModels: readonly string[];
  kind?: ProviderPresetKind;
  /** Fixed-origin gateways resolve their base URL themselves, so the Base URL
   *  field is hidden rather than shown-and-ignored (origin: `isFixedOriginGateway`). */
  fixedOrigin?: boolean;
  /** Some local/self-hosted endpoints need no bearer credential. Defaults to
   *  `true` — i.e. an API key is required unless a preset opts out. */
  requiresApiKey?: boolean;
  /** Optional "Get key" deep link rendered beside the API-key field. */
  apiKeyConsoleUrl?: string;
  /** The synthetic "Custom" preset. Exactly one may carry this flag; it is
   *  never treated as configured-by-preset and never hides the Base URL. */
  custom?: boolean;
}

/** One provider's saved credential draft — everything `ByokConfig` carries at
 *  the top level, minus the selection fields (`protocol`/`providerId`), which
 *  only make sense for the *active* selection. */
export interface ByokProviderCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number | undefined;
}

/**
 * The operator's BYOK credentials and endpoint selection.
 *
 * `apiKey`/`baseUrl`/`model`/`maxTokens` at the top level are the *active*
 * selection's live values — what the form renders and what a connection test
 * or real dispatch uses right now. They are NOT shared across providers:
 * every other preset's last-saved credentials live in `savedByProviderId`,
 * keyed by preset id, and `nextConfigForPresetSelect` (`rules.ts`) snapshots
 * the outgoing provider into that map before loading the incoming one.
 *
 * Origin: `state/config.ts`'s `apiProtocolConfigs` (keyed per protocol) plus
 * `byokProviderConfigDrafts` (keyed per protocol+baseUrl, for presets that
 * share a protocol but not an endpoint). This package collapses both into one
 * map keyed by preset id, which is already unique per endpoint in this tab's
 * catalog. Without this split, every preset chip's "configured" status
 * (`isProviderConfigured`) reads the SAME shared fields — so selecting
 * Anthropic and typing a key made the unrelated Ollama chip (which requires
 * no key) render "configured" too, because it was being checked against
 * Anthropic's live base URL rather than its own.
 */
export interface ByokConfig {
  protocol: ApiProtocol;
  /** `null` selects the custom/manual endpoint rather than a preset. */
  providerId: string | null;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Omitted/undefined means "use the model's own default", which is why this
   *  is not `number | 0` — 0 would be a real cap of zero tokens. */
  maxTokens?: number | undefined;
  /** Saved credentials for every preset OTHER than the active selection,
   *  keyed by `ProviderPreset.id`. See this interface's header. */
  savedByProviderId?: Readonly<Record<string, ByokProviderCredentials>>;
}

export interface ExecutionConfig {
  mode: ExecutionMode;
  byok: ByokConfig;
}

/** A code-agent CLI found on this machine, as reported by `ExecutionPort`. */
export interface DetectedAgent {
  id: string;
  label: string;
  installed: boolean;
  version?: string | undefined;
  /** Absolute path to the resolved binary, when the host can determine it. */
  path?: string | undefined;
}

/** Which required BYOK field is still blank/invalid. Drives the inline
 *  "required" markers without the tab hard-coding field labels. */
export type ByokRequiredField = 'apiKey' | 'baseUrl' | 'model';

export type ConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message?: string | undefined }
  | { status: 'error'; message: string };

/** Result of a local-CLI rescan, surfaced as an inline status line. */
export type AgentScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'ok'; count: number }
  | { status: 'error'; message: string };
