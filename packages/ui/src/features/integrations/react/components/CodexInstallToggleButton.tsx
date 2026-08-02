import { useT } from '../../../i18n/index.js';
import type { McpIntegrationsPort } from '../../ports.js';
import { useCodexInstallToggle } from '../hooks/useCodexInstallToggle.js';

export interface CodexInstallToggleButtonProps {
  port: Pick<McpIntegrationsPort, 'fetchCodexInstallStatus' | 'installCodexMcp' | 'uninstallCodexMcp'>;
}

/**
 * One-click Codex MCP install/uninstall button. Renders nothing until the
 * initial status check resolves, and nothing at all if the host's port
 * doesn't support Codex one-click install (falls back to snippet-copy-only,
 * same as every other client).
 */
export function CodexInstallToggleButton({ port }: CodexInstallToggleButtonProps) {
  const t = useT();
  const { available, installed, busy, error, successKind, toggle } = useCodexInstallToggle(port);

  if (available === null) return null;

  if (!available) {
    return (
      <div className="jini-codex-install-row">
        <button type="button" className="jini-button" disabled>
          {t('One-click install')}
        </button>
        <span className="jini-hint">{t('Not available for this daemon.')}</span>
      </div>
    );
  }

  const label = installed ? t('Uninstall') : t('One-click install');

  return (
    <div className="jini-codex-install-row">
      <button type="button" className={installed ? 'jini-button' : 'jini-button jini-button-primary'} disabled={busy} onClick={toggle}>
        {busy ? t('Working…') : label}
      </button>
      {error ? <span className="jini-hint jini-hint-error">{t('Install failed: {error}', { error })}</span> : null}
      {!error && successKind === 'installed' ? <span className="jini-hint">{t('MCP server installed.')}</span> : null}
      {!error && successKind === 'uninstalled' ? <span className="jini-hint">{t('MCP server uninstalled.')}</span> : null}
    </div>
  );
}
