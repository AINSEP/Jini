import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { agentHandleProps, agentSubHandle } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import { DEFAULT_AGENT_CLI_ENV_FIELDS, DEFAULT_PROVIDER_PRESETS } from '../../constants.js';
import type { ExecutionPort } from '../../ports.js';
import {
  groupPresets,
  isProviderConfigured,
  nextConfigForAgentCliEnvChange,
  nextConfigForAgentModel,
  nextConfigForAgentReasoning,
  nextConfigForAgentSelect,
  nextConfigForModeChange,
  nextConfigForPresetSelect,
  resolveSelectedPreset,
  selectedAgentModel,
} from '../../rules.js';
import type {
  AgentCliEnvFieldSpec,
  DetectedAgent,
  ExecutionConfig,
  ExecutionMode,
  ProviderPreset,
} from '../../types.js';
import { useExecutionTab } from '../hooks/useExecutionTab.js';
import { ByokProviderForm } from './ByokProviderForm.js';
import { LocalCliAgentList } from './LocalCliAgentList.js';
import { ProviderChipGroup } from './ProviderChipGroup.js';

export interface ExecutionTabProps {
  config: ExecutionConfig;
  onConfigChange: (config: ExecutionConfig) => void;
  port: ExecutionPort;
  /** Endpoint catalog. Defaults to this package's small starter set — a host
   *  with its own provider list passes it here rather than editing ours. */
  presets?: readonly ProviderPreset[];
  /** Per-agent CLI env-var catalog (proxy URLs, custom config dirs, a
   *  binary-path override). Defaults to this package's starter set for the
   *  CLIs it already knows about — a host with a different/larger agent
   *  roster passes its own, same convention as `presets`. */
  cliEnvFields?: readonly AgentCliEnvFieldSpec[];
  /** Disables Local CLI with an explanatory title, for hosts that cannot run
   *  local subprocesses (e.g. a hosted deployment). */
  localCliUnavailableReason?: string;
  /** Rendered in each agent card's icon slot — vendor marks are the host's to
   *  supply, since this package ships no logo set. */
  renderAgentIcon?: (agent: DetectedAgent) => ReactNode;
  /** Where local-CLI detection actually runs, in the host's words. See
   *  `LocalCliAgentListProps.scopeLabel` — a hosted deployment must not tell
   *  the operator these are the CLIs "on this machine". */
  localCliScopeLabel?: string;
  autoDetect?: boolean;
  ariaLabel?: string;
  /**
   * Pass-throughs to the internal `ByokProviderForm`'s identically-named props — see that
   * component's own doc comments for the full contract (write-only credential display, the
   * placeholder-never-a-value safety property, and the footer slot).
   *
   * Added here rather than only on `ByokProviderForm` because a host whose BYOK config is
   * ALSO offering Local CLI (the common case — see `types.ts`'s `ExecutionMode`) has no way to
   * reach `ByokProviderForm` directly: it is `ExecutionTab` that owns the mode switch and
   * renders the BYOK section conditionally. Without these, a host storing its admin's own key
   * server-side (as opposed to the visitor-key screen, which renders `ByokProviderForm` on its
   * own because it has no Local CLI option to switch away from) would have to fork this
   * component to add write-only display — exactly the mistake one host integration already made
   * and reverted. Omitted by every existing caller, so the rendered output is byte-identical
   * without them.
   */
  apiKeyFooter?: ReactNode;
  formFooter?: ReactNode;
  apiKeyStoredExternally?: boolean;
  apiKeyPlaceholder?: string;
  /**
   * Whether the tab may run model discovery right now. Defaults to `true`.
   *
   * For a host that holds a key the browser cannot read and knows that key cannot be used at the
   * selected endpoint, e.g. a key its backend saved for another provider and refuses to send anywhere
   * else. With nothing typed, discovery then has nothing it may send, so the tab stays idle instead of
   * showing that refusal.
   *
   * Read when discovery would run anyway (an endpoint change, a key typed or cleared, Test connection)
   * and deliberately NOT a trigger of its own. A host flips it to `true` when its stored key is
   * re-pointed at the selected endpoint, and probing on that flip alone would send the key there
   * without the operator asking. Turning it `false` only resets discovery to idle and discards any
   * response still in flight, which sends nothing.
   */
  canDiscoverModels?: boolean;
  /** Pass-through to `useExecutionTab`'s `describeProbeError` — see that option's doc. Words a failed
   *  model discovery and a failed Test connection. */
  describeProbeError?: (error: unknown) => string;
  /**
   * This tab's own agent handle, published by the host. Every interactive control below — the mode
   * switch, every provider chip, the whole BYOK card, and every detected-CLI card — derives its own
   * `data-agent-*` handle from this ONE base via `agentHandleProps`/`agentSubHandle`. Omit and no
   * `data-agent-*` markup is emitted anywhere in this tab — additive, never a behavior change.
   */
  agentHandle?: string;
}

/**
 * "Execution mode" — the Local CLI ↔ bring-your-own-key switch, its provider
 * and gateway chip rows, and the BYOK credential form.
 *
 * Controlled: the host owns `config` and persists it however it likes (in the
 * canary host that is a settings ledger). The tab owns only the async edges,
 * via `ExecutionPort`.
 *
 * Origin: `SettingsDialog.tsx` lines 4080-5336. The origin's managed-runtime
 * wallet — balance polling, top-up, sign-in coachmarks — is deliberately not
 * ported; it is product-bound, not generic.
 */
export function ExecutionTab({
  config,
  onConfigChange,
  port,
  presets = DEFAULT_PROVIDER_PRESETS,
  cliEnvFields = DEFAULT_AGENT_CLI_ENV_FIELDS,
  localCliUnavailableReason,
  renderAgentIcon,
  localCliScopeLabel,
  autoDetect = true,
  ariaLabel,
  apiKeyFooter,
  formFooter,
  apiKeyStoredExternally,
  apiKeyPlaceholder,
  canDiscoverModels = true,
  describeProbeError,
  agentHandle,
}: ExecutionTabProps) {
  const t = useT();
  const {
    agents,
    scan,
    connectionTest,
    modelDiscovery,
    agentTest,
    rescan,
    testConnection,
    testAgent,
    loadModels,
    resetModelDiscovery,
    canRescan,
    canTestAgent,
  } = useExecutionTab({
    port,
    autoDetect: autoDetect && config.mode === 'local-cli',
    ...(describeProbeError ? { describeProbeError } : {}),
  });

  const selectedPreset = resolveSelectedPreset(presets, config.byok);

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
  useEffect(() => {
    if (config.mode !== 'byok' || typeof port.listModels !== 'function' || !canDiscoverModels) return;
    loadModels(config.byok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.mode, port, loadModels, config.byok.protocol, config.byok.baseUrl, config.byok.providerId, hasApiKey]);

  // All a turn to "cannot discover" does: drop the current result and any response still in flight —
  // e.g. one started before the host learned that its stored key belongs to another endpoint.
  useEffect(() => {
    if (!canDiscoverModels) resetModelDiscovery();
  }, [canDiscoverModels, resetModelDiscovery]);
  const { protocols, gateways } = groupPresets(presets);
  const configuredPresetIds = new Set(
    presets.filter((preset) => isProviderConfigured(config.byok, preset)).map((preset) => preset.id),
  );

  const localCliDisabled = Boolean(localCliUnavailableReason);
  const setMode = (mode: ExecutionMode) => {
    if (mode === 'local-cli' && localCliDisabled) return;
    onConfigChange(nextConfigForModeChange(config, mode));
  };
  const selectPreset = (preset: ProviderPreset) =>
    onConfigChange({ ...config, byok: nextConfigForPresetSelect(config.byok, preset) });

  const modes: ReadonlyArray<{ id: ExecutionMode; title: string; meta: string }> = [
    { id: 'local-cli', title: t('Local CLI'), meta: t('Run an agent installed on this machine') },
    { id: 'byok', title: t('BYOK'), meta: t('Use your own API credentials') },
  ];

  return (
    <div className="jini-settings-execution" aria-label={ariaLabel ?? t('Execution mode')}>
      <div
        className="jini-seg-control"
        role="tablist"
        aria-label={t('Execution mode')}
        style={{ '--seg-cols': modes.length } as CSSProperties}
      >
        {modes.map((mode) => {
          const disabled = mode.id === 'local-cli' && localCliDisabled;
          return (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={config.mode === mode.id}
              disabled={disabled}
              title={disabled ? localCliUnavailableReason : undefined}
              className={'jini-seg-btn' + (config.mode === mode.id ? ' active' : '')}
              onClick={() => setMode(mode.id)}
              {...agentHandleProps(agentHandle, { action: `mode-${mode.id}`, role: 'button', label: mode.title })}
            >
              <span className="jini-seg-title">{mode.title}</span>
              <span className="jini-seg-meta">
                {disabled ? localCliUnavailableReason : mode.meta}
              </span>
            </button>
          );
        })}
      </div>

      {config.mode === 'local-cli' ? (
        <LocalCliAgentList
          agents={agents}
          config={config.localCli}
          scan={scan}
          agentTest={agentTest}
          onSelect={(agentId) => onConfigChange(nextConfigForAgentSelect(config, agentId))}
          onModelChange={(agentId, model) =>
            onConfigChange(nextConfigForAgentModel(config, agentId, model))
          }
          onReasoningChange={(agentId, reasoning) =>
            onConfigChange(nextConfigForAgentReasoning(config, agentId, reasoning))
          }
          onEnvChange={(agentId, envKey, value) =>
            onConfigChange(nextConfigForAgentCliEnvChange(config, agentId, envKey, value))
          }
          cliEnvFields={cliEnvFields}
          onRescan={canRescan ? rescan : undefined}
          onTest={
            canTestAgent
              ? (agent) => testAgent(agent.id, selectedAgentModel(config.localCli, agent) || undefined)
              : undefined
          }
          renderAgentIcon={renderAgentIcon}
          scopeLabel={localCliScopeLabel}
          {...(agentHandle ? { agentHandle: agentSubHandle(agentHandle, 'local-cli') } : {})}
        />
      ) : (
        <section className="jini-settings-section jini-settings-byok">
          <ProviderChipGroup
            label={t('Protocols')}
            presets={protocols}
            selectedPresetId={selectedPreset?.id ?? null}
            configuredPresetIds={configuredPresetIds}
            onSelect={selectPreset}
            configuredLabel={t('Configured')}
            unsetLabel={t('Not configured')}
            {...(agentHandle ? { agentHandle: agentSubHandle(agentHandle, 'protocol') } : {})}
          />
          <ProviderChipGroup
            label={t('Gateways')}
            presets={gateways}
            selectedPresetId={selectedPreset?.id ?? null}
            configuredPresetIds={configuredPresetIds}
            onSelect={selectPreset}
            configuredLabel={t('Configured')}
            unsetLabel={t('Not configured')}
            {...(agentHandle ? { agentHandle: agentSubHandle(agentHandle, 'gateway') } : {})}
          />
          <ByokProviderForm
            config={config.byok}
            onConfigChange={(byok) => onConfigChange({ ...config, byok })}
            preset={selectedPreset}
            {...(agentHandle ? { agentHandle: agentSubHandle(agentHandle, 'byok') } : {})}
            // The WHOLE catalog, not the `protocols`/`gateways` halves the chip rows take: the card
            // only reads it to recognise a pasted key as some other row's, and a key pasted from a
            // gateway into a protocol field is exactly the mistake worth naming.
            presets={presets}
            modelDiscovery={modelDiscovery}
            connectionTest={connectionTest}
            // Also re-runs discovery with the CURRENT byok config, not just the
            // connectivity probe — see this file's model-discovery effect above
            // for why that matters: a stale "could not load live models" error
            // from before this key existed (or from any earlier transient
            // failure) would otherwise never clear, even once Test Connection
            // itself goes green with the same config.
            onTestConnection={() => {
              testConnection(config.byok);
              if (canDiscoverModels && typeof port.listModels === 'function') loadModels(config.byok);
            }}
            {...(apiKeyFooter !== undefined ? { apiKeyFooter } : {})}
            {...(formFooter !== undefined ? { formFooter } : {})}
            {...(apiKeyStoredExternally !== undefined ? { apiKeyStoredExternally } : {})}
            {...(apiKeyPlaceholder !== undefined ? { apiKeyPlaceholder } : {})}
          />
        </section>
      )}
    </div>
  );
}
