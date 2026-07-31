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
  localCli: LocalCliConfig;
}

/** One model a detected agent can be asked to run. Mirrors
 *  `@jini-ai/agent-runtime`'s `RuntimeModelOption` field-for-field so a host
 *  backed by that package passes its detection payload through unmapped. */
export interface AgentModelOption {
  id: string;
  label: string;
}

/** Where an agent's model list came from. `'live'` was pulled from the CLI
 *  itself (its config or a catalog call); `'fallback'` is the adapter's
 *  built-in list. The distinction is rendered, not cosmetic: an operator
 *  looking at a stale built-in list needs to know a rescan can improve it. */
export type AgentModelSource = 'live' | 'fallback';

/** Whether the CLI appears to be signed in. `'unknown'` is a real third state,
 *  not a synonym for `'missing'` — an adapter with no auth probe, or a probe
 *  that could not be classified, genuinely does not know, and saying
 *  "authentication required" there would be a false claim. */
export type AgentAuthStatus = 'ok' | 'missing' | 'unknown';

/**
 * A code-agent CLI found on the machine that ran detection, as reported by
 * `ExecutionPort`.
 *
 * Everything below `path` is optional because a host may know less than
 * `@jini-ai/agent-runtime` does — but a host backed by that package should
 * pass all of it through. Its `DetectedAgent` (`types.ts`, the `models` /
 * `modelsSource` / `authStatus` / `authMessage` / `path` / `version`
 * intersection) already carries every field here, so narrowing the payload at
 * the route boundary throws away data the card is built to render.
 */
export interface DetectedAgent {
  id: string;
  label: string;
  installed: boolean;
  version?: string | undefined;
  /** Absolute path to the resolved binary, when the host can determine it. */
  path?: string | undefined;
  /** One-line vendor description ("Anthropic official CLI"). Describes the
   *  CLI, not the product embedding it — see `DEFAULT_AGENT_DESCRIPTIONS`,
   *  which a host may extend or replace. */
  description?: string | undefined;
  models?: readonly AgentModelOption[] | undefined;
  modelsSource?: AgentModelSource | undefined;
  authStatus?: AgentAuthStatus | undefined;
  /** Operator-actionable detail behind a `'missing'`/`'unknown'` status —
   *  rendered as the meta line's tooltip so the card stays compact without
   *  discarding the reason. */
  authMessage?: string | undefined;
  /** Short marketing-ish tags ("Official", "Lower cost"). The mechanism is
   *  generic; the vocabulary is the host's — this package ships none. */
  badges?: readonly string[] | undefined;
}

/**
 * Which detected CLI runs the operator's prompts, and with which model.
 *
 * `modelByAgentId` is keyed rather than flat because the picker is per-agent:
 * switching from Claude to Codex and back must not silently hand Codex's model
 * id to Claude. The origin kept the same shape (`cfg.agentModels`, keyed by
 * agent id) for the same reason.
 */
export interface LocalCliConfig {
  /** `null` until the operator picks one — deliberately not defaulted to the
   *  first detected agent, so "nothing selected" stays distinguishable from
   *  "the first one was chosen for you". */
  agentId: string | null;
  modelByAgentId?: Readonly<Record<string, string>>;
}

/** Which required BYOK field is still blank/invalid. Drives the inline
 *  "required" markers without the tab hard-coding field labels. */
export type ByokRequiredField = 'apiKey' | 'baseUrl' | 'model';

export type ConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message?: string | undefined }
  | { status: 'error'; message: string };

/** Result of the per-agent Test button, surfaced under the selected card.
 *  Same idiom as `ConnectionTestState` — the two report the same kind of
 *  outcome for the two execution modes, so they deliberately share a shape. */
export type AgentTestState =
  | { status: 'idle' }
  | { status: 'testing'; agentId: string }
  | { status: 'ok'; agentId: string; message?: string | undefined }
  | { status: 'error'; agentId: string; message: string };

/** Result of a local-CLI rescan, surfaced as an inline status line. */
export type AgentScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'ok'; count: number }
  | { status: 'error'; message: string };

/** Result of `ExecutionPort.listModels`, surfaced as an inline hint near the
 *  Model field. Mirrors `ConnectionTestState`/`AgentScanState`'s shape
 *  deliberately — one idiom for "async edge result" across this tab, per
 *  this package's error-reporting contract (§3.2: reuse an existing union
 *  over introducing a parallel shape). A failure here must NOT collapse
 *  into the same "no models" the field already tolerates when a host
 *  supplies no `listModels` at all — `'error'` is a distinct, renderable
 *  state, not an empty `'ok'`. */
export type ModelDiscoveryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; models: readonly string[] }
  | { status: 'error'; message: string };
