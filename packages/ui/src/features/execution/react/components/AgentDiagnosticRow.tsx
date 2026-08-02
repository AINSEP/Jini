import { useT } from '../../../i18n/index.js';
import { agentDiagnosticTooltip } from '../../rules.js';
import type { AgentDiagnostic, AgentFixIntent } from '../../types.js';
import { Icon } from '../../../../react/components/Icon.js';
import type { IconName } from '../../../../react/components/Icon.js';

/**
 * Handlers the host wires per fix intent. Each is optional: a button only
 * renders when both the diagnostic carries the intent AND a handler is
 * supplied — so the same row works wherever a host has fewer affordances
 * wired (e.g. a host with no rescan endpoint simply omits `onRescan`).
 */
export interface AgentDiagnosticRowHandlers {
  onRescan?: (() => void) | undefined;
  onOpenInstall?: (() => void) | undefined;
  onOpenDocs?: (() => void) | undefined;
}

export interface AgentDiagnosticRowProps {
  diagnostic: AgentDiagnostic;
  handlers?: AgentDiagnosticRowHandlers | undefined;
  className?: string | undefined;
}

interface ResolvedAction {
  key: string;
  label: string;
  icon: IconName;
  onClick: () => void;
}

/**
 * Maps one typed fix intent to a concrete icon button. `'setEnv'`/
 * `'clearEnv'`/`'launchOAuth'` intentionally resolve to no button — same as
 * the origin this was ported from: those three are part of the typed
 * contract (a host CAN attach `fixActions` carrying them) but have no wired
 * UI yet in either codebase. The diagnostic's own `message` still names what
 * to do (e.g. "Set CODEX_BIN to a valid path"), so the operator is not left
 * without guidance — this row just doesn't yet offer a one-click button for
 * those three.
 */
function resolveAction(
  intent: AgentFixIntent,
  handlers: AgentDiagnosticRowHandlers,
  labels: { install: string; docs: string; rescan: string },
): ResolvedAction | null {
  switch (intent.kind) {
    case 'openInstall':
      return handlers.onOpenInstall
        ? { key: 'openInstall', label: labels.install, icon: 'download', onClick: handlers.onOpenInstall }
        : null;
    case 'openDocs':
      return handlers.onOpenDocs
        ? { key: 'openDocs', label: labels.docs, icon: 'file', onClick: handlers.onOpenDocs }
        : null;
    case 'rescan':
      return handlers.onRescan
        ? { key: 'rescan', label: labels.rescan, icon: 'reload', onClick: handlers.onRescan }
        : null;
    case 'setEnv':
    case 'clearEnv':
    case 'launchOAuth':
      return null;
  }
}

/**
 * Presents a single agent diagnostic as "one-line reason + fix button(s)".
 * The tooltip carries the longer `detail` plus every searched PATH directory
 * (`agentDiagnosticTooltip`), so the card stays one line without discarding
 * either.
 *
 * Origin: OD's `components/AgentDiagnosticRow.tsx`, ported without its CSS
 * module (this package's convention is plain `jini-*` class names, styled
 * once at the host/theme layer — see every sibling component in this tab)
 * and with `onSetEnv`/`onClearEnv` handlers dropped from the props contract
 * (rather than accepted-and-unused) since neither this port nor the origin
 * wires them to anything yet — see `resolveAction`'s doc.
 */
export function AgentDiagnosticRow({ diagnostic, handlers = {}, className }: AgentDiagnosticRowProps) {
  const t = useT();
  const labels = {
    install: t('Install'),
    docs: t('Docs'),
    rescan: t('Rescan'),
  };
  const actions = (diagnostic.fixActions ?? [])
    .map((intent) => resolveAction(intent, handlers, labels))
    .filter((action): action is ResolvedAction => action !== null);
  const tooltip = agentDiagnosticTooltip(diagnostic);

  return (
    <div
      className={['jini-agent-diagnostic', `is-${diagnostic.severity}`, className].filter(Boolean).join(' ')}
      role="group"
      data-reason={diagnostic.reason}
    >
      <span className="jini-agent-diagnostic-message" title={tooltip || undefined}>
        {diagnostic.message}
      </span>
      {actions.length > 0 ? (
        <div className="jini-agent-diagnostic-actions">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="jini-agent-diagnostic-action"
              onClick={action.onClick}
              title={action.label}
              aria-label={action.label}
            >
              <Icon name={action.icon} size={14} strokeWidth={1.8} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
