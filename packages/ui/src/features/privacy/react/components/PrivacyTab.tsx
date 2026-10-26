import { agentHandleProps, agentSubHandle } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import {
  hasMadeConsentDecision,
  nextStateForDeleteMyData,
  nextStateForTelemetryPatch,
} from '../../rules.js';
import type { PrivacyConsentState } from '../../types.js';

export interface PrivacyTabLabels {
  consentKicker?: string;
  consentLead?: string;
  consentFooter?: string;
  metricsLabel?: string;
  metricsHint?: string;
  contentLabel?: string;
  contentHint?: string;
  installationIdLabel?: string;
  installationIdHint?: string;
  optedOutLabel?: string;
  deleteMyDataLabel?: string;
}

export interface PrivacyTabProps {
  state: PrivacyConsentState;
  onChange: (next: PrivacyConsentState) => void;
  labels?: PrivacyTabLabels;
  /** Injectable clock, for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * This tab's own agent handle, published by the host. Every interactive control below derives
   * its own `data-agent-*` handle from this ONE base via `agentHandleProps` — see that function's
   * doc in `@jini-ai/agentic` for the "host names a component, the component names its own parts"
   * split this generalizes. Omit and no `data-agent-*` markup is emitted at all — additive, never a
   * behavior change for a host that doesn't pass it.
   */
  agentHandle?: string;
}

interface ToggleRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** This row's own sub-handle, already derived by the caller — see `PrivacyTab`'s `agentHandle` doc. */
  agentHandle?: string;
}

function ToggleRow({ label, hint, checked, onChange, agentHandle }: ToggleRowProps) {
  return (
    <button
      type="button"
      className={`jini-toggle-row${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      {...agentHandleProps({}, { base: agentHandle, ...({ role: 'checkbox', label }) })}
    >
      <div className="jini-toggle-row-text">
        <span className="jini-toggle-row-label">{label}</span>
        <span className="jini-toggle-row-hint">{hint}</span>
      </div>
      <span className="jini-toggle-row-switch" aria-hidden />
    </button>
  );
}

function resolveConsentLabels(
  { labels }: { labels: PrivacyTabLabels },
  { t }: { t: ReturnType<typeof useT> },
) {
  return {
    consentKicker: labels.consentKicker ?? t('Help improve this product'),
    consentLead: labels.consentLead ?? t('Choose what you share. You can change this anytime.'),
    consentFooter: labels.consentFooter ?? t('Nothing is shared unless you opt in.'),
    metricsLabel: labels.metricsLabel ?? t('Anonymous metrics'),
    metricsHint: labels.metricsHint ?? t('Feature usage and performance data, with no personal content.'),
    contentLabel: labels.contentLabel ?? t('Conversation and tool content'),
    contentHint: labels.contentHint ?? t('Helps improve model quality. Off by default.'),
  };
}

function resolveInstallationLabels(
  { labels }: { labels: PrivacyTabLabels },
  { t }: { t: ReturnType<typeof useT> },
) {
  return {
    installationIdLabel: labels.installationIdLabel ?? t('Installation ID'),
    installationIdHint: labels.installationIdHint ?? t('An anonymous id used to group your shared data.'),
    optedOutLabel: labels.optedOutLabel ?? t('Not sharing'),
    deleteMyDataLabel: labels.deleteMyDataLabel ?? t('Delete my data'),
  };
}

/**
 * Telemetry consent card (two per-category toggles) over a
 * generic `{ metrics, content }` shape, plus an installation-id
 * generate/rotate ("Delete my data") flow. Origin: `PrivacySection.tsx`,
 * mounted by `SettingsDialog.tsx`'s `privacy` tab — flagged "likely
 * generic, not fully verified" by
 * `ADS-memory/reports/jini-port/recon/r6-god-component-internals.md` §1.3; this task is
 * the first full verification (see `packages/ui/source-map.md`).
 */
export function PrivacyTab({ state, onChange, labels, now = Date.now, agentHandle }: PrivacyTabProps) {
  const t = useT();
  const decided = hasMadeConsentDecision(state);

  const labelOverrides = labels ?? {};
  const {
    consentKicker, consentLead, consentFooter,
    metricsLabel, metricsHint, contentLabel, contentHint,
  } = resolveConsentLabels({ labels: labelOverrides }, { t });
  const {
    installationIdLabel, installationIdHint, optedOutLabel, deleteMyDataLabel,
  } = resolveInstallationLabels({ labels: labelOverrides }, { t });

  return (
    <section className="jini-settings-section jini-settings-privacy">
      <div className="jini-settings-subsection">
        <div className="jini-section-head">
          <div>
            <h4>{consentKicker}</h4>
            <p className="jini-hint">{consentLead}</p>
          </div>
        </div>

        {/* One presentation of the two choices: the toggles. A text list plus "Don't share" /
            "Share usage" buttons above them repeated the same two options (owner, 2026-10-26).
            Off is the default, and the first toggle records the decision. */}
        <div className="jini-settings-privacy-toggles">
          <ToggleRow
            label={metricsLabel}
            hint={metricsHint}
            checked={state.telemetry.metrics === true}
            onChange={(v) => onChange(nextStateForTelemetryPatch(state, { metrics: v }, now()))}
            {...(agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action: 'metrics-toggle' }) } : {})}
          />
          <ToggleRow
            label={contentLabel}
            hint={contentHint}
            checked={state.telemetry.content === true}
            onChange={(v) => onChange(nextStateForTelemetryPatch(state, { content: v }, now()))}
            {...(agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action: 'content-toggle' }) } : {})}
          />
        </div>

        <p className="jini-hint">{consentFooter}</p>
      </div>

      {decided ? (
        <div className="jini-settings-subsection">
          <div className="jini-section-head">
            <div>
              <h4>{installationIdLabel}</h4>
              <p className="jini-hint">{installationIdHint}</p>
            </div>
          </div>
          <div className="jini-settings-field">
            <input
              type="text"
              readOnly
              value={state.installationId ?? optedOutLabel}
              aria-label={installationIdLabel}
              {...agentHandleProps({}, { base: agentHandle, ...({ action: 'installation-id', role: 'field', label: installationIdLabel }) })}
            />
          </div>
          <button
            type="button"
            className="jini-button jini-button-ghost"
            onClick={() => onChange(nextStateForDeleteMyData(state, now()))}
            {...agentHandleProps({}, { base: agentHandle, ...({ action: 'delete-my-data', role: 'button', label: deleteMyDataLabel }) })}
          >
            <Icon name="trash" size={13} />
            <span>{deleteMyDataLabel}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
