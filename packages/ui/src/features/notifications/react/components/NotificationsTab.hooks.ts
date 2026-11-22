import { useState } from 'react';
import type { useT } from '../../../i18n/index.js';
import { notificationPermission, playSound, requestNotificationPermission, showCompletionNotification } from '../../../../utils/notifications.js';
import type { TestStatus } from '../../rules.js';
import type { NotificationsPreferences } from '../../types.js';
import type { NotificationsTabLabels } from './NotificationsTab.js';

/** Resolve copy and manage sound, browser permission, and test-notification actions. */
export function useNotificationsTab({ preferences, onChange, testNotificationTitle, testNotificationBody, labels, t }: {
  preferences: NotificationsPreferences;
  onChange: (patch: Partial<NotificationsPreferences>) => void;
  testNotificationTitle: string | undefined;
  testNotificationBody: string | undefined;
  labels: NotificationsTabLabels | undefined;
  t: ReturnType<typeof useT>;
}, _options = {}) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => notificationPermission());
  const [testStatus, setTestStatus] = useState<TestStatus | null>(null);

  const label = ({ key, fallback }: { key: keyof NotificationsTabLabels; fallback: string }, _options: Record<string, never> = {}) =>
    labels?.[key] ?? t(fallback);

  const completionSoundTitle = label({ key: 'completionSoundTitle', fallback: 'Completion sound' });
  const completionSoundHint = label({ key: 'completionSoundHint', fallback: 'Play a sound when a task finishes.' });
  const successSoundLabel = label({ key: 'successSoundLabel', fallback: 'Success sound' });
  const failureSoundLabel = label({ key: 'failureSoundLabel', fallback: 'Failure sound' });
  const desktopTitle = label({ key: 'desktopTitle', fallback: 'Desktop notifications' });
  const desktopHint = label({ key: 'desktopHint', fallback: 'Show a system notification when a task finishes.' });
  const desktopUnsupported = label({ key: 'desktopUnsupported', fallback: 'Desktop notifications are not supported in this browser.' });
  const desktopBlocked = label({ key: 'desktopBlocked', fallback: 'Desktop notifications are blocked. Enable them in your browser settings.' });
  const sendTestLabel = label({ key: 'sendTestLabel', fallback: 'Send test notification' });
  const testSentLabel = label({ key: 'testSentLabel', fallback: 'Test notification sent.' });
  const testFailedLabel = label({ key: 'testFailedLabel', fallback: 'Could not send a test notification.' });
  const activeLabel = label({ key: 'activeLabel', fallback: 'On' });
  const offLabel = label({ key: 'offLabel', fallback: 'Off' });

  const toggleSound = () => {
    const next = !preferences.soundEnabled;
    onChange({ soundEnabled: next });
    if (next) playSound({ id: preferences.successSoundId });
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

  return { permission, testStatus, completionSoundTitle, completionSoundHint, successSoundLabel, failureSoundLabel, desktopTitle, desktopHint, desktopUnsupported, desktopBlocked, sendTestLabel, testSentLabel, testFailedLabel, activeLabel, offLabel, toggleSound, toggleDesktop, sendTestNotification };
}
