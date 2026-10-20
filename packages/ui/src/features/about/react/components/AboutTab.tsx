import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { deriveAboutUpdateControl, isAboutUpdateActionDisabled } from '../../rules.js';
import type { AboutUpdateControl, AboutUpdatePrimaryAction, AppVersionInfo, UpdaterModel } from '../../types.js';
import { useSilentUpdatesToggle } from '../hooks/useSilentUpdatesToggle.js';
import type { UseSilentUpdatesToggleResult } from '../hooks/useSilentUpdatesToggle.js';

/**
 * Superset of this feature's own `AppVersionInfo` (`../../types.js`) with
 * plain desktop-build facts that carry no branching logic of their own —
 * `channel`/`platform`/`arch` are rendered verbatim and never inspected, so
 * they don't belong in that type's pure state machine (see
 * `deriveAboutUpdateControl`, which only reads `version`/`packaged`). All
 * three are optional: a host with nothing to report for one just omits that
 * row.
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

type Translate = ReturnType<typeof useT>;
type ResolvedAboutTabLabels = Required<AboutTabLabels>;

/** Built-in (untranslated) copy for every label a host may override. */
const DEFAULT_LABELS: ResolvedAboutTabLabels = {
  versionLabel: 'Version',
  runtimeLabel: 'Runtime',
  packagedLabel: 'Packaged',
  developmentLabel: 'Development build',
  channelLabel: 'Channel',
  platformLabel: 'Platform',
  archLabel: 'Architecture',
  releaseLinkLabel: 'View releases',
  actionFailedLabel: 'Something went wrong. Try again.',
  versionUnavailableLabel: 'Version information is unavailable.',
  silentUpdatesLabel: 'Install updates automatically',
  silentUpdatesHint: 'Apply updates in the background without asking first.',
};

const LABEL_KEYS = Object.keys(DEFAULT_LABELS) as Array<keyof AboutTabLabels>;

/** Each label is the host override when given, else the translated default. */
function resolveLabels({ t }: { t: Translate }, { labels }: { labels?: AboutTabLabels | undefined }): ResolvedAboutTabLabels {
  const resolved = { ...DEFAULT_LABELS };
  for (const key of LABEL_KEYS) resolved[key] = labels?.[key] ?? t(DEFAULT_LABELS[key]);
  return resolved;
}

/**
 * The one thing that's genuinely render-local: whether an update action this
 * tab itself kicked off is still in flight, and whether the last one failed.
 */
function useUpdateActionRunner({
  onPerformUpdateAction,
}: Pick<AboutTabProps, 'onPerformUpdateAction'>) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const run = (action: AboutUpdatePrimaryAction) => {
    setActionBusy(true);
    setActionFailed(false);
    void onPerformUpdateAction(action).then(
      () => setActionBusy(false),
      () => {
        setActionBusy(false);
        setActionFailed(true);
      },
    );
  };
  return { actionBusy, actionFailed, run };
}

interface UpdateActionsProps {
  control: AboutUpdateControl;
  primaryLabel: string | null;
  actionDisabled: boolean;
  onPrimaryAction: (() => void) | undefined;
  onOpenReleaseLink: () => void;
  releaseLinkLabel: string;
}

function UpdateActions({
  control,
  primaryLabel,
  actionDisabled,
  onPrimaryAction,
  onOpenReleaseLink,
  releaseLinkLabel,
}: UpdateActionsProps) {
  // Origin styled 'download'/'install'/'quit' as primary and left 'check'
  // plain; simplified to "any actionable state reads as primary, any inert
  // one reads as ghost" — same visual intent, one fewer hardcoded branch,
  // and it falls straight out of a field `deriveAboutUpdateControl` already
  // computes rather than re-deriving OD's three-way action match.
  const primaryButtonClassName = `jini-button${control.primaryAction ? ' jini-button-primary' : ' jini-button-ghost'}`;
  return (
    <div className="jini-settings-about-actions">
      {primaryLabel ? (
        <button
          type="button"
          className={primaryButtonClassName}
          disabled={actionDisabled}
          onClick={onPrimaryAction}
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
  );
}

/** A `<dt>/<dd>` row rendered only when the host supplied a value for it. */
function OptionalFactRow({ label, value }: { label: string; value: string | undefined }) {
  return value ? (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  ) : null;
}

interface VersionDetailsProps {
  appVersionInfo: AboutAppVersionInfo;
  labels: ResolvedAboutTabLabels;
  statusTone: AboutUpdateControl['statusTone'];
  statusText: string;
  actions: ReactNode;
  actionFailed: boolean;
}

function VersionDetails({ appVersionInfo, labels, statusTone, statusText, actions, actionFailed }: VersionDetailsProps) {
  return (
    <dl className="jini-settings-about-list">
      <div className="jini-settings-about-version-row">
        <div className="jini-settings-about-version-copy">
          <dt>{labels.versionLabel}</dt>
          <span className="jini-settings-about-version-num">{appVersionInfo.version}</span>
          <dd aria-live="polite" className={`jini-settings-about-status jini-settings-about-status--${statusTone}`}>
            {statusText}
          </dd>
        </div>
        {actions}
      </div>

      {actionFailed ? (
        <p className="jini-hint jini-settings-about-error" role="status">
          {labels.actionFailedLabel}
        </p>
      ) : null}

      <div>
        <dt>{labels.runtimeLabel}</dt>
        <dd>{appVersionInfo.packaged === false ? labels.developmentLabel : labels.packagedLabel}</dd>
      </div>
      <OptionalFactRow label={labels.channelLabel} value={appVersionInfo.channel} />
      <OptionalFactRow label={labels.platformLabel} value={appVersionInfo.platform} />
      <OptionalFactRow label={labels.archLabel} value={appVersionInfo.arch} />
    </dl>
  );
}

function SilentUpdatesToggle({
  silentUpdates,
  labels,
}: {
  silentUpdates: UseSilentUpdatesToggleResult;
  labels: ResolvedAboutTabLabels;
}) {
  return (
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
          <span>{labels.silentUpdatesLabel}</span>
          <span className="jini-hint">{labels.silentUpdatesHint}</span>
        </span>
      </label>
    </div>
  );
}

/**
 * App version + auto-update panel, plus the "allow silent updates"
 * preference. Origin: the `activeSection === 'about'` block in
 * `SettingsDialog.tsx` (~5509-5644) — everything up through the silent-
 * updates toggle (see this feature's `types.ts`/`rules.ts` for what "already
 * ported" means here). Diagnostics export and the onboarding-reset button
 * that OD's dialog stacks below this are separate, single-callback concerns
 * with no state machine of their own — left for whoever mounts this tab to
 * compose in (diagnostics export already exists generically as
 * `ExportDiagnosticsButton`).
 *
 * Update-control derivation is this feature's own `deriveAboutUpdateControl`/
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
  const { actionBusy, actionFailed, run } = useUpdateActionRunner({ onPerformUpdateAction });
  const silentUpdates = useSilentUpdatesToggle({ allowSilentUpdates, onSilentUpdatePreferenceChange });

  const control = useMemo(
    () => deriveAboutUpdateControl(updaterModel, appVersionInfo),
    [updaterModel, appVersionInfo],
  );
  const actionDisabled = isAboutUpdateActionDisabled(control, updaterModel, actionBusy);
  const resolvedLabels = resolveLabels({ t }, { labels });

  // `handlePrimaryAction` only exists when there is an action to run — it is
  // `undefined` in every state that renders the button disabled-and-inert
  // (e.g. "downloading"), so there is no dead "disabled but somehow clicked"
  // branch to guard against inside the handler itself.
  const { primaryAction } = control;
  const handlePrimaryAction = primaryAction == null ? undefined : () => run(primaryAction);

  return (
    <section className="jini-settings-section jini-settings-about">
      {appVersionInfo ? (
        <VersionDetails
          appVersionInfo={appVersionInfo}
          labels={resolvedLabels}
          statusTone={control.statusTone}
          statusText={t(control.statusKey, control.statusVars)}
          actionFailed={actionFailed}
          actions={
            <UpdateActions
              control={control}
              primaryLabel={control.primaryLabelKey ? t(control.primaryLabelKey) : null}
              actionDisabled={actionDisabled}
              onPrimaryAction={handlePrimaryAction}
              onOpenReleaseLink={onOpenReleaseLink}
              releaseLinkLabel={resolvedLabels.releaseLinkLabel}
            />
          }
        />
      ) : (
        <div className="jini-empty-card">{resolvedLabels.versionUnavailableLabel}</div>
      )}

      {onSilentUpdatePreferenceChange ? <SilentUpdatesToggle silentUpdates={silentUpdates} labels={resolvedLabels} /> : null}
    </section>
  );
}
