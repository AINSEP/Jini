import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import * as notifications from '../../../../../utils/notifications.js';
import { DEFAULT_NOTIFICATIONS_PREFERENCES } from '../../../constants.js';
import type { NotificationsPreferences } from '../../../types.js';
import { NotificationsTab, type NotificationsTabLabels, type NotificationsTabProps } from '../NotificationsTab.js';

vi.mock('../../../../../utils/notifications.js', async (importOriginal) => ({
  ...await importOriginal<typeof notifications>(),
  notificationPermission: vi.fn<typeof notifications.notificationPermission>(),
  requestNotificationPermission: vi.fn<typeof notifications.requestNotificationPermission>(),
  showCompletionNotification: vi.fn<typeof notifications.showCompletionNotification>(),
  playSound: vi.fn<typeof notifications.playSound>(),
}));

const labels: Required<NotificationsTabLabels> = {
  completionSoundTitle: 'Completion title', completionSoundHint: 'Completion hint',
  successSoundLabel: 'Success choices', failureSoundLabel: 'Failure choices',
  desktopTitle: 'Desktop title', desktopHint: 'Desktop hint',
  desktopUnsupported: 'Unsupported hint', desktopBlocked: 'Blocked hint',
  sendTestLabel: 'Send example', testSentLabel: 'Example sent', testFailedLabel: 'Example failed',
  activeLabel: 'Enabled', offLabel: 'Disabled',
};

function mount({ preferences = {}, ...props }: Omit<Partial<NotificationsTabProps>, 'preferences'> & {
  preferences?: Partial<NotificationsPreferences>;
}, _options: Record<string, never> = {}) {
  const onChange = vi.fn<NotificationsTabProps['onChange']>();
  return {
    ...render(<NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, ...preferences }} onChange={onChange} {...props} />),
    onChange,
  };
}

beforeEach(() => {
  vi.mocked(notifications.notificationPermission).mockReturnValue('granted');
  vi.mocked(notifications.requestNotificationPermission).mockResolvedValue('granted');
  vi.mocked(notifications.showCompletionNotification).mockResolvedValue('shown');
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('NotificationsTab characterization before L141 refactoring', () => {
  it('enables sound and previews the selected success sound, then disables without a preview', async () => {
    const { onChange, rerender } = mount({ preferences: { successSoundId: 'pluck' } });
    expect(screen.queryByRole('group', { name: 'Success sound' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Completion sound' }));
    expect(onChange.mock.calls).toEqual([[{ soundEnabled: true }]]);
    expect(vi.mocked(notifications.playSound).mock.calls).toEqual([['pluck']]);
    rerender(<NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: true }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Completion sound' }));
    expect(onChange.mock.calls).toEqual([[{ soundEnabled: true }], [{ soundEnabled: false }]]);
    expect(vi.mocked(notifications.playSound).mock.calls).toEqual([['pluck']]);
  });

  it.each([undefined, 'notify'])('preserves sound choice order, selection, previews and handles with base %s', async (agentHandle) => {
    const { onChange } = mount({ preferences: { soundEnabled: true }, ...(agentHandle === undefined ? {} : { agentHandle }) });
    expect(screen.getByRole('button', { name: 'Completion sound' }).getAttribute('data-agent-element')).toBe(agentHandle ? 'notify-sound-toggle' : null);
    const groups = [
      { name: 'Success sound', key: 'successSoundId', ids: ['ding', 'chime', 'two-tone-up', 'pluck'], keys: ['ding', 'chime', 'twoToneUp', 'pluck'], action: 'success-sound' },
      { name: 'Failure sound', key: 'failureSoundId', ids: ['buzz', 'two-tone-down', 'thud'], keys: ['buzz', 'twoToneDown', 'thud'], action: 'failure-sound' },
    ];
    for (const group of groups) {
      const control = screen.getByRole('group', { name: group.name });
      expect(control.style.getPropertyValue('--seg-cols')).toBe(String(group.ids.length));
      const buttons = within(control).getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual(group.keys.map((key) => `notifications.sound.${key}`));
      for (const [index, button] of buttons.entries()) {
        expect(button.getAttribute('aria-pressed')).toBe(String(index === 0));
        expect(button.classList.contains('active')).toBe(index === 0);
        expect(button.getAttribute('data-agent-element')).toBe(agentHandle ? `notify-${group.action}-${group.ids[index]}` : null);
        await userEvent.click(button);
        expect(onChange).toHaveBeenLastCalledWith({ [group.key]: group.ids[index] });
        expect(notifications.playSound).toHaveBeenLastCalledWith(group.ids[index]);
      }
    }
  });

  it.each(['default', 'denied', 'unsupported', 'granted'] as const)('gates desktop controls for initial permission %s', (permission) => {
    vi.mocked(notifications.notificationPermission).mockReturnValue(permission);
    mount({ preferences: { desktopEnabled: true }, agentHandle: 'notify' });
    const toggle = screen.getByRole('button', { name: 'Desktop notifications' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(permission === 'unsupported');
    expect(toggle.getAttribute('data-agent-element')).toBe('notify-desktop-toggle');
    expect(screen.queryByText('Desktop notifications are not supported in this browser.') !== null).toBe(permission === 'unsupported');
    expect(screen.queryByText('Desktop notifications are blocked. Enable them in your browser settings.') !== null).toBe(permission === 'denied');
    expect(screen.queryByRole('button', { name: 'Send test notification' }) !== null).toBe(permission === 'granted');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['granted', 'default', 'denied', 'unsupported'] as const)('enables desktop only for a granted permission result: %s', async (permission) => {
    vi.mocked(notifications.notificationPermission).mockReturnValue('default');
    vi.mocked(notifications.requestNotificationPermission).mockResolvedValue(permission);
    const { onChange } = mount({});
    expect(screen.queryByRole('button', { name: 'Send test notification' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Desktop notifications' }));
    expect(vi.mocked(notifications.requestNotificationPermission).mock.calls).toEqual([[]]);
    expect(onChange.mock.calls).toEqual([[{ desktopEnabled: permission === 'granted' }]]);
    expect(screen.getByRole('button', { name: 'Desktop notifications' }).hasAttribute('disabled')).toBe(permission === 'unsupported');
  });

  it('disables desktop without requesting permission', async () => {
    const { onChange } = mount({ preferences: { desktopEnabled: true } });
    await userEvent.click(screen.getByRole('button', { name: 'Desktop notifications' }));
    expect(onChange.mock.calls).toEqual([[{ desktopEnabled: false }]]);
    expect(notifications.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it.each([
    { result: 'shown', permission: 'granted', text: 'Test notification sent.' },
    { result: 'failed', permission: 'granted', text: 'Could not send a test notification.' },
    { result: 'permission-denied', permission: 'denied', text: null },
    { result: 'unsupported', permission: 'unsupported', text: null },
  ] as const)('resynchronizes permission and displays the old send outcome for $result', async ({ result, permission, text }) => {
    vi.mocked(notifications.showCompletionNotification).mockResolvedValue(result);
    mount({ preferences: { desktopEnabled: true } });
    vi.mocked(notifications.notificationPermission).mockReturnValue(permission);
    await userEvent.click(screen.getByRole('button', { name: 'Send test notification' }));
    expect(vi.mocked(notifications.showCompletionNotification).mock.calls).toEqual([[{
      status: 'succeeded', title: 'Test successful', body: 'This is what a completion notification looks like.',
    }]]);
    expect(screen.queryByRole('status')?.textContent ?? null).toBe(text);
    expect(screen.queryByRole('button', { name: 'Send test notification' }) !== null).toBe(permission === 'granted');
  });

  it.each(['Custom content', ''])('preserves explicit test title/body %j and custom status labels', async (content) => {
    mount({ preferences: { desktopEnabled: true }, labels, testNotificationTitle: content, testNotificationBody: content, agentHandle: 'notify' });
    const button = screen.getByRole('button', { name: labels.sendTestLabel });
    expect(button.getAttribute('data-agent-element')).toBe('notify-send-test');
    await userEvent.click(button);
    expect(notifications.showCompletionNotification).toHaveBeenLastCalledWith({ status: 'succeeded', title: content, body: content });
    expect(screen.getByRole('status').textContent).toBe(labels.testSentLabel);
    vi.mocked(notifications.showCompletionNotification).mockResolvedValue('failed');
    await userEvent.click(button);
    expect(screen.getByRole('status').textContent).toBe(labels.testFailedLabel);
  });

  it('uses all host copy, including both permission hints and on/off labels', () => {
    vi.mocked(notifications.notificationPermission).mockReturnValue('unsupported');
    const { onChange } = mount({ preferences: { soundEnabled: true }, labels });
    for (const text of [labels.completionSoundTitle, labels.completionSoundHint, labels.desktopTitle, labels.desktopHint, labels.desktopUnsupported, labels.activeLabel, labels.offLabel]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('group', { name: labels.successSoundLabel })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: labels.failureSoundLabel })).toBeInTheDocument();
    cleanup();
    vi.mocked(notifications.notificationPermission).mockReturnValue('denied');
    render(<NotificationsTab preferences={DEFAULT_NOTIFICATIONS_PREFERENCES} onChange={onChange} labels={labels} />);
    expect(screen.getByText(labels.desktopBlocked)).toBeInTheDocument();
  });

  it('retains empty host labels instead of replacing them with defaults', () => {
    mount({ labels: { completionSoundTitle: '', completionSoundHint: '', activeLabel: '', offLabel: '' } });
    expect(screen.queryByText('Completion sound')).toBeNull();
    expect(screen.queryByText('Play a sound when a task finishes.')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
  });

  it('translates default labels, sound names and notification content', async () => {
    render(<I18nProvider initialLocale="fr" dictionaries={{ fr: {
      'Completion sound': 'Son', 'notifications.sound.ding': 'Ding traduit',
      'Test successful': 'Réussi', 'This is what a completion notification looks like.': 'Exemple',
    } }}><NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: true, desktopEnabled: true }} onChange={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Son' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ding traduit' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send test notification' }));
    expect(notifications.showCompletionNotification).toHaveBeenLastCalledWith({ status: 'succeeded', title: 'Réussi', body: 'Exemple' });
  });
});
