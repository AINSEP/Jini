import type { ReactNode } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import type {
  AgentCliEnvFieldSpec,
  AgentScanState,
  AgentTestState,
  DetectedAgent,
  LocalCliConfig,
} from '@jini-ai/ui-core';
import { LocalCliAgentCard } from './LocalCliAgentCard.js';

export interface LocalCliAgentListProps {
  agents: readonly DetectedAgent[];
  config: LocalCliConfig;
  scan: AgentScanState;
  onSelect: (agentId: string) => void;
  onModelChange: (agentId: string, model: string) => void;
  onReasoningChange: (agentId: string, reasoning: string) => void;
  onEnvChange: (agentId: string, envKey: string, value: string) => void;
  cliEnvFields: readonly AgentCliEnvFieldSpec[];
  onRescan?: (() => void) | undefined;
  onTest?: ((agent: DetectedAgent) => void) | undefined;
  agentTest: AgentTestState;
  renderAgentIcon?: ((agent: DetectedAgent) => ReactNode) | undefined;
  /**
   * Where detection ran, in the host's own words — "on this machine" for a
   * desktop app, "on the server" for a deployed one.
   *
   * This is host-supplied because this package cannot know: the same component
   * backs a local app whose CLIs really are the operator's, and a hosted CMS
   * whose detection runs on the server. Hardcoding "on this machine" made the
   * hosted case state something false. The default below says only what is
   * true in both shapes.
   */
  scopeLabel?: string | undefined;
}

/**
 * The detected code-agent CLIs, as a selectable card grid.
 *
 * Origin: the `daemon`-mode branch of `SettingsDialog.tsx`'s execution tab —
 * its agent group header, rescan control, and card grid. The origin's
 * managed-runtime entry (wallet, sign-in, plan upgrades) is left behind; see
 * `LocalCliAgentCard` for what that split does and does not cover.
 */
export function LocalCliAgentList({
  agents,
  config,
  scan,
  onSelect,
  onModelChange,
  onReasoningChange,
  onEnvChange,
  cliEnvFields,
  onRescan,
  onTest,
  agentTest,
  renderAgentIcon,
  scopeLabel,
}: LocalCliAgentListProps) {
  const t = useT();
  const installed = agents.filter((agent) => agent.installed);
  const scope = scopeLabel ?? t('Runs a code-agent CLI detected by the host.');

  return (
    <section className="jini-settings-section jini-local-cli">
      <div className="jini-section-head">
        <div className="jini-section-head-text">
          <h4 className="jini-agent-group-head">
            {t('Your CLIs')} ({installed.length})
          </h4>
          <p className="jini-field-hint">{t('Pick the CLI that runs your prompts.')}</p>
        </div>
        {onRescan ? (
          <button
            type="button"
            className="jini-btn jini-local-cli-rescan"
            disabled={scan.status === 'scanning'}
            onClick={onRescan}
          >
            {scan.status === 'scanning' ? t('Scanning…') : t('↻ Rescan')}
          </button>
        ) : null}
      </div>

      <p className="jini-field-hint jini-local-cli-scope">{scope}</p>

      {/* A failed scan is reported as a failure and never as an empty result:
          "detection could not run" and "detection found nothing" are different
          answers, and only one of them justifies telling the operator they
          have no CLIs installed. */}
      {scan.status === 'error' ? (
        <p className="jini-field-hint is-error" role="alert">
          {scan.message}
        </p>
      ) : null}

      {scan.status === 'scanning' ? (
        <div className="jini-agent-scan-card" role="status" aria-live="polite">
          <span className="jini-agent-scan-ring" aria-hidden="true" />
          <strong>{t('Scanning for installed agents…')}</strong>
        </div>
      ) : agents.length === 0 ? (
        scan.status === 'error' ? null : (
          <div className="jini-empty-card">{t('No agent CLIs detected.')}</div>
        )
      ) : (
        <div className="jini-agent-grid">
          {agents.map((agent) => (
            <LocalCliAgentCard
              key={agent.id}
              agent={agent}
              config={config}
              selected={config.agentId === agent.id}
              onSelect={onSelect}
              onModelChange={onModelChange}
              onReasoningChange={onReasoningChange}
              onEnvChange={onEnvChange}
              cliEnvFields={cliEnvFields}
              renderIcon={renderAgentIcon}
              onTest={onTest}
              agentTest={agentTest}
              onRescan={onRescan}
            />
          ))}
        </div>
      )}
    </section>
  );
}
