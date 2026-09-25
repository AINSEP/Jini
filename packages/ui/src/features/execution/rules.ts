import { isAllowedEndpointUrl } from '../../utils/endpoint-policy.js';
import {
  API_KEY_CROSS_VENDOR_WARNING,
  API_KEY_TOO_SHORT_WARNING,
  CUSTOM_PRESET_ID,
  DEFAULT_BASE_URL_BY_PROTOCOL,
  MIN_PLAUSIBLE_API_KEY_LENGTH,
} from './constants.js';
import type {
  AgentCliEnvFieldSpec,
  AgentDiagnostic,
  AgentExecutableRepair,
  AgentExecutableSource,
  AgentModelOption,
  ApiKeyWarning,
  ByokConfig,
  ByokProviderCredentials,
  ByokRequiredField,
  DetectedAgent,
  ExecutionConfig,
  ExecutionMode,
  LocalCliConfig,
  ProviderPreset,
  ReasoningModelGroup,
} from './types.js';

/**
 * Pure decision logic for the execution tab. Everything here is total and
 * side-effect free so the React layer stays a thin renderer — same split the
 * `privacy` and `integrations` tabs use.
 */

/**
 * Accepts only absolute http(s) URLs pointing somewhere a credentialed request
 * may go. Origin: `isValidApiBaseUrl`. A blank string is *not* valid here;
 * callers decide whether blank is allowed (it is, for fixed-origin gateways,
 * which resolve their own endpoint).
 *
 * This used to check the scheme and nothing else, which accepted
 * `http://169.254.169.254/` and every RFC1918 address — an operator-supplied
 * endpoint that this tab then pairs with a real API key and persists. The
 * host policy now lives in one shared module; see `utils/endpoint-policy.ts`
 * for why it is a browser-safe copy of `@jini-ai/agent-runtime`'s guard rather
 * than an import of it, and for the DNS-aware layer that complements it at
 * connection time.
 */
export function isValidApiBaseUrl(raw: string): boolean {
  return isAllowedEndpointUrl(raw);
}

/** The synthetic "Custom" preset, so the picker always has a manual escape
 *  hatch even when a host supplies zero presets. */
export function customPreset(protocol: ByokConfig['protocol'], title = 'Custom'): ProviderPreset {
  return {
    id: CUSTOM_PRESET_ID,
    title,
    protocol,
    baseUrl: '',
    preferredModels: [],
    custom: true,
  };
}

/** Presets that speak the given protocol, excluding the custom entry. */
export function presetsForProtocol(
  presets: readonly ProviderPreset[],
  protocol: ByokConfig['protocol'],
): readonly ProviderPreset[] {
  return presets.filter((preset) => !preset.custom && preset.protocol === protocol);
}

/** Splits a catalog into the two chip rows the origin rendered. Presets with
 *  no `kind` fall into `protocols` so a host that ignores the distinction
 *  still gets one populated row rather than two empty ones. */
export function groupPresets(presets: readonly ProviderPreset[]): {
  protocols: readonly ProviderPreset[];
  gateways: readonly ProviderPreset[];
} {
  const protocols: ProviderPreset[] = [];
  const gateways: ProviderPreset[] = [];
  for (const preset of presets) {
    if (preset.custom) continue;
    if (preset.kind === 'gateway') gateways.push(preset);
    else protocols.push(preset);
  }
  return { protocols, gateways };
}

/** The preset the current config points at, or `null` for custom/manual.
 *  Matches on id first (stable across base-URL edits), falling back to the
 *  origin's protocol+baseUrl match so a config written by an older catalog
 *  still resolves. */
export function resolveSelectedPreset(
  presets: readonly ProviderPreset[],
  config: ByokConfig,
): ProviderPreset | null {
  if (config.providerId === null) return null;
  const byId = presets.find((preset) => !preset.custom && preset.id === config.providerId);
  if (byId) return byId;
  return (
    presets.find(
      (preset) =>
        !preset.custom && preset.protocol === config.protocol && preset.baseUrl === config.baseUrl,
    ) ?? null
  );
}

/** Whether a preset needs an API key. Defaults to `true`; only an explicit
 *  `requiresApiKey: false` opts out. */
export function presetRequiresApiKey(preset: ProviderPreset | null): boolean {
  return preset?.requiresApiKey !== false;
}

/** Fixed-origin gateways resolve their own endpoint, so the Base URL field is
 *  hidden rather than shown-and-ignored. Origin: `showBaseUrlField`. */
export function showsBaseUrlField(preset: ProviderPreset | null): boolean {
  return preset?.fixedOrigin !== true;
}

/**
 * Which required fields are still blank or invalid. Returned in render order
 * so a caller can surface the first offender without re-sorting.
 */
export function missingRequiredFields(
  config: ByokConfig,
  preset: ProviderPreset | null,
): readonly ByokRequiredField[] {
  const missing: ByokRequiredField[] = [];
  if (presetRequiresApiKey(preset) && !config.apiKey.trim()) missing.push('apiKey');
  if (showsBaseUrlField(preset) && !isValidApiBaseUrl(config.baseUrl)) missing.push('baseUrl');
  if (!config.model.trim()) missing.push('model');
  return missing;
}

/**
 * The catalog entry that claims this key MORE specifically than the selected preset does — i.e. the
 * vendor the operator most likely meant to paste it into. `null` when no other row recognises the
 * string, or when the selection's own claim is at least as specific as any rival's.
 *
 * "More specific" is prefix LENGTH, not catalog order. `sk-or-v1-…` starts with both OpenRouter's
 * `sk-or-` and OpenAI's `sk-`; the longer prefix is the truer claim, and deciding it by row position
 * would make the message move when someone reorders the catalog. The same comparison gives the
 * selected preset a tie: a host row that legitimately takes `sk-ant-` keys (an Anthropic-compatible
 * proxy) claims them exactly as strongly as Anthropic does and so keeps them, silently.
 *
 * @param key - The trimmed key text as typed.
 * @param preset - The selected preset. Required: with no selection there is no "wrong field" to be
 *   in, and on custom/manual any vendor's key may be exactly right.
 * @param presets - The catalog to recognise foreign keys against.
 * @returns The foreign owner, or `null` for silence.
 * @complexity O(n·m) — n presets, m the length of the longest prefix. Catalogs are single-digit
 *   rows of authored data, and `startsWith` short-circuits on the first differing character.
 */
function foreignKeyOwner(
  key: string,
  preset: ProviderPreset,
  presets: readonly ProviderPreset[],
): ProviderPreset | null {
  // -1, not 0, so a preset with no prefix of its own still loses every comparison rather than tying
  // with one. Azure ships no prefix and must still be told when it is holding an Anthropic key.
  let bestClaim =
    preset.apiKeyPrefix && key.startsWith(preset.apiKeyPrefix) ? preset.apiKeyPrefix.length : -1;
  let owner: ProviderPreset | null = null;
  for (const candidate of presets) {
    const prefix = candidate.apiKeyPrefix;
    if (!prefix || candidate.custom || candidate.id === preset.id) continue;
    if (prefix.length <= bestClaim || !key.startsWith(prefix)) continue;
    owner = candidate;
    bestClaim = prefix.length;
  }
  return owner;
}

/**
 * The advisory "that key looks wrong" remark for the current draft, or `null` for silence.
 *
 * Warns ONLY on what it can positively recognise as wrong, and there are exactly two such things:
 * a key wearing another catalogued vendor's prefix (pasted into the wrong provider's field), and a
 * key shorter than {@link MIN_PLAUSIBLE_API_KEY_LENGTH} (the reported Chrome-autofilled PASSWORD).
 * Everything else — including every shape this package has never seen — is silence.
 *
 * That direction is the whole design, and it is the fix for a real reported defect. This function
 * used to ask "does the key match the selected preset's pattern?" and warn when it did not: a
 * positive allowlist, which false-positives the instant a vendor issues a shape the catalog has not
 * been taught. That happened within hours of shipping — an operator pasted a working Google Gemini
 * key and was told it did not look like a Google API key. A catalog can prove a string belongs to
 * vendor X; it can never prove a string belongs to nobody. Do not re-derive an allowlist here, and
 * do not add a per-provider branch: the conditions above are the only two that hold without one.
 *
 * ADVISORY ONLY, also by construction: this returns a message, not a validity verdict. No caller may
 * use it to disable a control or gate a submit — a client-side guess must never be able to block a
 * working credential. It is deliberately absent from {@link missingRequiredFields}, which IS a gate.
 *
 * @param config - The active BYOK draft; only `apiKey` is read.
 * @param preset - The resolved preset, or `null` on custom/manual, which is exempt from the
 *   cross-vendor arm (see {@link foreignKeyOwner}) but not from the length floor.
 * @param presets - The catalog to recognise foreign keys against. Defaults to empty, which is why
 *   omitting it costs the cross-vendor arm and gains nothing else: an under-informed rule must
 *   degrade toward silence, never toward guessing.
 * @returns A translatable {@link ApiKeyWarning}, or `null` when there is nothing to say.
 * @complexity O(n·m) via {@link foreignKeyOwner}; the length check is O(1).
 */
export function apiKeyFormatWarning(
  config: ByokConfig,
  preset: ProviderPreset | null,
  presets: readonly ProviderPreset[] = [],
): ApiKeyWarning | null {
  const key = config.apiKey.trim();
  if (!key) return null;
  if (preset) {
    const owner = foreignKeyOwner(key, preset, presets);
    if (owner) {
      return {
        message: API_KEY_CROSS_VENDOR_WARNING,
        vars: { vendor: owner.title, provider: preset.title },
      };
    }
  }
  if (key.length < MIN_PLAUSIBLE_API_KEY_LENGTH) {
    return { message: API_KEY_TOO_SHORT_WARNING, vars: {} };
  }
  return null;
}

/**
 * The credentials a given preset would use — the active selection's live
 * top-level fields when `preset` IS the current selection, otherwise that
 * preset's own saved draft (`config.savedByProviderId`), or blank/preset
 * defaults when it has never been configured. This is the read side of the
 * per-provider keying `ByokConfig.savedByProviderId` documents: every preset
 * chip must be judged against ITS OWN credentials, never whichever provider
 * happens to be active right now.
 */
export function credentialsForPreset(
  config: ByokConfig,
  preset: ProviderPreset | null,
): ByokProviderCredentials {
  if (!preset || preset.custom || config.providerId === preset.id) {
    return { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, maxTokens: config.maxTokens };
  }
  return (
    config.savedByProviderId?.[preset.id] ?? { apiKey: '', baseUrl: preset.baseUrl, model: '', maxTokens: undefined }
  );
}

/** A provider chip renders a filled status dot when ITS OWN saved credentials
 *  (not necessarily the active selection's) satisfy its required fields —
 *  see `credentialsForPreset`. */
export function isProviderConfigured(config: ByokConfig, preset: ProviderPreset | null): boolean {
  if (!preset) return false;
  const credentials = credentialsForPreset(config, preset);
  const requiresApiKey = presetRequiresApiKey(preset);
  const hasApiKey = !requiresApiKey || Boolean(credentials.apiKey.trim());
  const hasBaseUrl = !showsBaseUrlField(preset) || isValidApiBaseUrl(credentials.baseUrl);
  const hasModel = Boolean(credentials.model.trim());
  return hasApiKey && hasBaseUrl && hasModel;
}

/** True when the operator typed something into Base URL that isn't a URL —
 *  distinct from "hasn't typed anything yet", which is not an error state. */
export function isBaseUrlInvalid(config: ByokConfig): boolean {
  return Boolean(config.baseUrl.trim()) && !isValidApiBaseUrl(config.baseUrl);
}

/**
 * Selecting a preset first snapshots the OUTGOING provider's live credentials
 * into `savedByProviderId` (so they aren't lost), then loads the INCOMING
 * preset's own saved draft — or, if it has never been configured, blank
 * credentials seeded with its base URL and top preferred model.
 *
 * This deliberately does NOT carry the outgoing provider's API key/base URL
 * forward as a shared default the way the single-`ByokConfig` design used to:
 * that sharing is exactly what let an unrelated preset's chip read as
 * "configured" off of whichever provider was last active (see
 * `isProviderConfigured`'s doc and `ByokConfig.savedByProviderId`'s header).
 * Each preset now keeps only what was actually saved for IT.
 */
export function nextConfigForPresetSelect(config: ByokConfig, preset: ProviderPreset): ByokConfig {
  const savedByProviderId = { ...config.savedByProviderId };
  if (config.providerId !== null) {
    savedByProviderId[config.providerId] = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
    };
  }
  if (preset.custom) {
    return { ...config, providerId: null, savedByProviderId };
  }
  const saved = savedByProviderId[preset.id];
  return {
    ...config,
    providerId: preset.id,
    protocol: preset.protocol,
    apiKey: saved?.apiKey ?? '',
    baseUrl: saved?.baseUrl ?? (preset.baseUrl || DEFAULT_BASE_URL_BY_PROTOCOL[preset.protocol]),
    model: saved?.model ?? preset.preferredModels[0] ?? '',
    maxTokens: saved?.maxTokens,
    savedByProviderId,
  };
}

/** Switching protocol by hand drops the preset selection (the old preset no
 *  longer speaks this protocol) and adopts the protocol's default endpoint
 *  only when the operator hasn't typed their own. */
export function nextConfigForProtocolSelect(
  config: ByokConfig,
  protocol: ByokConfig['protocol'],
): ByokConfig {
  if (config.protocol === protocol) return config;
  return {
    ...config,
    protocol,
    providerId: null,
    baseUrl: config.baseUrl.trim() ? config.baseUrl : DEFAULT_BASE_URL_BY_PROTOCOL[protocol],
  };
}

/** Mode changes never discard BYOK credentials — flipping to Local CLI and
 *  back must not make the operator retype their key. */
export function nextConfigForModeChange(
  config: ExecutionConfig,
  mode: ExecutionMode,
): ExecutionConfig {
  return config.mode === mode ? config : { ...config, mode };
}

/** Parses the optional max-tokens field. Blank means "use the model default"
 *  (`undefined`); anything non-positive or non-numeric is rejected as
 *  `undefined` rather than silently stored as 0. */
export function parseMaxTokens(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** Local-CLI agents, installed first, then alphabetical — the origin grouped
 *  by installed/not-installed and this preserves that read order. */
export function sortDetectedAgents<T extends { installed: boolean; label: string }>(
  agents: readonly T[],
): readonly T[] {
  return [...agents].sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Strips a redundant trailing agent name from a CLI's `--version` output, so
 * "1.2.3 (Claude Code)" renders as "1.2.3" beside a card already titled
 * "Claude Code". Origin: `cleanAgentVersionLabel`.
 *
 * Only a trailing occurrence is removed, and only when it matches the agent's
 * own label — a version string that legitimately *contains* the name earlier
 * on is left intact rather than mangled.
 */
export function cleanAgentVersionLabel(label: string, version: string | null | undefined): string {
  if (!version) return '';
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return version
    .replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '')
    .trim();
}

/** English label keys for `agentMetaLabel`, passed in so this stays a pure
 *  function rather than reaching for a translator. */
export interface AgentMetaLabels {
  authRequired: string;
  authUnknown: string;
  installed: string;
  notInstalled: string;
}

/**
 * The one-line status under an agent's name, and the tooltip behind it.
 *
 * Auth trouble outranks the version string: an operator whose CLI is installed
 * but signed out needs to see that, and "1.2.3" would read as everything being
 * fine. The tooltip then carries the detail (`authMessage`) or the resolved
 * binary path, so the card stays one line without discarding either.
 */
export function agentMetaLabel(
  agent: DetectedAgent,
  labels: AgentMetaLabels,
): { text: string; title: string } {
  const title = (agent.authStatus === 'missing' || agent.authStatus === 'unknown'
    ? (agent.authMessage ?? agent.path ?? '')
    : (agent.path ?? '')) as string;
  if (!agent.installed) return { text: labels.notInstalled, title };
  if (agent.authStatus === 'missing') return { text: labels.authRequired, title };
  if (agent.authStatus === 'unknown') return { text: labels.authUnknown, title };
  const version = cleanAgentVersionLabel(agent.label, agent.version);
  return { text: version || labels.installed, title };
}

/** The model an agent will actually run: the operator's explicit per-agent
 *  pick when they made one, else the first entry of whatever list the host
 *  reported, else nothing. */
export function selectedAgentModel(config: LocalCliConfig, agent: DetectedAgent): string {
  const chosen = config.modelByAgentId?.[agent.id]?.trim();
  if (chosen) return chosen;
  return agent.models?.[0]?.id ?? '';
}

/** Human label for the model an agent will run, for the collapsed summary line
 *  on unselected cards. Falls back to the raw id when the host reported a
 *  model list that doesn't contain the operator's saved pick — a stale saved
 *  choice is still the choice, and hiding it would misreport what will run. */
export function agentModelSummary(config: LocalCliConfig, agent: DetectedAgent): string {
  const id = selectedAgentModel(config, agent);
  if (!id) return '';
  return agent.models?.find((model) => model.id === id)?.label ?? id;
}

/** Picking an agent card. Re-picking the selected agent is a no-op rather than
 *  a deselect — the origin had no "no agent" affordance once one was chosen,
 *  and silently clearing it on a stray second click would strand the tab in a
 *  state the operator did not ask for. */
export function nextConfigForAgentSelect(config: ExecutionConfig, agentId: string): ExecutionConfig {
  if (config.localCli.agentId === agentId) return config;
  return { ...config, localCli: { ...config.localCli, agentId } };
}

/** Recording a per-agent model pick. Keyed by agent id so switching agents and
 *  back preserves each one's own choice — see `LocalCliConfig`. */
export function nextConfigForAgentModel(
  config: ExecutionConfig,
  agentId: string,
  model: string,
): ExecutionConfig {
  return {
    ...config,
    localCli: {
      ...config.localCli,
      modelByAgentId: { ...config.localCli.modelByAgentId, [agentId]: model },
    },
  };
}

/** The reasoning-effort id an agent will actually run: the operator's
 *  explicit per-agent pick when they made one, else the first entry of
 *  whatever `reasoningOptions` the host reported, else nothing. Mirrors
 *  `selectedAgentModel` exactly — a reasoning choice is a model-catalog
 *  pick from a second, independent list. */
export function selectedAgentReasoning(config: LocalCliConfig, agent: DetectedAgent): string {
  const chosen = config.reasoningByAgentId?.[agent.id]?.trim();
  if (chosen) return chosen;
  return agent.reasoningOptions?.[0]?.id ?? '';
}

/** Recording a per-agent reasoning-effort pick. Keyed by agent id for the
 *  same cross-contamination reason as `nextConfigForAgentModel`. */
export function nextConfigForAgentReasoning(
  config: ExecutionConfig,
  agentId: string,
  reasoning: string,
): ExecutionConfig {
  return {
    ...config,
    localCli: {
      ...config.localCli,
      reasoningByAgentId: { ...config.localCli.reasoningByAgentId, [agentId]: reasoning },
    },
  };
}

/**
 * Whether the model picker should show its free-text "Custom" input instead
 * of (or alongside) the searchable list. True when the operator explicitly
 * switched to custom mode (a UI-local toggle the host tracks, since it is not
 * itself persisted config — see `LocalCliAgentCard`), when there is nothing
 * to show a resolved value for yet, or when the current value simply isn't
 * one of the agent's known models (a value from an older/different catalog).
 * Origin: `shouldShowCustomModelInput`.
 */
export function shouldShowCustomModelInput(
  modelValue: string,
  knownModelIds: readonly string[],
  explicitCustomMode: boolean,
): boolean {
  return explicitCustomMode || !modelValue || !knownModelIds.includes(modelValue);
}

/** The catalog entries relevant to one agent, in catalog order. Mirrors
 *  `presetsForProtocol`'s "filter the shared catalog down to what THIS
 *  context needs" shape. */
export function cliEnvFieldsForAgent(
  fields: readonly AgentCliEnvFieldSpec[],
  agentId: string,
): readonly AgentCliEnvFieldSpec[] {
  return fields.filter((field) => field.agentId === agentId);
}

/** The operator's current value for one agent's CLI env field, or `''` when
 *  unset — the value an `<input>` should render. */
export function agentCliEnvValue(config: LocalCliConfig, agentId: string, envKey: string): string {
  return config.envByAgentId?.[agentId]?.[envKey] ?? '';
}

/**
 * Setting (or, for a blank value, clearing) one agent's CLI env override.
 * Trims the incoming value the same way `parseMaxTokens`/`isValidApiBaseUrl`
 * treat operator input; a blank result deletes the key rather than storing
 * an empty string, and an agent whose every field is now empty is dropped
 * from the map entirely rather than left as `{}` — origin:
 * `updateAgentCliEnvValue`'s identical empty-object cleanup, minus its
 * AMR-wallet-specific `agentCliEnvIntent`/`apiKeyOverride` side channel,
 * which is product-bound (this package tracks no such intent).
 */
export function nextConfigForAgentCliEnvChange(
  config: ExecutionConfig,
  agentId: string,
  envKey: string,
  rawValue: string,
): ExecutionConfig {
  const value = rawValue.trim();
  const nextAgentEnv = { ...config.localCli.envByAgentId?.[agentId] };
  if (value) {
    nextAgentEnv[envKey] = value;
  } else {
    delete nextAgentEnv[envKey];
  }

  const envByAgentId = { ...config.localCli.envByAgentId };
  if (Object.keys(nextAgentEnv).length > 0) {
    envByAgentId[agentId] = nextAgentEnv;
  } else {
    delete envByAgentId[agentId];
  }

  return { ...config, localCli: { ...config.localCli, envByAgentId } };
}

/** The catalog field (if any) tagged as one agent's executable-path override
 *  — see `AgentCliEnvFieldSpec.kind`. At most one is expected per agent; the
 *  first match wins if a host's catalog carries more than one. */
export function binPathEnvField(
  fields: readonly AgentCliEnvFieldSpec[],
  agentId: string,
): AgentCliEnvFieldSpec | null {
  return fields.find((field) => field.agentId === agentId && field.kind === 'binPath') ?? null;
}

/**
 * Whether a successful agent test unlocks the "use the binary that actually
 * ran" / "clear the override" repair affordance: only when the test
 * REACHED a working binary (`ok: true`) by silently falling back away from a
 * configured override that didn't work (`usedExecutableSource` is one of the
 * two `fallback-*` values) AND the host reported which path that was.
 * Returns `null` for a normal (`'primary'`) run, a failed test (nothing
 * "worked" to offer), or a fallback the host didn't name a path for — a
 * repair affordance with no destination path would be a dead-end button.
 * Origin: `codexPathRepairState`, generalized off one hardcoded agent id —
 * see this file's module doc and `binPathEnvField`.
 */
export function agentExecutableRepairState(result: {
  ok: boolean;
  usedExecutableSource?: AgentExecutableSource | undefined;
  detectedExecutablePath?: string | undefined;
}): AgentExecutableRepair | null {
  if (!result.ok) return null;
  if (result.usedExecutableSource !== 'fallback-invalid' && result.usedExecutableSource !== 'fallback-failed') {
    return null;
  }
  const detectedPath = result.detectedExecutablePath?.trim() || '';
  if (!detectedPath) return null;
  return { detectedPath, canUseDetected: true };
}

/** Case-insensitive substring match against a model's id or label, mirroring
 *  the origin's search box. Matches on both fields (not just the visible
 *  label) so an operator can search by the raw model id too. */
function matchesModelQuery(option: AgentModelOption, query: string): boolean {
  const haystack = `${option.id}\n${option.label}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * Filters a searchable model list down to what matches the operator's typed
 * query. The currently-selected value's own option is always kept even when
 * it no longer matches — hiding the active selection out from under the
 * operator while they type would look like their pick vanished. A blank
 * query returns every option unfiltered. Origin: the `filteredOptions`
 * `useMemo` inside `SearchableModelSelect`.
 */
export function filterAgentModelOptions(
  options: readonly AgentModelOption[],
  query: string,
  selectedValue: string,
): readonly AgentModelOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) => option.id === selectedValue || matchesModelQuery(option, normalized));
}

/** The tooltip text for one `AgentDiagnostic` row: its longer `detail`
 *  followed by every directory PATH detection searched (for the
 *  `'not-on-path'` case), blank lines dropped. Returns `''` when there is
 *  nothing beyond the always-visible one-line `message`. Origin: the
 *  `tooltip` computation inside `AgentDiagnosticRow`. */
export function agentDiagnosticTooltip(diagnostic: AgentDiagnostic): string {
  return [diagnostic.detail, ...(diagnostic.searchedDirs ?? [])]
    .filter((line): line is string => typeof line === 'string' && line.length > 0)
    .join('\n');
}

/**
 * Splits a model id into its base and its reasoning-effort suffix, for a runtime that encodes
 * effort inside the id (`DetectedAgent.reasoningInModelId`).
 *
 * Only a trailing `-<token>` whose token appears in `levelIds` is a level. Everything else stays
 * part of the base id — which is the whole point: `claude-opus-4-6-thinking` ends in `-thinking`,
 * which LOOKS like a modifier and is not an effort level, and reading it as one would invent a
 * `claude-opus-4-6` base that has no variants and a `thinking` level no control can render.
 *
 * @param modelId - A full model id from the agent's own catalog.
 * @param levelIds - The declared effort vocabulary (`reasoningInModelId.levels`, ids only).
 * @returns The base id and the level, or `level: null` when the id carries no recognized suffix.
 * @complexity O(k) in `levelIds.length`.
 */
export function splitReasoningModelId(
  modelId: string,
  levelIds: readonly string[],
): { baseId: string; level: string | null } {
  for (const level of levelIds) {
    const suffix = `-${level}`;
    // `length > suffix.length` rather than `endsWith` alone: an id that is nothing BUT the suffix
    // has no base to split off, and splitting it would merge every such entry into one empty-id
    // group.
    if (modelId.length > suffix.length && modelId.endsWith(suffix)) {
      return { baseId: modelId.slice(0, -suffix.length), level };
    }
  }
  return { baseId: modelId, level: null };
}

/**
 * Strips a trailing effort qualifier from a model label — `Gemini 3.1 Pro (High)` -> `Gemini 3.1
 * Pro` — and only when the label really ends in the qualifier for the level its id carried.
 *
 * Deliberately narrow: it removes a parenthetical only when that parenthetical's contents match
 * THIS entry's own level (by id or by label, case-insensitively). `Claude Sonnet 4.6 (Thinking)`
 * has no level, so nothing is stripped, and a vendor label that happens to end in an unrelated
 * parenthetical keeps it.
 */
function baseLabelForLevel(label: string, level: AgentModelOption | undefined): string {
  if (!level) return label;
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(label);
  if (!match) return label;
  const inner = (match[2] ?? '').trim().toLowerCase();
  if (inner !== level.id.toLowerCase() && inner !== level.label.toLowerCase()) return label;
  const stripped = (match[1] ?? '').trim();
  return stripped || label;
}

/**
 * Groups an agent's model list by base model, recording for each base the effort levels it
 * ACTUALLY has.
 *
 * Derived, never declared — that is the correctness property this function exists for. Verified
 * against `agy models`' real output: `gemini-3.8-flash` has high/medium/low, `gemini-3.1-pro` has
 * ONLY high and low, `gpt-oss-120b` only medium, and `claude-sonnet-4-6` none. A fixed
 * high/medium/low control would offer `gemini-3.1-pro-medium`, which does not exist and which
 * `agy --model` rejects outright. Running the same derivation over whichever list the host
 * supplied — live from the CLI or the def's `fallbackModels` — is also what makes an offline
 * degrade behave consistently rather than differently.
 *
 * @param models - The agent's model catalog, in the order it should be offered.
 * @param levels - The declared effort vocabulary, in display order.
 * @returns One group per base id, in first-appearance order. With an empty vocabulary every id is
 *   its own bare group, so a caller needs no special case for "this agent declares nothing".
 * @complexity O(n * k) in the catalog size and the vocabulary size.
 */
export function reasoningModelGroups(
  models: readonly AgentModelOption[],
  levels: readonly AgentModelOption[],
): ReasoningModelGroup[] {
  const levelIds = levels.map((level) => level.id);
  const byBase = new Map<string, { label: string; ids: Map<string, string>; bare?: string }>();
  for (const model of models) {
    const { baseId, level } = splitReasoningModelId(model.id, levelIds);
    const existing = byBase.get(baseId);
    const entry = existing ?? { label: baseLabelForLevel(model.label, levels.find((l) => l.id === level)), ids: new Map<string, string>() };
    if (level === null) {
      // A base listed on its own AND with variants keeps both: the bare id is the "no effort
      // stated" choice, the variants are the stated ones.
      entry.bare = model.id;
    } else {
      entry.ids.set(level, model.id);
    }
    if (!existing) byBase.set(baseId, entry);
  }
  return [...byBase.entries()].map(([baseId, entry]) => ({
    baseId,
    label: entry.label,
    // Ordered by the DECLARED vocabulary, not by catalog order, so the control's option order is
    // stable across bases even if a CLI ever lists one base's variants in a different order.
    levels: levels.filter((level) => entry.ids.has(level.id)),
    modelIdByLevel: Object.fromEntries(entry.ids),
    ...(entry.bare !== undefined ? { bareModelId: entry.bare } : {}),
  }));
}

/** The group a full model id belongs to, or `null` when the id is not in this catalog at all — a
 *  saved pick from an older/different catalog must not be silently attached to some other base. */
export function reasoningModelGroupFor(
  groups: readonly ReasoningModelGroup[],
  modelId: string,
  levelIds: readonly string[],
): ReasoningModelGroup | null {
  if (!modelId) return null;
  const { baseId } = splitReasoningModelId(modelId, levelIds);
  return groups.find((group) => group.baseId === baseId) ?? null;
}

/**
 * Recombines a base model and an effort level back into one model id — the value `--model`
 * actually receives.
 *
 * Never composes a string: every id it can return came out of the agent's own catalog. That is
 * what makes "switch base while a level is selected" safe — carrying `medium` from
 * `gemini-3.8-flash` over to `gemini-3.1-pro` cannot produce `gemini-3.1-pro-medium`, because
 * that base's table has no `medium` entry and the fallback below lands on a level it does have.
 *
 * @param group - The target base's derived group.
 * @param level - The level to prefer, or `null` for "no preference".
 * @returns An id from the catalog: the requested level's, else the base's bare id, else its first
 *   available level's, else the bare base id (only reachable for a group built from nothing).
 * @complexity O(1).
 */
export function modelIdForReasoningLevel(group: ReasoningModelGroup, level: string | null): string {
  if (level) {
    const exact = group.modelIdByLevel[level];
    if (exact) return exact;
  }
  if (group.bareModelId !== undefined) return group.bareModelId;
  const first = group.levels[0];
  return first ? (group.modelIdByLevel[first.id] ?? group.baseId) : group.baseId;
}
