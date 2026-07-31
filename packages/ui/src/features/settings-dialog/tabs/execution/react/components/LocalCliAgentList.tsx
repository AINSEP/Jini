import { useT } from '../../../../../../features/i18n/index.js';
import type { AgentScanState, DetectedAgent } from '../../types.js';

export interface LocalCliAgentListProps {
  agents: readonly DetectedAgent[];
  scan: AgentScanState;
  onRescan?: (() => void) | undefined;
}

/**
 * The detected code-agent CLI list. Origin: the `daemon`-mode branch of
 * `SettingsDialog.tsx`'s execution tab — its agent-scan card, installed/not
 * grouping, and rescan control, minus the origin's per-agent model pickers
 * and managed-runtime sign-in chrome (product-bound, left behind).
 */
export function LocalCliAgentList({ agents, scan, onRescan }: LocalCliAgentListProps) {
  const t = useT();
  const installed = agents.filter((agent) => agent.installed);

  return (
    <section className="jini-settings-section jini-local-cli">
      <div className="jini-section-head">
        <p className="jini-field-hint">
          {t('Runs a code-agent CLI installed on this machine.')}
        </p>
        {onRescan ? (
          <button
            type="button"
            className="jini-btn jini-local-cli-rescan"
            disabled={scan.status === 'scanning'}
            onClick={onRescan}
          >
            {scan.status === 'scanning' ? t('Scanning…') : t('Rescan')}
          </button>
        ) : null}
      </div>

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
        <div className="jini-empty-card">{t('No agent CLIs detected on this machine.')}</div>
      ) : (
        <>
          <h4 className="jini-agent-group-head">
            {t('Installed')} ({installed.length})
          </h4>
          <ul className="jini-agent-list">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className={'jini-agent-row' + (agent.installed ? ' is-installed' : ' is-missing')}
              >
                <span className="jini-agent-row-main">
                  <span className="jini-agent-row-label">{agent.label}</span>
                  {agent.path ? <code className="jini-agent-row-path">{agent.path}</code> : null}
                </span>
                <span className="jini-agent-row-meta">
                  {agent.installed ? (agent.version ?? t('Installed')) : t('Not installed')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
