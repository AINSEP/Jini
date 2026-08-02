import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { ABOUT_UPDATE_KEYS } from '../../../rules.js';
import type { AboutUpdatePrimaryAction, UpdaterModel } from '../../../types.js';
import { AboutTab } from '../../../react/components/AboutTab.js';
import type { AboutAppVersionInfo } from '../../../react/components/AboutTab.js';

function model(overrides: Partial<UpdaterModel> = {}): UpdaterModel {
  return { environment: 'desktop', enabled: true, supported: true, ...overrides };
}

function versionInfo(overrides: Partial<AboutAppVersionInfo> = {}): AboutAppVersionInfo {
  return { version: '1.2.3', packaged: true, ...overrides };
}

function renderTab(
  props: Partial<{
    appVersionInfo: AboutAppVersionInfo | null;
    updaterModel: UpdaterModel;
    onPerformUpdateAction: (action: AboutUpdatePrimaryAction) => Promise<void>;
    onOpenReleaseLink: () => void;
  }> = {},
) {
  return render(
    <AboutTab
      appVersionInfo={props.appVersionInfo === undefined ? versionInfo() : props.appVersionInfo}
      updaterModel={props.updaterModel ?? model()}
      onPerformUpdateAction={props.onPerformUpdateAction ?? vi.fn().mockResolvedValue(undefined)}
      onOpenReleaseLink={props.onOpenReleaseLink ?? vi.fn()}
    />,
  );
}

describe('AboutTab', () => {
  it('shows an empty-state card and nothing else when appVersionInfo is null', () => {
    renderTab({ appVersionInfo: null });
    expect(screen.getByText('Version information is unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('about-update-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('about-release-link')).not.toBeInTheDocument();
  });

  it('renders the version, a packaged runtime row, and an enabled primary-styled "check" button by default', () => {
    renderTab({ appVersionInfo: versionInfo({ version: '9.9.9' }) });
    expect(screen.getByText('9.9.9')).toBeInTheDocument();
    expect(screen.getByText('Packaged')).toBeInTheDocument();
    const button = screen.getByTestId('about-update-action');
    expect(button).toBeEnabled();
    expect(button).toHaveClass('jini-button-primary');
    expect(screen.getByTestId('about-release-link')).toBeInTheDocument();
  });

  it('renders a disabled, ghost-styled inert button (not a hidden one) while a label is set but no action is offered', () => {
    renderTab({ updaterModel: model({ status: { state: 'checking' } }) });
    const button = screen.getByTestId('about-update-action');
    expect(button).toBeDisabled();
    expect(button).toHaveClass('jini-button-ghost');
    expect(screen.getByTestId('about-release-link')).toBeInTheDocument();
  });

  it('hides the primary button entirely in states with no label at all (e.g. unsupported)', () => {
    renderTab({ updaterModel: model({ enabled: false }) });
    expect(screen.queryByTestId('about-update-action')).not.toBeInTheDocument();
  });

  it('shows the development runtime row and hides the update button for an unpackaged build, but still offers the release link', () => {
    renderTab({ appVersionInfo: versionInfo({ packaged: false }) });
    expect(screen.getByText('Development build')).toBeInTheDocument();
    expect(screen.queryByText('Packaged')).not.toBeInTheDocument();
    expect(screen.queryByTestId('about-update-action')).not.toBeInTheDocument();
    expect(screen.getByTestId('about-release-link')).toBeInTheDocument();
  });

  it('hides the release link while installing, matching the two states where the app is about to disappear', () => {
    renderTab({ updaterModel: model({ status: { state: 'installing' } }) });
    expect(screen.queryByTestId('about-release-link')).not.toBeInTheDocument();
    expect(screen.getByTestId('about-update-action')).toBeDisabled();
  });

  it('renders channel/platform/arch rows only when supplied', () => {
    const { rerender } = renderTab({ appVersionInfo: versionInfo() });
    expect(screen.queryByText('Channel')).not.toBeInTheDocument();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    expect(screen.queryByText('Architecture')).not.toBeInTheDocument();

    rerender(
      <AboutTab
        appVersionInfo={versionInfo({ channel: 'stable', platform: 'darwin', arch: 'arm64' })}
        updaterModel={model()}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
      />,
    );
    expect(screen.getByText('stable')).toBeInTheDocument();
    expect(screen.getByText('darwin')).toBeInTheDocument();
    expect(screen.getByText('arm64')).toBeInTheDocument();
  });

  it('disables the button when the host reports the updater busy, even with an actionable state', () => {
    renderTab({ updaterModel: model({ busy: true }) });
    expect(screen.getByTestId('about-update-action')).toBeDisabled();
  });

  it('clicking the primary action runs the host callback with the derived action and re-enables on success', async () => {
    const onPerformUpdateAction = vi.fn().mockResolvedValue(undefined);
    renderTab({ onPerformUpdateAction });
    const button = screen.getByTestId('about-update-action');

    await userEvent.click(button);

    expect(onPerformUpdateAction).toHaveBeenCalledWith('check');
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText('Something went wrong. Try again.')).not.toBeInTheDocument();
  });

  it('shows a generic failure message when the host action rejects, and clears it on the next successful attempt', async () => {
    const onPerformUpdateAction = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(undefined);
    renderTab({ onPerformUpdateAction });
    const button = screen.getByTestId('about-update-action');

    await userEvent.click(button);
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());

    await userEvent.click(button);
    await waitFor(() => expect(screen.queryByText('Something went wrong. Try again.')).not.toBeInTheDocument());
  });

  it('clicking the release link calls the host callback', async () => {
    const onOpenReleaseLink = vi.fn();
    renderTab({ onOpenReleaseLink });
    await userEvent.click(screen.getByTestId('about-release-link'));
    expect(onOpenReleaseLink).toHaveBeenCalledTimes(1);
  });

  it('renders a host-supplied label override for the empty state instead of the built-in default', () => {
    render(
      <AboutTab
        appVersionInfo={null}
        updaterModel={model()}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
        labels={{ versionUnavailableLabel: 'Custom unavailable' }}
      />,
    );
    expect(screen.getByText('Custom unavailable')).toBeInTheDocument();
  });

  it('renders every host-supplied label override with a populated version panel', () => {
    render(
      <AboutTab
        appVersionInfo={versionInfo({ packaged: false, channel: 'beta', platform: 'win32', arch: 'x64' })}
        updaterModel={model({ status: { state: 'installing' } })}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
        labels={{
          versionLabel: 'Custom version',
          runtimeLabel: 'Custom runtime',
          developmentLabel: 'Custom dev build',
          channelLabel: 'Custom channel',
          platformLabel: 'Custom platform',
          archLabel: 'Custom arch',
        }}
      />,
    );
    expect(screen.getByText('Custom version')).toBeInTheDocument();
    expect(screen.getByText('Custom runtime')).toBeInTheDocument();
    expect(screen.getByText('Custom dev build')).toBeInTheDocument();
    expect(screen.getByText('Custom channel')).toBeInTheDocument();
    expect(screen.getByText('Custom platform')).toBeInTheDocument();
    expect(screen.getByText('Custom arch')).toBeInTheDocument();
  });

  it('renders the packaged/release-link/action-failed label overrides that the other override test cannot exercise at the same time', async () => {
    const onPerformUpdateAction = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <AboutTab
        appVersionInfo={versionInfo({ packaged: true })}
        updaterModel={model()}
        onPerformUpdateAction={onPerformUpdateAction}
        onOpenReleaseLink={vi.fn()}
        labels={{
          packagedLabel: 'Custom packaged',
          releaseLinkLabel: 'Custom release link',
          actionFailedLabel: 'Custom failure',
        }}
      />,
    );
    expect(screen.getByText('Custom packaged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom release link' })).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('about-update-action'));
    expect(await screen.findByText('Custom failure')).toBeInTheDocument();
  });

  it('does not render the silent-updates toggle at all when no write handler is supplied', () => {
    renderTab();
    expect(screen.queryByTestId('about-silent-updates-toggle')).not.toBeInTheDocument();
    expect(screen.queryByText('Install updates automatically')).not.toBeInTheDocument();
  });

  it('renders the silent-updates toggle, seeded from the prop, when a write handler is supplied', () => {
    render(
      <AboutTab
        appVersionInfo={versionInfo()}
        updaterModel={model()}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
        allowSilentUpdates
        onSilentUpdatePreferenceChange={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const toggle = screen.getByTestId('about-silent-updates-toggle');
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.getByText('Install updates automatically')).toBeInTheDocument();
  });

  it('defaults the silent-updates seed to false when the prop is omitted but a handler is supplied', () => {
    render(
      <AboutTab
        appVersionInfo={versionInfo()}
        updaterModel={model()}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
        onSilentUpdatePreferenceChange={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTestId('about-silent-updates-toggle')).not.toBeChecked();
  });

  it('flipping the silent-updates toggle applies the value optimistically, disables while writing, and calls the host handler', async () => {
    const onSilentUpdatePreferenceChange = vi.fn().mockResolvedValue(undefined);
    render(
      <AboutTab
        appVersionInfo={versionInfo()}
        updaterModel={model()}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
        allowSilentUpdates={false}
        onSilentUpdatePreferenceChange={onSilentUpdatePreferenceChange}
      />,
    );
    const toggle = screen.getByTestId('about-silent-updates-toggle');

    await userEvent.click(toggle);

    expect(onSilentUpdatePreferenceChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it('rolls the silent-updates toggle back to its pre-write value when the host handler rejects', async () => {
    const onSilentUpdatePreferenceChange = vi.fn().mockRejectedValue(new Error('daemon unreachable'));
    render(
      <AboutTab
        appVersionInfo={versionInfo()}
        updaterModel={model()}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
        allowSilentUpdates={false}
        onSilentUpdatePreferenceChange={onSilentUpdatePreferenceChange}
      />,
    );
    const toggle = screen.getByTestId('about-silent-updates-toggle');

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(toggle).toBeEnabled();
  });

  it('renders silent-updates label overrides', () => {
    render(
      <AboutTab
        appVersionInfo={versionInfo()}
        updaterModel={model()}
        onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
        onOpenReleaseLink={vi.fn()}
        onSilentUpdatePreferenceChange={vi.fn().mockResolvedValue(undefined)}
        labels={{ silentUpdatesLabel: 'Custom silent label', silentUpdatesHint: 'Custom silent hint' }}
      />,
    );
    expect(screen.getByText('Custom silent label')).toBeInTheDocument();
    expect(screen.getByText('Custom silent hint')).toBeInTheDocument();
  });

  it('renders translated status copy with interpolated vars when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            [ABOUT_UPDATE_KEYS.available]: 'Mise à jour disponible : v{version}',
            [ABOUT_UPDATE_KEYS.download]: 'Télécharger',
            Version: 'Version (fr)',
          },
        }}
        initialLocale="fr"
      >
        <AboutTab
          appVersionInfo={versionInfo()}
          updaterModel={model({ status: { state: 'available' }, canDownload: true, availableVersion: '2.0.0' })}
          onPerformUpdateAction={vi.fn().mockResolvedValue(undefined)}
          onOpenReleaseLink={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Mise à jour disponible : v2.0.0')).toBeInTheDocument();
    expect(screen.getByText('Version (fr)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeInTheDocument();
  });
});
