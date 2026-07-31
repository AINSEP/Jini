import { CUSTOM_PRESET_ID, DEFAULT_BASE_URL_BY_PROTOCOL } from './constants.js';
import type {
  ByokConfig,
  ByokProviderCredentials,
  ByokRequiredField,
  DetectedAgent,
  ExecutionConfig,
  ExecutionMode,
  LocalCliConfig,
  ProviderPreset,
} from './types.js';

/**
 * Pure decision logic for the execution tab. Everything here is total and
 * side-effect free so the React layer stays a thin renderer — same split the
 * `privacy` and `integrations` tabs use.
 */

/** Accepts only absolute http(s) URLs. Origin: `isValidApiBaseUrl`. A blank
 *  string is *not* valid here; callers decide whether blank is allowed (it is,
 *  for fixed-origin gateways, which resolve their own endpoint). */
export function isValidApiBaseUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
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
