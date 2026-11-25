import { useCallback, useEffect, useState } from 'react';
import { groupPresets, isProviderConfigured, isValidApiBaseUrl, nextConfigForModeChange, nextConfigForPresetSelect, resolveSelectedPreset } from '../../rules.js';
import type { ByokConfig, ExecutionConfig, ExecutionMode, ExecutionPort, ProviderPreset } from '@jini-ai/core/contracts/execution';
import { useExecutionTab } from '../hooks/useExecutionTab.js';

type DiscoveryEndpoint = Pick<ByokConfig, 'providerId' | 'protocol' | 'baseUrl'>;
type CommitBaseUrl = ({ endpoint }: { readonly endpoint: DiscoveryEndpoint }, _optional?: Record<string, never>) => void;
type IsBaseUrlApproved = ({ endpoint }: { readonly endpoint: DiscoveryEndpoint }, _optional?: Record<string, never>) => boolean;

/** One approval slot per provider/protocol pair; JSON keeps `null` (Custom) distinct from any id. */
function endpointPairKey({ providerId, protocol }: DiscoveryEndpoint, _optional = {}): string {
  return JSON.stringify([providerId, protocol]);
}

/** The trimmed URL discovery may be approved for, or `null` when it is not a complete, allowed URL. */
function approvableBaseUrl({ baseUrl }: DiscoveryEndpoint, _optional = {}): string | null {
  const trimmed = baseUrl.trim();
  return trimmed && isValidApiBaseUrl({ raw: trimmed }) ? trimmed : null;
}

/**
 * B216: model discovery sends the provider key to the Base URL, so it may only go to a URL the
 * operator explicitly committed (blur, Enter, a preset's own default, Test connection). A parseable
 * URL and a pause do not establish intent: `https://api.ex` parses, and people pause mid-word. And
 * preset selection can carry a draft across identities, so approval belongs to the exact provider,
 * protocol and URL — never to "the identity changed". Holds URLs only; a key never enters this state.
 */
function useEndpointApproval({ initial }: { initial: DiscoveryEndpoint }, _optional = {}) {
  // Seeding exception: the host's initial endpoint is the one the server already uses for runs, so
  // approving it adds no new egress — even when an autosaving host persisted a half-typed value
  // before a reload. Read once on mount only: never from `savedByProviderId`, never from a later
  // prop rerender, either of which would turn an unreviewed URL into an approved one.
  const [approved, setApproved] = useState<ReadonlyMap<string, string>>(() => {
    const seed = approvableBaseUrl(initial);
    return new Map(seed === null ? [] : [[endpointPairKey(initial), seed]]);
  });
  const isBaseUrlApproved = useCallback<IsBaseUrlApproved>(({ endpoint }) => {
    const trimmed = endpoint.baseUrl.trim();
    // Blank is the host's own default endpoint for every pair, not an operator-supplied destination.
    return !trimmed || approved.get(endpointPairKey(endpoint)) === trimmed;
  }, [approved]);
  const commitBaseUrl = useCallback<CommitBaseUrl>(({ endpoint }) => {
    const url = approvableBaseUrl(endpoint);
    if (url === null) return;
    const key = endpointPairKey(endpoint);
    // Same pair and URL keeps the same Map, so React bails out and no discovery is re-scheduled.
    setApproved((current) => (current.get(key) === url ? current : new Map(current).set(key, url)));
  }, []);
  return { isBaseUrlApproved, commitBaseUrl };
}

/** Wire execution state and preserve the existing model-discovery triggers. */
export function useExecutionTabView({ config, onConfigChange, port, presets, autoDetect, canDiscoverModels, describeProbeError }: {
  config: ExecutionConfig; onConfigChange: (config: ExecutionConfig) => void; port: ExecutionPort;
  presets: readonly ProviderPreset[]; autoDetect: boolean; canDiscoverModels: boolean; describeProbeError: ((error: unknown) => string) | undefined;
}, _optional = {}) {
  const tab = useExecutionTab({
    port,
    autoDetect: autoDetect && config.mode === 'local-cli',
    ...(describeProbeError ? { describeProbeError } : {}),
  });
  const { loadModels, resetModelDiscovery } = tab;

  const selectedPreset = resolveSelectedPreset({ presets, config: config.byok });

  /**
   * Whether a key EXISTS, never what it is. Keyed on the boolean specifically so the effect below
   * re-runs exactly once on the `false -> true` transition — a saved key hydrating from storage
   * after first paint, or an operator finishing entry — and NOT once per character, which is what
   * keying on `apiKey` itself would have done.
   */
  const hasApiKey = config.byok.apiKey.trim().length > 0;

  // Re-discover models whenever the selected endpoint changes (preset pick,
  // manual protocol switch, or a Base URL the operator committed), and
  // once a key first becomes available (`hasApiKey`).
  //
  // Still deliberately NOT keyed on `apiKey`'s VALUE or on `model` — refetching
  // on every keystroke would spam the provider (and this catalog's own
  // discovery has been observed tripping Gemini's per-minute "Model operations"
  // rate limit, which then presents as an ordinary discovery failure).
  //
  // `hasApiKey` is what makes this effect self-healing. Before it, a discovery
  // attempt that ran before any key existed left its error on screen forever —
  // typing or saving a key changes none of `protocol`/`baseUrl`/`providerId`,
  // so nothing re-triggered it, and the Model field silently fell back to the
  // preset's short static `preferredModels` list while the operator's key could
  // actually see far more. Reported live: the field defaulted to a stale
  // `gemini-2.5-flash` even though `Test Key` — the one control that did force
  // a fresh attempt, see `ByokProviderForm`'s `onTestConnection` below —
  // returned 42 models.
  //
  // `canDiscoverModels` is read here but is deliberately not a dependency — see that prop's doc for why
  // its turning `true` on its own must never probe.
  //
  // Keyed on the APPROVED Base URL, never the typed one (B216): see `useEndpointApproval`. `null`
  // while the current pair and URL are unapproved; the trimmed URL (blank for the host default)
  // otherwise — and that trimmed value, not the raw input, is what the probe receives.
  const { isBaseUrlApproved, commitBaseUrl } = useEndpointApproval({ initial: config.byok });
  const approvedBaseUrl = isBaseUrlApproved({ endpoint: config.byok }) ? config.byok.baseUrl.trim() : null;
  useEffect(() => {
    if (config.mode !== 'byok' || typeof port.listModels !== 'function' || !canDiscoverModels) return;
    if (approvedBaseUrl === null) return;
    loadModels({ ...config.byok, baseUrl: approvedBaseUrl });
  }, [config.mode, port, loadModels, config.byok.protocol, approvedBaseUrl, config.byok.providerId, hasApiKey]);

  // All a turn to "cannot discover" does: drop the current result and any response still in flight —
  // e.g. one started before the host learned that its stored key belongs to another endpoint.
  useEffect(() => {
    if (!canDiscoverModels) resetModelDiscovery();
  }, [canDiscoverModels, resetModelDiscovery]);
  // No "local-cli while unavailable" guard here: `ExecutionModeSwitch` renders that tab `disabled`
  // whenever `localCliUnavailableReason` is set, and React never dispatches `onClick` for a disabled
  // button, so `setMode('local-cli')` cannot be reached in that state.
  const setMode = (mode: ExecutionMode) => {
    onConfigChange(nextConfigForModeChange({ config, mode }));
  };

  return { tab, selectedPreset, setMode, commitBaseUrl, isBaseUrlApproved };
}

/** Derive BYOK chip state and apply the selected preset through the existing rules. */
export function useByokPane({ config, onConfigChange, presets, selectedPreset, commitBaseUrl }: {
  config: ExecutionConfig; onConfigChange: (config: ExecutionConfig) => void; presets: readonly ProviderPreset[]; selectedPreset: ProviderPreset | null;
  commitBaseUrl: CommitBaseUrl;
}, _options = {}) {
  const { protocols, gateways } = groupPresets({ presets });
  const configuredPresetIds = new Set(
    presets.filter((preset) => isProviderConfigured({ config: config.byok, preset })).map((preset) => preset.id),
  );
  const selectPreset = (preset: ProviderPreset) => {
    const next = nextConfigForPresetSelect({ config: config.byok, preset });
    // A deliberate pick of a preset's OWN default endpoint is the operator choosing that endpoint.
    // A carried Custom draft or a restored saved non-default URL is not; it stays unapproved unless
    // that exact pair and URL were already approved.
    if (!preset.custom && next.baseUrl.trim() === (preset.baseUrl ?? '').trim()) {
      commitBaseUrl({ endpoint: { providerId: next.providerId, protocol: next.protocol, baseUrl: next.baseUrl } });
    }
    onConfigChange({ ...config, byok: next });
  };
  const selectedPresetId = selectedPreset?.id ?? null;
  return { protocols, gateways, configuredPresetIds, selectPreset, selectedPresetId };
}
