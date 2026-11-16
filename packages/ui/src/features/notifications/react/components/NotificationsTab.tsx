import type { CSSProperties } from 'react';
import {
  agentHandleProps,
  agentSubHandle,
  buildAgentListHandles,
} from '@jini-ai/core/agent-handles';
import { useT } from '../../../i18n/index.js';
import {
  FAILURE_SOUNDS,
  SUCCESS_SOUNDS,
  playSound,
} from '../../../../utils/notifications.js';
import { testStatusLabel } from '../../rules.js';
import { useNotificationsTab } from './NotificationsTab.hooks.js';
import type { NotificationsPreferences } from '../../types.js';
import type { SoundOption } from '../../notifications-catalog.js';

export interface NotificationsTabLabels {
  completionSoundTitle?: string;
  completionSoundHint?: string;
  successSoundLabel?: string;
  failureSoundLabel?: string;
  desktopTitle?: string;
  desktopHint?: string;
  desktopUnsupported?: string;
  desktopBlocked?: string;
  sendTestLabel?: string;
  testSentLabel?: string;
  testFailedLabel?: string;
  activeLabel?: string;
  offLabel?: string;
}

export interface NotificationsTabProps {
  preferences: NotificationsPreferences;
  onChange: (patch: Partial<NotificationsPreferences>) => void;
  /** Title/body for the "send a test notification" action. Defaults to
   *  plain-English copy wrapped through `useT()`. */
  testNotificationTitle?: string;
  testNotificationBody?: string;
  labels?: NotificationsTabLabels;
  /** This tab's own agent handle — see other tabs' `agentHandle` doc for the split. */
  agentHandle?: string;
}

/**
 * Completion-sound toggle/picker + browser desktop-notification permission
 * flow. Origin: `NotificationsSection` in `SettingsDialog.tsx` — GENERIC,
 * browser-API only (`Notification`/`AudioContext` via this package's own
 * `utils/notifications.ts`), zero product-domain coupling.
 *
 * The "send test notification" button (and the `TestStatus` it reports,
 * imported from this feature's own `rules.ts`) only ever renders while
 * `desktopEnabled && permission === 'granted'` (the JSX gate below), and
 * `sendTestNotification`'s own `setPermission(notificationPermission())`
 * resync re-reads that same non-granted state in the same tick whenever
 * `showCompletionNotification` returns 'permission-denied'/'unsupported' —
 * closing the gate this status line renders behind before either result
 * could ever actually be shown. Confirmed this isn't an extraction
 * regression: the origin `NotificationsSection`/`testNotificationStatusText`
 * in `SettingsDialog.tsx` has the identical gate-plus-resync shape, so
 * 'settings.notifyDesktopBlocked'/'settings.notifyDesktopUnsupported' were
 * already dead there too — which is why `TestStatus` itself is narrowed to
 * 'sent'/'failed' rather than carrying unreachable members (see its own doc
 * comment in this feature's `rules.ts`).
 */
export function NotificationsTab({
  preferences,
  onChange,
  testNotificationTitle,
  testNotificationBody,
  labels,
  agentHandle,
}: NotificationsTabProps) {
  const t = useT();
  const { permission, testStatus, completionSoundTitle, completionSoundHint, successSoundLabel, failureSoundLabel, desktopTitle, desktopHint, desktopUnsupported, desktopBlocked, sendTestLabel, testSentLabel, testFailedLabel, activeLabel, offLabel, toggleSound, toggleDesktop, sendTestNotification } = useNotificationsTab({ preferences, onChange, testNotificationTitle, testNotificationBody, labels, t });

  return (
    <section className="jini-settings-section jini-settings-notifications">
      <div className="jini-settings-subsection">
        <div className="jini-settings-notify-card">
          <div className="jini-settings-notify-card-header">
            <h4>{completionSoundTitle}</h4>
            <NotificationToggle
              title={completionSoundTitle}
              enabled={preferences.soundEnabled}
              onToggle={toggleSound}
              activeLabel={activeLabel}
              offLabel={offLabel}
              agentHandle={agentHandle}
              action="sound-toggle"
            />
          </div>
          <p className="jini-hint">{completionSoundHint}</p>
        </div>

        {preferences.soundEnabled ? (
          <>
            <SoundPicker
              label={successSoundLabel}
              sounds={SUCCESS_SOUNDS}
              selectedSoundId={preferences.successSoundId}
              preferenceKey="successSoundId"
              onChange={onChange}
              previewSound={playSound}
              agentHandle={agentHandle}
              action="success-sound"
            />
            <SoundPicker
              label={failureSoundLabel}
              sounds={FAILURE_SOUNDS}
              selectedSoundId={preferences.failureSoundId}
              preferenceKey="failureSoundId"
              onChange={onChange}
              previewSound={playSound}
              agentHandle={agentHandle}
              action="failure-sound"
            />
          </>
        ) : null}
      </div>

      <div className="jini-settings-subsection">
        <div className="jini-settings-notify-card">
          <div className="jini-settings-notify-card-header">
            <h4>{desktopTitle}</h4>
            <NotificationToggle
              title={desktopTitle}
              enabled={preferences.desktopEnabled}
              onToggle={toggleDesktop}
              activeLabel={activeLabel}
              offLabel={offLabel}
              agentHandle={agentHandle}
              action="desktop-toggle"
              disabled={permission === 'unsupported'}
            />
          </div>
          <p className="jini-hint">{desktopHint}</p>
        </div>
        {permission === 'unsupported' ? <p className="jini-hint">{desktopUnsupported}</p> : null}
        {permission === 'denied' ? <p className="jini-hint">{desktopBlocked}</p> : null}
        {preferences.desktopEnabled && permission === 'granted' ? (
          <>
            <button
              type="button"
              className="jini-button jini-button-ghost"
              onClick={() => {
                void sendTestNotification();
              }}
              {...agentHandleProps({}, { base: agentHandle, ...({ action: 'send-test', role: 'button', label: sendTestLabel }) })}
            >
              {sendTestLabel}
            </button>
            {testStatus ? (
              <p className="jini-hint" role="status">
                {testStatusLabel(testStatus, { testSentLabel, testFailedLabel })}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function NotificationToggle({
  title, enabled, onToggle, activeLabel, offLabel, agentHandle, action, disabled,
}: {
  title: string;
  enabled: boolean;
  onToggle: () => void | Promise<void>;
  activeLabel: string;
  offLabel: string;
  agentHandle: string | undefined;
  action: 'sound-toggle' | 'desktop-toggle';
  disabled?: boolean;
}) {
  return (
    <div className="jini-seg-control" role="group" aria-label={title} style={{ '--seg-cols': 1 } as CSSProperties}>
      <button
        type="button"
        className={'jini-seg-btn' + (enabled ? ' active' : '')}
        aria-pressed={enabled}
        aria-label={title}
        disabled={disabled}
        onClick={() => { void onToggle(); }}
        {...agentHandleProps({}, { base: agentHandle, action, role: 'button', label: title })}
      >
        <span className="jini-seg-title">{enabled ? activeLabel : offLabel}</span>
      </button>
    </div>
  );
}

function SoundPicker({
  label, sounds, selectedSoundId, preferenceKey, onChange, previewSound, agentHandle, action,
}: {
  label: string;
  sounds: SoundOption[];
  selectedSoundId: string;
  preferenceKey: 'successSoundId' | 'failureSoundId';
  onChange: NotificationsTabProps['onChange'];
  previewSound: typeof playSound;
  agentHandle: string | undefined;
  action: 'success-sound' | 'failure-sound';
}) {
  const t = useT();
  const handles = agentHandle
    ? buildAgentListHandles({ prefix: agentSubHandle({ base: agentHandle, action }), ids: sounds.map((sound) => sound.id) })
    : undefined;
  return (
    <div className="jini-settings-field">
      <label>{label}</label>
      <div className="jini-seg-control" role="group" aria-label={label} style={{ '--seg-cols': sounds.length } as CSSProperties}>
        {sounds.map((sound, index) => (
          <button
            key={sound.id}
            type="button"
            className={'jini-seg-btn' + (selectedSoundId === sound.id ? ' active' : '')}
            aria-pressed={selectedSoundId === sound.id}
            onClick={() => {
              onChange({ [preferenceKey]: sound.id });
              previewSound(sound.id);
            }}
            {...agentHandleProps({}, { base: handles?.[index], role: 'button', label: t(sound.labelKey) })}
          >
            <span className="jini-seg-title">{t(sound.labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
