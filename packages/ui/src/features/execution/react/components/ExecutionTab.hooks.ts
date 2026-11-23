import { useEffect, useState } from 'react';
import { groupPresets, isProviderConfigured, isValidApiBaseUrl, nextConfigForModeChange, nextConfigForPresetSelect, resolveSelectedPreset } from '../../rules.js';
import type { ExecutionConfig, ExecutionMode, ProviderPreset } from '../../types.js';
import type { ExecutionPort } from '../../ports.js';
import { useExecutionTab } from '../hooks/useExecutionTab.js';

/** How long a typed Base URL must stay unchanged before discovery may send the key to it. */
export const BASE_URL_SETTLE_MS = 600;

/**
 * B216: model discovery sends the provider key to the Base URL, so it must only ever go to a URL
 * the operator finished typing — never to `https://ap`, `https://api.ex`, … one keystroke at a time.
 * A typed change counts once it has stayed put for `delayMs`; a preset or protocol switch
 * (`endpointKey` changes) is a deliberate pick and counts at once.
 */
function useSettledBaseUrl({ baseUrl, endpointKey, delayMs }: { baseUrl: string; endpointKey: string; delayMs: number }, _optional = {}): string {
  const [settled, setSettled] = useState({ baseUrl, endpointKey });
  // Adjusting state while rendering (React's "store info from previous renders" pattern): a preset
  // pick must not wait out the typing delay, nor run one render with the old URL.
  if (settled.endpointKey !== endpointKey) setSettled({ baseUrl, endpointKey });
  useEffect(() => {
    const timer = settled.baseUrl === baseUrl ? undefined : setTimeout(() => setSettled({ baseUrl, endpointKey }), delayMs);
    return () => clearTimeout(timer);
  }, [baseUrl, endpointKey, delayMs, settled.baseUrl]);
  return settled.endpointKey === endpointKey ? settled.baseUrl : baseUrl;
}

/** True when discovery may send the key to this Base URL: it has settled and is blank (the host's
 *  default endpoint) or a complete, allowed URL. */
function mayProbeBaseUrl({ baseUrl, settledBaseUrl }: { baseUrl: string; settledBaseUrl: string }, _optional = {}): boolean {
  return baseUrl === settledBaseUrl && (!baseUrl.trim() || isValidApiBaseUrl({ raw: baseUrl }));
}

/** Wire execution state and preserve the existing model-discovery triggers. */
export function useExecutionTabView({ config, onConfigChange, port, presets, autoDetect, canDiscoverModels, describeProbeError }: {
  config: ExecutionConfig; onConfigChange: (config: ExecutionConfig) => void; port: ExecutionPort;
  presets: readonly ProviderPreset[]; autoDetect: boolean; canDiscoverModels: boolean; describeProbeError: ((error: unknown) => string) | undefined;
}, { baseUrlSettleMs = BASE_URL_SETTLE_MS }: { baseUrlSettleMs?: number } = {}) {
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
  // manual protocol switch, or a typed base URL settling on a new value), and
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
  // Keyed on the SETTLED Base URL, not the typed one (B216): see `useSettledBaseUrl`.
  const settledBaseUrl = useSettledBaseUrl({ baseUrl: config.byok.baseUrl, endpointKey: `${config.byok.providerId}\n${config.byok.protocol}`, delayMs: baseUrlSettleMs });
  useEffect(() => {
    if (config.mode !== 'byok' || typeof port.listModels !== 'function' || !canDiscoverModels) return;
    if (!mayProbeBaseUrl({ baseUrl: config.byok.baseUrl, settledBaseUrl })) return;
    loadModels(config.byok);
  }, [config.mode, port, loadModels, config.byok.protocol, settledBaseUrl, config.byok.providerId, hasApiKey]);

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

  return { tab, selectedPreset, setMode };
}

/** Derive BYOK chip state and apply the selected preset through the existing rules. */
export function useByokPane({ config, onConfigChange, presets, selectedPreset }: {
  config: ExecutionConfig; onConfigChange: (config: ExecutionConfig) => void; presets: readonly ProviderPreset[]; selectedPreset: ProviderPreset | null;
}, _options = {}) {
  const { protocols, gateways } = groupPresets({ presets });
  const configuredPresetIds = new Set(
    presets.filter((preset) => isProviderConfigured({ config: config.byok, preset })).map((preset) => preset.id),
  );
  const selectPreset = (preset: ProviderPreset) =>
    onConfigChange({ ...config, byok: nextConfigForPresetSelect({ config: config.byok, preset }) });
  const selectedPresetId = selectedPreset?.id ?? null;
  return { protocols, gateways, configuredPresetIds, selectPreset, selectedPresetId };
}
