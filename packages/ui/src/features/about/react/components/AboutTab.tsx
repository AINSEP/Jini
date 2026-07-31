import { useMemo, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { deriveAboutUpdateControl, isAboutUpdateActionDisabled } from '@jini-ai/ui-core';
import type { AboutUpdatePrimaryAction, AppVersionInfo, UpdaterModel } from '@jini-ai/ui-core';
import { useSilentUpdatesToggle } from '../hooks/useSilentUpdatesToggle.js';

/**
 * Superset of ui-core's `AppVersionInfo` with plain desktop-build facts that
 * carry no branching logic of their own — `channel`/`platform`/`arch` are
 * rendered verbatim and never inspected, so they don't belong in ui-core's
 * pure state machine (see `deriveAboutUpdateControl`, which only reads
 * `version`/`packaged`). All three are optional: a host with nothing to
 * report for one just omits that row.
 */
export interface AboutAppVersionInfo extends AppVersionInfo {
  channel?: string;
  platform?: string;
  arch?: string;
}

export interface AboutTabLabels {
  versionLabel?: string;
  runtimeLabel?: string;
  packagedLabel?: string;
  developmentLabel?: string;
  channelLabel?: string;
  platformLabel?: string;
  archLabel?: string;
  releaseLinkLabel?: string;
  actionFailedLabel?: string;
  versionUnavailableLabel?: string;
  silentUpdatesLabel?: string;
  silentUpdatesHint?: string;
}

export interface AboutTabProps {
  /** `null` while version info hasn't loaded (or isn't obtainable) — renders
   *  an empty-state card with nothing else, same as the origin. */
  appVersionInfo: AboutAppVersionInfo | null;
  /** Kept host-side (e.g. behind the host's own subscription to platform
   *  update events) and passed down as a controlled prop; this tab never
   *  mutates it directly. */
  updaterModel: UpdaterModel;
  /**
   * Performs whichever action `deriveAboutUpdateControl` currently offers
   * (check/download/install/quit). The host owns the real platform bridge
   * and is responsible for advancing `updaterModel` afterward (its own
   * subscription is the natural place); this tab only tracks the in-flight
   * promise to disable the button and surface a generic failure.
   */
  onPerformUpdateAction: (action: AboutUpdatePrimaryAction) => Promise<void>;
  /** Opens the release notes / changelog link. Origin hardcoded this to
   *  Open Design's own GitHub releases page — host-supplied here instead,
   *  same convention as `ProviderPreset`/`LocaleOption`. */
  onOpenReleaseLink: () => void;
  /** Seed value for the "allow silent updates" toggle. Ignored (and the
   *  toggle itself not rendered) when `onSilentUpdatePreferenceChange` is
   *  omitted. Defaults to `false` if the handler is present but this isn't. */
  allowSilentUpdates?: boolean;
  /** Persists the "allow silent updates" preference. The toggle is absent
   *  entirely — not merely disabled — when this is omitted, since there is
   *  nothing for it to write through. See `useSilentUpdatesToggle` for the
   *  optimistic-write/rollback/race-safety behaviour behind it. */
  onSilentUpdatePreferenceChange?: (allow: boolean) => Promise<void>;
  labels?: AboutTabLabels;
}

/**
 * App version + auto-update panel, plus the "allow silent updates"
 * preference. Origin: the `activeSection === 'about'` block in
 * `SettingsDialog.tsx` (~5509-5644) — everything up through the silent-
 * updates toggle (see `packages/ui-core/src/tabs/about/` for what "already
 * ported" means here). Diagnostics export and the onboarding-reset button
 * that OD's dialog stacks below this are separate, single-callback concerns
 * with no state machine of their own — left for whoever mounts this tab to
 * compose in (diagnostics export already exists generically as
 * `ExportDiagnosticsButton`).
 *
 * Update-control derivation is ui-core's `deriveAboutUpdateControl`/
 * `isAboutUpdateActionDisabled`; the silent-updates toggle's optimistic-
 * write/rollback/race-safety is `useSilentUpdatesToggle`. This component
 * only renders their results and owns the one thing that's genuinely
 * render-local: whether an update action this tab itself kicked off is
 * still in flight.
 *
 * @complexity O(1) — fixed-shape render, no iteration.
 */
export function AboutTab({
  appVersionInfo,
  updaterModel,
  onPerformUpdateAction,
  onOpenReleaseLink,
  allowSilentUpdates = false,
  onSilentUpdatePreferenceChange,
  labels,
}: AboutTabProps) {
  const t = useT();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const silentUpdates = useSilentUpdatesToggle({ allowSilentUpdates, onSilentUpdatePreferenceChange });

  const control = useMemo(
    () => deriveAboutUpdateControl(updaterModel, appVersionInfo ?? null),
    [updaterModel, appVersionInfo],
  );
  const actionDisabled = isAboutUpdateActionDisabled(control, updaterModel, actionBusy);

  const versionLabel = labels?.versionLabel ?? t('Version');
  const runtimeLabel = labels?.runtimeLabel ?? t('Runtime');
  const packagedLabel = labels?.packagedLabel ?? t('Packaged');
  const developmentLabel = labels?.developmentLabel ?? t('Development build');
  const channelLabel = labels?.channelLabel ?? t('Channel');
  const platformLabel = labels?.platformLabel ?? t('Platform');
  const archLabel = labels?.archLabel ?? t('Architecture');
  const releaseLinkLabel = labels?.releaseLinkLabel ?? t('View releases');
  const actionFailedLabel = labels?.actionFailedLabel ?? t('Something went wrong. Try again.');
  const versionUnavailableLabel = labels?.versionUnavailableLabel ?? t('Version information is unavailable.');
  const silentUpdatesLabel = labels?.silentUpdatesLabel ?? t('Install updates automatically');
  const silentUpdatesHint = labels?.silentUpdatesHint ?? t('Apply updates in the background without asking first.');

  const statusText = t(control.statusKey, control.statusVars);
  const primaryLabel = control.primaryLabelKey ? t(control.primaryLabelKey) : null;
  // Origin styled 'download'/'install'/'quit' as primary and left 'check'
  // plain; simplified to "any actionable state reads as primary, any inert
  // one reads as ghost" — same visual intent, one fewer hardcoded branch,
  // and it falls straight out of a field `deriveAboutUpdateControl` already
  // computes rather than re-deriving OD's three-way action match.
  const primaryButtonClassName = `jini-button${control.primaryAction ? ' jini-button-primary' : ' jini-button-ghost'}`;

  // `handlePrimaryAction` only exists when there is an action to run — it is
  // `undefined` in every state that renders the button disabled-and-inert
  // (e.g. "downloading"), so there is no dead "disabled but somehow clicked"
  // branch to guard against inside the handler itself.
  const { primaryAction } = control;
  const handlePrimaryAction =
    primaryAction == null
      ? undefined
      : () => {
          setActionBusy(true);
          setActionFailed(false);
          void onPerformUpdateAction(primaryAction).then(
            () => setActionBusy(false),
            () => {
              setActionBusy(false);
              setActionFailed(true);
            },
          );
        };

  return (
    <section className="jini-settings-section jini-settings-about">
      {appVersionInfo ? (
        <dl className="jini-settings-about-list">
          <div className="jini-settings-about-version-row">
            <div className="jini-settings-about-version-copy">
              <dt>{versionLabel}</dt>
              <span className="jini-settings-about-version-num">{appVersionInfo.version}</span>
              <dd
                aria-live="polite"
                className={`jini-settings-about-status jini-settings-about-status--${control.statusTone}`}
              >
                {statusText}
              </dd>
            </div>
            <div className="jini-settings-about-actions">
              {primaryLabel ? (
                <button
                  type="button"
                  className={primaryButtonClassName}
                  disabled={actionDisabled}
                  onClick={handlePrimaryAction}
                  data-testid="about-update-action"
                >
                  {primaryLabel}
                </button>
              ) : null}
              {control.showReleaseLink ? (
                <button
                  type="button"
                  className="jini-button jini-button-ghost"
                  onClick={onOpenReleaseLink}
                  data-testid="about-release-link"
                >
                  {releaseLinkLabel}
                </button>
              ) : null}
            </div>
          </div>

          {actionFailed ? (
            <p className="jini-hint jini-settings-about-error" role="status">
              {actionFailedLabel}
            </p>
          ) : null}

          <div>
            <dt>{runtimeLabel}</dt>
            <dd>{appVersionInfo.packaged === false ? developmentLabel : packagedLabel}</dd>
          </div>
          {appVersionInfo.channel ? (
            <div>
              <dt>{channelLabel}</dt>
              <dd>{appVersionInfo.channel}</dd>
            </div>
          ) : null}
          {appVersionInfo.platform ? (
            <div>
              <dt>{platformLabel}</dt>
              <dd>{appVersionInfo.platform}</dd>
            </div>
          ) : null}
          {appVersionInfo.arch ? (
            <div>
              <dt>{archLabel}</dt>
              <dd>{appVersionInfo.arch}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <div className="jini-empty-card">{versionUnavailableLabel}</div>
      )}

      {onSilentUpdatePreferenceChange ? (
        <div className="jini-settings-subsection jini-settings-about-silent-updates">
          <label className="jini-settings-about-toggle">
            <input
              type="checkbox"
              checked={silentUpdates.allowSilentUpdates}
              disabled={silentUpdates.busy}
              onChange={(event) => silentUpdates.toggle(event.currentTarget.checked)}
              data-testid="about-silent-updates-toggle"
            />
            <span className="jini-settings-about-toggle-copy">
              <span>{silentUpdatesLabel}</span>
              <span className="jini-hint">{silentUpdatesHint}</span>
            </span>
          </label>
        </div>
      ) : null}
    </section>
  );
}
