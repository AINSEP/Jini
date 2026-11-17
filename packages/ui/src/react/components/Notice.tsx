// Success/error result banner with optional warning count and a collapsible
// install/operation log. Origin: `Notice` in `PluginsView.tsx` (Open
// Design) — genericized `outcome`'s type from OD's `PluginInstallOutcome`
// (a plugin-install-specific wire DTO) to a generic `NoticeOutcome` shape
// carrying the same three optional fields any "ran an operation, got a
// result + warnings + a log" flow would need. Every user-facing string now
// goes through `useT()` — the origin hardcoded "Install log" and the
// warning-count pluralization. See archived UI source map.

import { useT } from '../../features/i18n/index.js';

export interface NoticeOutcome {
  ok: boolean;
  message: string;
  warnings?: string[];
  log?: string[];
}

export interface NoticeProps {
  outcome: NoticeOutcome;
  /** Label for the collapsible log's `<summary>`. Defaults to `t('Install log')`. */
  logLabel?: string;
  className?: string;
  useTHook?: typeof useT;
}

export function Notice({ outcome, logLabel, className, useTHook = useT }: NoticeProps) {
  const t = useTHook();
  const warnings = outcome.warnings ?? [];
  const log = outcome.log ?? [];
  return (
    <div
      className={[
        'plugins-view__notice',
        outcome.ok ? 'is-success' : 'is-error',
        className,
      ].filter(Boolean).join(' ')}
      role="status"
    >
      <div>{outcome.message}</div>
      {warnings.length > 0 ? (
        <div className="plugins-view__notice-sub">
          {warnings.length === 1
            ? t('{n} warning', { n: warnings.length })
            : t('{n} warnings', { n: warnings.length })}
        </div>
      ) : null}
      {log.length > 0 ? (
        <details className="plugins-view__notice-log">
          <summary>{logLabel ?? t('Install log')}</summary>
          <ul>
            {log.map((line, idx) => (
              <li key={`${line}-${idx}`}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
