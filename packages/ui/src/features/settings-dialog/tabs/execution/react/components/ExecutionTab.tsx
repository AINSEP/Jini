import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import { DEFAULT_PROVIDER_PRESETS } from '@jini-ai/ui-core';
import type { ExecutionPort } from '@jini-ai/ui-core';
import {
  groupPresets,
  isProviderConfigured,
  nextConfigForAgentModel,
  nextConfigForAgentSelect,
  nextConfigForModeChange,
  nextConfigForPresetSelect,
  resolveSelectedPreset,
  selectedAgentModel,
} from '@jini-ai/ui-core';
import type {
  DetectedAgent,
  ExecutionConfig,
  ExecutionMode,
  ProviderPreset,
} from '@jini-ai/ui-core';
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
  localCliUnavailableReason,
  renderAgentIcon,
  localCliScopeLabel,
  autoDetect = true,
  ariaLabel,
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
    canRescan,
    canTestAgent,
  } = useExecutionTab({
    port,
    autoDetect: autoDetect && config.mode === 'local-cli',
  });

  const selectedPreset = resolveSelectedPreset(presets, config.byok);

  // Re-discover models whenever the selected endpoint changes (preset pick,
  // manual protocol switch, or a typed base URL settling on a new value).
  // Deliberately NOT keyed on `apiKey`/`model` — refetching on every
  // keystroke would spam the provider. An operator who pastes a new key
  // without touching the endpoint can still force a refresh via "Test
  // connection" below; a dedicated "Refresh models" affordance is a
  // reasonable follow-up, not required for the field to be usable and
  // honest about failures now.
  useEffect(() => {
    if (config.mode !== 'byok' || typeof port.listModels !== 'function') return;
    loadModels(config.byok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.mode, port, loadModels, config.byok.protocol, config.byok.baseUrl, config.byok.providerId]);
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
          onRescan={canRescan ? rescan : undefined}
          onTest={
            canTestAgent
              ? (agent) => testAgent(agent.id, selectedAgentModel(config.localCli, agent) || undefined)
              : undefined
          }
          renderAgentIcon={renderAgentIcon}
          scopeLabel={localCliScopeLabel}
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
          />
          <ProviderChipGroup
            label={t('Gateways')}
            presets={gateways}
            selectedPresetId={selectedPreset?.id ?? null}
            configuredPresetIds={configuredPresetIds}
            onSelect={selectPreset}
            configuredLabel={t('Configured')}
            unsetLabel={t('Not configured')}
          />
          <ByokProviderForm
            config={config.byok}
            onConfigChange={(byok) => onConfigChange({ ...config, byok })}
            preset={selectedPreset}
            modelDiscovery={modelDiscovery}
            connectionTest={connectionTest}
            onTestConnection={() => testConnection(config.byok)}
          />
        </section>
      )}
    </div>
  );
}
