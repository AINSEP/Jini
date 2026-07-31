import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { DEFAULT_NOTIFICATIONS_PREFERENCES } from '@jini-ai/ui-core';
import { NotificationsTab } from '../../../react/components/NotificationsTab.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationsTab', () => {
  it('toggles the completion-sound master switch', async () => {
    const onChange = vi.fn();
    render(<NotificationsTab preferences={DEFAULT_NOTIFICATIONS_PREFERENCES} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Completion sound/ }));
    expect(onChange).toHaveBeenCalledWith({ soundEnabled: true });
  });

  it('shows sound pickers only when sound is enabled', () => {
    const { rerender } = render(
      <NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: false }} onChange={() => {}} />,
    );
    expect(screen.queryByLabelText('Success sound')).not.toBeInTheDocument();
    rerender(<NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: true }} onChange={() => {}} />);
    expect(screen.getByLabelText('Success sound')).toBeInTheDocument();
    expect(screen.getByLabelText('Failure sound')).toBeInTheDocument();
  });

  it('picks a success sound', async () => {
    const onChange = vi.fn();
    render(
      <NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: true }} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'notifications.sound.chime' }));
    expect(onChange).toHaveBeenCalledWith({ successSoundId: 'chime' });
  });

  it('toggles the completion-sound switch off without playing a sound', async () => {
    const onChange = vi.fn();
    render(
      <NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: true }} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Completion sound/ }));
    expect(onChange).toHaveBeenCalledWith({ soundEnabled: false });
  });

  it('picks a failure sound', async () => {
    const onChange = vi.fn();
    render(
      <NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: true }} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'notifications.sound.thud' }));
    expect(onChange).toHaveBeenCalledWith({ failureSoundId: 'thud' });
  });

  it('shows a "blocked" hint when desktop notification permission was already denied', () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    render(<NotificationsTab preferences={DEFAULT_NOTIFICATIONS_PREFERENCES} onChange={() => {}} />);
    expect(screen.getByText(/blocked/)).toBeInTheDocument();
  });

  it('renders host-supplied labels instead of the built-in defaults', () => {
    vi.stubGlobal('Notification', undefined);
    render(
      <NotificationsTab
        preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, soundEnabled: true }}
        onChange={() => {}}
        labels={{
          completionSoundTitle: 'Custom completion title',
          completionSoundHint: 'Custom completion hint',
          successSoundLabel: 'Custom success label',
          failureSoundLabel: 'Custom failure label',
          desktopTitle: 'Custom desktop title',
          desktopHint: 'Custom desktop hint',
          desktopUnsupported: 'Custom unsupported hint',
          desktopBlocked: 'Custom blocked hint',
          sendTestLabel: 'Custom send test',
          testSentLabel: 'Custom sent',
          testFailedLabel: 'Custom failed',
          activeLabel: 'Custom on',
          offLabel: 'Custom off',
        }}
      />,
    );
    expect(screen.getByText('Custom completion title')).toBeInTheDocument();
    expect(screen.getByText('Custom completion hint')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom success label')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom failure label')).toBeInTheDocument();
    expect(screen.getByText('Custom desktop title')).toBeInTheDocument();
    expect(screen.getByText('Custom desktop hint')).toBeInTheDocument();
    expect(screen.getByText('Custom unsupported hint')).toBeInTheDocument();
    expect(screen.getByText('Custom on')).toBeInTheDocument();
    expect(screen.getByText('Custom off')).toBeInTheDocument();
  });

  it('disables the desktop toggle when Notification is unsupported', () => {
    vi.stubGlobal('Notification', undefined);
    render(<NotificationsTab preferences={DEFAULT_NOTIFICATIONS_PREFERENCES} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Desktop notifications/ })).toBeDisabled();
    expect(screen.getByText(/not supported/)).toBeInTheDocument();
  });

  it('requests permission and calls onChange(desktopEnabled: true) when granted', async () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') });
    const onChange = vi.fn();
    render(<NotificationsTab preferences={DEFAULT_NOTIFICATIONS_PREFERENCES} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Desktop notifications/ }));
    expect(onChange).toHaveBeenCalledWith({ desktopEnabled: true });
  });

  it('turns desktop notifications off directly (no permission prompt) when already enabled', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    const onChange = vi.fn();
    render(
      <NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, desktopEnabled: true }} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Desktop notifications/ }));
    expect(onChange).toHaveBeenCalledWith({ desktopEnabled: false });
  });

  it('shows a "Send test notification" button and status once desktop is enabled + granted, and sends one', async () => {
    class FakeNotification {
      static permission = 'granted';
      constructor(
        public title: string,
        public options: NotificationOptions,
      ) {}
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
    }
    vi.stubGlobal('Notification', FakeNotification);
    render(
      <NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, desktopEnabled: true }} onChange={() => {}} />,
    );
    const testButton = screen.getByRole('button', { name: 'Send test notification' });
    await userEvent.click(testButton);
    expect(await screen.findByRole('status')).toHaveTextContent('Test notification sent.');
  });

  it('shows "failed" status text when the Notification constructor throws', async () => {
    class ThrowingNotification {
      static permission = 'granted';
      constructor() {
        throw new Error('boom');
      }
    }
    vi.stubGlobal('Notification', ThrowingNotification);
    render(
      <NotificationsTab preferences={{ ...DEFAULT_NOTIFICATIONS_PREFERENCES, desktopEnabled: true }} onChange={() => {}} />,
    );
    const testButton = screen.getByRole('button', { name: 'Send test notification' });
    await userEvent.click(testButton);
    expect(await screen.findByRole('status')).toHaveTextContent('Could not send a test notification.');
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Completion sound': 'Son de fin de tâche' } }} initialLocale="fr">
        <NotificationsTab preferences={DEFAULT_NOTIFICATIONS_PREFERENCES} onChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('Son de fin de tâche')).toBeInTheDocument();
  });
});
