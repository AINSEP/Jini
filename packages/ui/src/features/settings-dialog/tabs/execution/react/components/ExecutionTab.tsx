import type { CSSProperties } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import { DEFAULT_PROVIDER_PRESETS } from '../../constants.js';
import type { ExecutionPort } from '../../ports.js';
import {
  groupPresets,
  isProviderConfigured,
  nextConfigForModeChange,
  nextConfigForPresetSelect,
  resolveSelectedPreset,
} from '../../rules.js';
import type { ExecutionConfig, ExecutionMode, ProviderPreset } from '../../types.js';
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
  autoDetect = true,
  ariaLabel,
}: ExecutionTabProps) {
  const t = useT();
  const { agents, scan, connectionTest, models, rescan, testConnection, canRescan } = useExecutionTab({
    port,
    autoDetect: autoDetect && config.mode === 'local-cli',
  });

  const selectedPreset = resolveSelectedPreset(presets, config.byok);
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
        <LocalCliAgentList agents={agents} scan={scan} onRescan={canRescan ? rescan : undefined} />
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
            models={models}
            connectionTest={connectionTest}
            onTestConnection={() => testConnection(config.byok)}
          />
        </section>
      )}
    </div>
  );
}
