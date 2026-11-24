import type { ProviderPreset as SharedProviderPreset } from '../provider-catalog.js';
/**
 * Origin: the inline `execution` tab body in `SettingsDialog.tsx`
 * (lines 4080-5336), classified MIXED by
 * `ADS-memory/reports/jini-port/recon/r6-god-component-internals.md` §1.3 — a generic
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
export type { ProviderPresetKind } from '../provider-catalog.js';

/** One selectable endpoint preset supplied by the host. */
export interface ProviderPreset extends SharedProviderPreset<ApiProtocol> {}

/**
 * One advisory remark about the API key currently typed into the form, ready to translate.
 *
 * `message` is plain English AND its own i18n key (this package's convention — see
 * `DEFAULT_AGENT_DESCRIPTIONS`), and `vars` fills its `{name}` placeholders. Kept split rather than
 * pre-composed because the vendor names are runtime values from the catalog: a pre-composed
 * sentence would be a key no dictionary can contain, and would also freeze English word order for
 * every locale.
 *
 * Advisory by construction — a message, not a validity verdict. See {@link ProviderPreset.apiKeyPrefix}.
 */
export interface ApiKeyWarning {
  message: string;
  vars: Readonly<Record<string, string>>;
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
  identityKind?: 'concrete' | 'alias' | 'routing-mode';
  resolvedId?: string;
  /**
   * The reasoning-effort levels THIS model supports, when the runtime's own catalog reports them
   * per model rather than uniformly across the agent. Mirrors `@jini-ai/agent-runtime`'s
   * `RuntimeModelOption.reasoning` field-for-field, for the same reason every other field on this
   * interface does (see this file's header doc) — Codex's `debug models` catalog reports it, and the
   * levels genuinely differ between models on the same CLI.
   *
   * `undefined` means "nothing model-specific to say" and is read as agent-wide by
   * `useReasoningControl`'s narrowing rule — it falls back to `ExecutionCardAgent.reasoningOptions`'s
   * union, the same list every model showed before this field existed. It is NOT a synonym for "zero
   * levels". An explicit `[]` means the catalog said so outright, and is honored as-is even though it
   * hides the effort control for that model.
   */
  reasoning?: readonly AgentModelOption[] | undefined;
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

/** Whether an agent's CLI accepts an operator-typed model id outside its
 *  known `models` list. `undefined` means "allow" (most CLIs do) — a host
 *  opts OUT with an explicit `false` for a CLI that routes model selection
 *  through a closed catalog (no free-text `--model` flag, or a protocol that
 *  validates the id against a live catalog and rejects unknown ones).
 *  Origin: `RuntimeAgentDef.supportsCustomModel`. */
export type AgentSupportsCustomModel = boolean;

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
export interface ExecutionCardAgent {
  /** Cached inventory is usable now; retry a normal read until background discovery settles. */
  discoveryPending?: boolean;
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
  /** Reasoning-effort/mode presets this agent's model exposes (e.g.
   *  "low"/"medium"/"high"), reusing `AgentModelOption`'s `{id, label}` shape
   *  — the same shape `@jini-ai/agent-runtime`'s `RuntimeReasoningOption`
   *  aliases from its model-option type, for the same reason: a reasoning
   *  choice IS a model-catalog entry, just from a different picker. Absent or
   *  empty means the agent has no reasoning axis to configure. */
  reasoningOptions?: readonly AgentModelOption[] | undefined;
  /**
   * Declares that this agent's CLI carries its reasoning-effort choice INSIDE
   * the model id — as a trailing `-<level>` on the slug — instead of in a flag
   * of its own, and names which trailing tokens count as levels.
   *
   * Mirrors `@jini-ai/agent-runtime`'s `RuntimeReasoningInModelId` field-for-
   * field, the same way `reasoningOptions` above mirrors its
   * `RuntimeReasoningOption[]`, and for the same reason (see this interface's
   * own doc). Present INSTEAD of `reasoningOptions`, never alongside it: a card
   * carrying both would render two effort controls that disagree about where
   * the choice goes.
   *
   * Only the vocabulary is declared. Which of these levels a given base model
   * actually has is DERIVED from `models` by `reasoningModelGroups`
   * (`rules.ts`) — availability is genuinely not uniform (antigravity's
   * `gemini-3.1-pro` has only high and low, `gpt-oss-120b` only medium,
   * `claude-sonnet-4-6` none), so a fixed high/medium/low control would offer
   * slugs the CLI rejects outright.
   */
  reasoningInModelId?: { levels: readonly AgentModelOption[] } | undefined;
  /** See `AgentSupportsCustomModel`. `undefined` allows custom input,
   *  matching every adapter's default before this field existed. */
  supportsCustomModel?: AgentSupportsCustomModel | undefined;
  authStatus?: AgentAuthStatus | undefined;
  /** Operator-actionable detail behind a `'missing'`/`'unknown'` status —
   *  rendered as the meta line's tooltip so the card stays compact without
   *  discarding the reason. */
  authMessage?: string | undefined;
  /** Short marketing-ish tags ("Official", "Lower cost"). The mechanism is
   *  generic; the vocabulary is the host's — this package ships none. */
  badges?: readonly string[] | undefined;
  /** Why this agent is unavailable or only partially usable, as one or more
   *  renderable "reason + fix button(s)" rows — see `AgentDiagnostic`. Absent
   *  or empty means detection has nothing actionable to report (the common
   *  case for a healthy, authenticated CLI). */
  diagnostics?: readonly AgentDiagnostic[] | undefined;
  /** Destination for an `{kind: 'openInstall'}` fix action — the CLI's
   *  install/download page. Absent hides that action even if a diagnostic
   *  requests it, per `AgentDiagnosticRow`'s "only render what the host can
   *  actually do" contract. */
  installUrl?: string | undefined;
  /** Destination for an `{kind: 'openDocs'}` fix action — the CLI's
   *  configuration/auth docs. Same absent-hides-the-action rule as
   *  `installUrl`. */
  docsUrl?: string | undefined;
}

/**
 * Why a CLI agent is unavailable or only partially usable, in a shape a UI
 * can render as "one-line reason + fix button(s)" instead of a silent grey
 * card.
 *
 * Origin: OD's `packages/contracts/src/api/registry.ts#AgentDiagnostic` /
 * `AgentFixIntent`, vendored into `@jini-ai/protocol`'s `agent-catalog.ts`
 * (2026-07-29) unmodified. Mirrored here field-for-field rather than
 * imported — this file has zero imports of its own (framework-free, part of
 * this package's `./core` subpath), the same reasoning `ExecutionCardAgent`'s own
 * doc comment gives for mirroring `@jini-ai/agent-runtime`'s shape instead of
 * depending on that Node-only package. A host on `@jini-ai/agent-runtime` /
 * `@jini-ai/protocol` passes its `AgentDiagnostic[]` straight through
 * unmapped, since the fields are identical.
 */
export interface AgentDiagnostic {
  reason: AgentDiagnosticReason;
  severity: AgentDiagnosticSeverity;
  /** Short, human-readable, single-sentence explanation. */
  message: string;
  /** Optional longer context (e.g. the probe's stderr tail). */
  detail?: string | undefined;
  /** Directories PATH detection searched, surfaced verbatim for the
   *  `'not-on-path'` case so the operator can see where detection looked
   *  before being asked to set an explicit binary path. */
  searchedDirs?: readonly string[] | undefined;
  /** Ordered fix affordances the UI should offer for this diagnostic. */
  fixActions?: readonly AgentFixIntent[] | undefined;
}

export type AgentDiagnosticReason =
  /** The binary (and any fallback names) was not found on PATH. */
  | 'not-on-path'
  /** A file matched but is not executable (missing +x / wrong PATHEXT). */
  | 'not-executable'
  /** A wrapper/shim was found but its target is gone (exit 126/127). */
  | 'shim-broken'
  /** A user-set binary-path override points at a missing/invalid file. */
  | 'configured-bin-invalid'
  /** Installed and invocable, but the CLI is not authenticated. */
  | 'auth-missing'
  /** Installed, but auth status could not be verified. */
  | 'auth-unknown';

export type AgentDiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * A typed "what should the UI do to fix this" intent attached to an
 * `AgentDiagnostic`. The UI renders one button per intent and owns the
 * concrete handler (open a URL, re-run detection, write an env override);
 * keeping the intent typed — rather than a pre-baked button label + URL —
 * lets more than one surface render the same fix affordances from one
 * source of truth.
 */
export type AgentFixIntent =
  /** Open the agent's configuration/auth docs. */
  | { kind: 'openDocs' }
  /** Open the agent's install/download page. */
  | { kind: 'openInstall' }
  /** Re-run agent detection (this tab's rescan affordance). */
  | { kind: 'rescan' }
  /** Prompt the operator to point the host at an explicit binary by writing
   *  `envKey` into `LocalCliConfig.envByAgentId` — used when the CLI is
   *  installed somewhere PATH detection can't reach. */
  | { kind: 'setEnv'; envKey: string }
  /** Clear a previously-set binary override so detection falls back to PATH. */
  | { kind: 'clearEnv'; envKey: string }
  /** Launch the agent's interactive sign-in in a system terminal (used by
   *  adapters whose OAuth flow cannot complete headlessly). */
  | { kind: 'launchOAuth'; agentId: string };

/**
 * Catalog entry describing one operator-configurable CLI environment
 * variable for one agent (a proxy base URL, a custom config directory, a
 * binary-path override, …). Origin: `AGENT_CLI_ENV_FIELDS`. A host supplies
 * its own catalog the same way it supplies `ProviderPreset`s — this package
 * ships `DEFAULT_AGENT_CLI_ENV_FIELDS` as a starting point for the CLIs it
 * already knows about (see `DEFAULT_AGENT_DESCRIPTIONS`), not as a fixed list.
 */
export interface AgentCliEnvFieldSpec {
  agentId: string;
  envKey: string;
  /** Field label. This package's convention: the English string IS the i18n
   *  key (see `PROTOCOL_OPTIONS`) — a host translates it, it does not supply
   *  a separate key. */
  label: string;
  placeholder?: string | undefined;
  /** Renders the input as `type="password"` and omits the value from any
   *  plain-text display. */
  secret?: boolean | undefined;
  /** Marks this field as the agent's executable-path override — the field a
   *  "use detected path" / "clear custom path" repair affordance (see
   *  `agentExecutableRepairState`) should set or clear. At most one field per
   *  `agentId` should carry this; the mechanism is generic, but this
   *  package's own `DEFAULT_AGENT_CLI_ENV_FIELDS` only tags Codex's
   *  `CODEX_BIN`, mirroring the origin's actual (Codex-only) behavior. */
  kind?: 'binPath' | undefined;
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
  /** Per-agent reasoning-effort pick, keyed the same way as `modelByAgentId`
   *  and for the same reason: switching agents and back must not hand one
   *  agent's reasoning choice to another. */
  reasoningByAgentId?: Readonly<Record<string, string>>;
  /** Per-agent CLI environment overrides — proxy URLs, custom config dirs, a
   *  binary-path override — keyed by agent id then env var name. Origin:
   *  `AppConfig.agentCliEnv`. Mirrors that two-level shape directly rather
   *  than flattening it, since a field's env-var name is only unique WITHIN
   *  an agent (`CODEX_BIN` means nothing for `claude`). */
  envByAgentId?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Which required BYOK field is still blank/invalid. Drives the inline
 *  "required" markers without the tab hard-coding field labels. */
export type ByokRequiredField = 'apiKey' | 'baseUrl' | 'model';

export type ConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message?: string | undefined }
  | { status: 'error'; message: string };

/**
 * Which executable a Local-CLI test actually invoked. `'primary'` is the
 * normal case (the resolved/on-PATH binary ran). The two `fallback-*`
 * variants report that a configured binary-path override
 * (`AgentCliEnvFieldSpec` with `kind: 'binPath'`) could not be used and
 * detection fell back to a different binary anyway — `'fallback-invalid'`
 * when the override path never resolved to an executable, `'fallback-failed'`
 * when it resolved but failed to run. Both are the trigger for
 * `agentExecutableRepairState`'s repair affordance. Origin: OD's
 * `ConnectionTestResponse.usedExecutableSource` (`'fallback_invalid'` /
 * `'fallback_failed'`, renamed to this package's kebab-case convention).
 */
export type AgentExecutableSource = 'primary' | 'fallback-invalid' | 'fallback-failed';

/** Result of the per-agent Test button, surfaced under the selected card.
 *  Same idiom as `ConnectionTestState` — the two report the same kind of
 *  outcome for the two execution modes, so they deliberately share a shape.
 *  `usedExecutableSource`/`detectedExecutablePath` are optional passthrough
 *  from `ExecutionPort.testAgent`'s result, present only when the host's
 *  probe can report which binary it actually ran — see
 *  `agentExecutableRepairState`. */
export type AgentTestState =
  | { status: 'idle' }
  | { status: 'testing'; agentId: string }
  | {
      status: 'ok';
      agentId: string;
      message?: string | undefined;
      usedExecutableSource?: AgentExecutableSource | undefined;
      detectedExecutablePath?: string | undefined;
    }
  | { status: 'error'; agentId: string; message: string };

/** The repair affordance a successful-but-fallback agent test unlocks: an
 *  operator-set binary-path override didn't work, detection silently fell
 *  back to a different binary, and the test still passed — so the operator
 *  should be offered "use the binary that actually worked" or "clear the
 *  override and stop overriding". `canUseDetected` is carried explicitly
 *  (rather than always being implied `true`) so a future detection outcome
 *  that finds a fallback path but cannot vouch for it has somewhere to say
 *  so without a breaking shape change. */
export interface AgentExecutableRepair {
  detectedPath: string;
  canUseDetected: boolean;
}

/**
 * One base model of a `ExecutionCardAgent.reasoningInModelId` agent, together with the effort levels
 * that model ACTUALLY has — derived from the agent's own model list by `reasoningModelGroups`
 * (`rules.ts`), never declared.
 *
 * This is the shape the card renders its two controls from: the base picker lists one entry per
 * group, and the effort picker lists exactly `levels` for whichever group is active. That is what
 * keeps it from offering a slug the CLI would reject — `gemini-3.1-pro` genuinely has no `-medium`
 * variant, so `levels` genuinely has no `medium` entry.
 */
export interface ReasoningModelGroup {
  /** The model id with any recognized effort suffix removed (`gemini-3.1-pro`). */
  baseId: string;
  /** Display name for the base. The effort qualifier is stripped from the source label only when
   *  the id it came from carried a real suffix — so `Gemini 3.1 Pro (High)` becomes `Gemini 3.1
   *  Pro`, while `Claude Sonnet 4.6 (Thinking)` (a suffix-less id) keeps its parenthetical. */
  label: string;
  /** The effort levels this base really offers, in the declared vocabulary's order. Empty for a
   *  base the catalog lists without any suffixed variant. */
  levels: readonly AgentModelOption[];
  /** Full model id per level in `levels` — the recombination table, so composing a slug is a
   *  lookup of something the catalog actually contained rather than string concatenation. */
  modelIdByLevel: Readonly<Record<string, string>>;
  /** The suffix-less id, when the catalog lists the base on its own (`claude-sonnet-4-6`,
   *  `default`). Absent for a base that only ever appears with a suffix. */
  bareModelId?: string | undefined;
}

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

/**
 * The host-specific transport this tab needs. Genuinely host-owned: the origin
 * called its own daemon's agent-scan and connection-test endpoints. This
 * feature ships only a fake in `dependencies.ts`; a real host supplies its own
 * implementation (same convention as `McpIntegrationsPort`).
 */
export interface ExecutionPort {
  /** Code-agent CLIs present on this machine. Called on mount and on rescan.
   *  REJECTS if detection itself fails (host process crashed, the host's
   *  transport to its own probing mechanism is down, etc.) — an empty
   *  resolved array means "detection ran and found nothing," a genuinely
   *  different state from "detection could not run." A host implementation
   *  must not collapse the two into the same `[]`. */
  detectLocalAgents(): Promise<readonly ExecutionCardAgent[]>;

  /**
   * Probes the BYOK endpoint with the supplied credentials. Two distinct
   * outcomes, both documented per this package's error-reporting contract
   * (§3.1 — a domain-outcome exception to "ports reject"):
   *  - **Resolves** with `ok: false` when the endpoint was REACHED and it
   *    rejected the credentials/model — that rejection IS the answer to
   *    "does this connection work?", so it is a value, not a failure.
   *  - **Rejects** when the test itself could not run — a transport failure,
   *    timeout, or malformed base URL never got an answer FROM the provider
   *    at all, so there is nothing to report as a value.
   */
  testConnection(config: ByokConfig): Promise<{ ok: boolean; message?: string }>;

  /** Live model discovery. Optional — without it the model field falls back to
   *  the selected preset's `preferredModels` plus free text. REJECTS on any
   *  failure (auth, timeout, unreachable endpoint, unsupported protocol) —
   *  unlike `testConnection`, there is no legitimate "reachable but empty"
   *  answer worth treating as a value here: a provider genuinely reporting
   *  zero models is indistinguishable in practice from "the call to list
   *  them failed," so every non-crash outcome resolves either a real,
   *  non-empty list or rejects with why it couldn't. A host must not resolve
   *  `[]` to mean "the request failed." */
  listModels?(config: ByokConfig): Promise<readonly string[]>;

  /** Re-runs the host's own agent detection (e.g. after the operator installs
   *  a CLI). Optional; without it the rescan button is not rendered. Same
   *  reject-on-failure contract as `detectLocalAgents`. */
  rescanLocalAgents?(): Promise<readonly ExecutionCardAgent[]>;

  /**
   * Checks that a detected CLI can actually run — the Local CLI counterpart of
   * `testConnection`, and it splits its outcomes the same way (§3.1):
   *  - **Resolves** with `ok: false` when the CLI was reached and reported a
   *    problem the operator can fix (not signed in, expired credentials, an
   *    unusable model choice). That report IS the answer to "does this work?".
   *  - **Rejects** when the check could not run at all — the host could not
   *    spawn the binary, its transport to the probing host is down, the
   *    request timed out. There is no answer to report as a value.
   *
   * Optional; without it no Test button is rendered on the selected card.
   * `model` is the operator's current per-agent pick, so a host whose probe
   * can validate the model choice gets the chance to.
   *
   * `usedExecutableSource`/`detectedExecutablePath` are optional: a host
   * whose probe can tell which binary it actually invoked reports them so
   * the card can offer `agentExecutableRepairState`'s repair affordance;
   * a host that can't just omits both and the affordance never renders.
   */
  testAgent?(
    agentId: string,
    model?: string | undefined,
  ): Promise<{
    ok: boolean;
    message?: string;
    usedExecutableSource?: AgentExecutableSource;
    detectedExecutablePath?: string;
  }>;
}
