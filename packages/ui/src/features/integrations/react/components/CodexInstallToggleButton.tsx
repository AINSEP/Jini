import { agentHandleProps } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import type { McpIntegrationsPort } from '../../ports.js';
import { useCodexInstallToggle, type CodexInstallToggleController } from '../hooks/useCodexInstallToggle.js';

export interface CodexInstallToggleButtonProps {
  port: Pick<McpIntegrationsPort, 'fetchCodexInstallStatus' | 'installCodexMcp' | 'uninstallCodexMcp'>;
  /** This button's own agent handle — see `IntegrationsTab`'s `agentHandle` doc. */
  agentHandle?: string;
}

/**
 * One-click Codex MCP install/uninstall button. Renders nothing until the
 * initial status check resolves, and nothing at all if the host's port
 * doesn't support Codex one-click install (falls back to snippet-copy-only,
 * same as every other client).
 */
export function CodexInstallToggleButton({ port, agentHandle }: CodexInstallToggleButtonProps) {
  const t = useT();
  const { available, installed, busy, error, successKind, toggle } = useCodexInstallToggle(port);

  if (available === null) return null;

  if (!available) return <CodexInstallUnavailableRow />;

  const label = installed ? t('Uninstall') : t('One-click install');

  return (
    <div className="jini-codex-install-row">
      <button
        type="button"
        className={installed ? 'jini-button' : 'jini-button jini-button-primary'}
        disabled={busy}
        onClick={toggle}
        {...agentHandleProps({}, { base: agentHandle, role: 'button', label })}
      >
        {busy ? t('Working…') : label}
      </button>
      <CodexInstallStatusHint error={error} successKind={successKind} />
    </div>
  );
}

/** The row shown when the host's port has no Codex one-click install support. */
function CodexInstallUnavailableRow() {
  const t = useT();
  return (
    <div className="jini-codex-install-row">
      <button type="button" className="jini-button" disabled>
        {t('One-click install')}
      </button>
      <span className="jini-hint">{t('Not available for this daemon.')}</span>
    </div>
  );
}

/** The hint after the last toggle: its error if it failed, else which success it reached, else nothing. */
function CodexInstallStatusHint({ error, successKind }: Pick<CodexInstallToggleController, 'error' | 'successKind'>) {
  const t = useT();
  if (error) return <span className="jini-hint jini-hint-error">{t('Install failed: {error}', { error })}</span>;
  if (successKind === 'installed') return <span className="jini-hint">{t('MCP server installed.')}</span>;
  if (successKind === 'uninstalled') return <span className="jini-hint">{t('MCP server uninstalled.')}</span>;
  return null;
}
