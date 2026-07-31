import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import {
  FAILURE_SOUNDS,
  SUCCESS_SOUNDS,
  notificationPermission,
  playSound,
  requestNotificationPermission,
  showCompletionNotification,
} from '../../../../../../utils/notifications.js';
import type { NotificationsPreferences, TestStatus } from '@jini-ai/ui-core';
import { testStatusLabel } from '@jini-ai/ui-core';

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
}

/**
 * Completion-sound toggle/picker + browser desktop-notification permission
 * flow. Origin: `NotificationsSection` in `SettingsDialog.tsx` — GENERIC,
 * browser-API only (`Notification`/`AudioContext` via this package's own
 * `utils/notifications.ts`), zero product-domain coupling.
 *
 * The "send test notification" button (and the `TestStatus` it reports,
 * imported from `@jini-ai/ui-core`) only ever renders while
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
 * comment in ui-core).
 */
export function NotificationsTab({ preferences, onChange, testNotificationTitle, testNotificationBody, labels }: NotificationsTabProps) {
  const t = useT();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => notificationPermission());
  const [testStatus, setTestStatus] = useState<TestStatus | null>(null);

  const completionSoundTitle = labels?.completionSoundTitle ?? t('Completion sound');
  const completionSoundHint = labels?.completionSoundHint ?? t('Play a sound when a task finishes.');
  const successSoundLabel = labels?.successSoundLabel ?? t('Success sound');
  const failureSoundLabel = labels?.failureSoundLabel ?? t('Failure sound');
  const desktopTitle = labels?.desktopTitle ?? t('Desktop notifications');
  const desktopHint = labels?.desktopHint ?? t('Show a system notification when a task finishes.');
  const desktopUnsupported = labels?.desktopUnsupported ?? t('Desktop notifications are not supported in this browser.');
  const desktopBlocked = labels?.desktopBlocked ?? t('Desktop notifications are blocked. Enable them in your browser settings.');
  const sendTestLabel = labels?.sendTestLabel ?? t('Send test notification');
  const testSentLabel = labels?.testSentLabel ?? t('Test notification sent.');
  const testFailedLabel = labels?.testFailedLabel ?? t('Could not send a test notification.');
  const activeLabel = labels?.activeLabel ?? t('On');
  const offLabel = labels?.offLabel ?? t('Off');

  const toggleSound = () => {
    const next = !preferences.soundEnabled;
    onChange({ soundEnabled: next });
    if (next) playSound(preferences.successSoundId);
  };

  const toggleDesktop = async () => {
    if (preferences.desktopEnabled) {
      onChange({ desktopEnabled: false });
      return;
    }
    const result = await requestNotificationPermission();
    setPermission(result);
    onChange({ desktopEnabled: result === 'granted' });
  };

  const sendTestNotification = async () => {
    const result = await showCompletionNotification({
      status: 'succeeded',
      title: testNotificationTitle ?? t('Test successful'),
      body: testNotificationBody ?? t('This is what a completion notification looks like.'),
    });
    setPermission(notificationPermission());
    // Only 'shown' vs. everything-else is a distinction this component can
    // ever actually show — see this component's own doc comment above for
    // why 'permission-denied'/'unsupported' collapse into the same "failed"
    // outcome here rather than getting their own dead states.
    setTestStatus(result === 'shown' ? 'sent' : 'failed');
  };

  return (
    <section className="jini-settings-section jini-settings-notifications">
      <div className="jini-settings-subsection">
        <div className="jini-settings-notify-card">
          <div className="jini-settings-notify-card-header">
            <h4>{completionSoundTitle}</h4>
            <div
              className="jini-seg-control"
              role="group"
              aria-label={completionSoundTitle}
              style={{ '--seg-cols': 1 } as CSSProperties}
            >
              <button
                type="button"
                className={'jini-seg-btn' + (preferences.soundEnabled ? ' active' : '')}
                aria-pressed={preferences.soundEnabled}
                aria-label={completionSoundTitle}
                onClick={toggleSound}
              >
                <span className="jini-seg-title">{preferences.soundEnabled ? activeLabel : offLabel}</span>
              </button>
            </div>
          </div>
          <p className="jini-hint">{completionSoundHint}</p>
        </div>

        {preferences.soundEnabled ? (
          <>
            <div className="jini-settings-field">
              <label>{successSoundLabel}</label>
              <div
                className="jini-seg-control"
                role="group"
                aria-label={successSoundLabel}
                style={{ '--seg-cols': SUCCESS_SOUNDS.length } as CSSProperties}
              >
                {SUCCESS_SOUNDS.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    className={'jini-seg-btn' + (preferences.successSoundId === sound.id ? ' active' : '')}
                    aria-pressed={preferences.successSoundId === sound.id}
                    onClick={() => {
                      onChange({ successSoundId: sound.id });
                      playSound(sound.id);
                    }}
                  >
                    <span className="jini-seg-title">{t(sound.labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="jini-settings-field">
              <label>{failureSoundLabel}</label>
              <div
                className="jini-seg-control"
                role="group"
                aria-label={failureSoundLabel}
                style={{ '--seg-cols': FAILURE_SOUNDS.length } as CSSProperties}
              >
                {FAILURE_SOUNDS.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    className={'jini-seg-btn' + (preferences.failureSoundId === sound.id ? ' active' : '')}
                    aria-pressed={preferences.failureSoundId === sound.id}
                    onClick={() => {
                      onChange({ failureSoundId: sound.id });
                      playSound(sound.id);
                    }}
                  >
                    <span className="jini-seg-title">{t(sound.labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="jini-settings-subsection">
        <div className="jini-settings-notify-card">
          <div className="jini-settings-notify-card-header">
            <h4>{desktopTitle}</h4>
            <div
              className="jini-seg-control"
              role="group"
              aria-label={desktopTitle}
              style={{ '--seg-cols': 1 } as CSSProperties}
            >
              <button
                type="button"
                className={'jini-seg-btn' + (preferences.desktopEnabled ? ' active' : '')}
                aria-pressed={preferences.desktopEnabled}
                aria-label={desktopTitle}
                disabled={permission === 'unsupported'}
                onClick={() => {
                  void toggleDesktop();
                }}
              >
                <span className="jini-seg-title">{preferences.desktopEnabled ? activeLabel : offLabel}</span>
              </button>
            </div>
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
