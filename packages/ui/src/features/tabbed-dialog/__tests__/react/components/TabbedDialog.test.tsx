import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { TabbedDialog } from '../../../react/components/TabbedDialog.js';
import type { TabbedDialogTab } from '../../../react/components/TabbedDialog.js';

// Moved from `../../../../settings/dialog/__tests__/react/components/SettingsDialogShell.test.tsx`
// (2026-08-13) when the shell was extracted into this generic module — every assertion here
// was already exercising generic shell behavior, not anything settings-specific.
//
// Testids still read `settings-dialog-nav-<id>` / `settings-dialog-backdrop`, not
// `tabbed-dialog-*`: several Tovu Playwright e2e specs hard-code the old prefix and this
// package can't see or run that tree to verify a rename, so the component deliberately kept
// the old strings. See `TabbedDialog.tsx`'s own comment at the `data-testid` prop.

function makeTabs(): TabbedDialogTab[] {
  return [
    { id: 'appearance', label: 'Appearance', subtitle: 'Theme & accent', panel: <div data-testid="panel-appearance">Appearance panel</div> },
    { id: 'notifications', label: 'Notifications', navHint: 'Sound & desktop', panel: <div data-testid="panel-notifications">Notifications panel</div> },
  ];
}

describe('TabbedDialog', () => {
  it('renders the initially active tab panel and header', () => {
    render(<TabbedDialog tabs={makeTabs()} initialActiveTabId="appearance" />);
    expect(screen.getByTestId('panel-appearance')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-notifications')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByText('Theme & accent')).toBeInTheDocument();
  });

  it('switches the active panel when a nav item is clicked', async () => {
    render(<TabbedDialog tabs={makeTabs()} initialActiveTabId="appearance" />);
    await userEvent.click(screen.getByTestId('settings-dialog-nav-notifications'));
    expect(screen.getByTestId('panel-notifications')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-appearance')).not.toBeInTheDocument();
    expect(screen.getByText('Sound & desktop')).toBeInTheDocument();
  });

  it('falls back to the first tab when initialActiveTabId does not match any tab', () => {
    render(<TabbedDialog tabs={makeTabs()} initialActiveTabId="does-not-exist" />);
    expect(screen.getByTestId('panel-appearance')).toBeInTheDocument();
  });

  it('supports a controlled activeTabId', async () => {
    const onActiveTabIdChange = vi.fn();
    const { rerender } = render(
      <TabbedDialog tabs={makeTabs()} activeTabId="appearance" onActiveTabIdChange={onActiveTabIdChange} />,
    );
    await userEvent.click(screen.getByTestId('settings-dialog-nav-notifications'));
    expect(onActiveTabIdChange).toHaveBeenCalledWith('notifications');
    // Still shows "appearance" because the host hasn't updated the prop yet.
    expect(screen.getByTestId('panel-appearance')).toBeInTheDocument();
    rerender(<TabbedDialog tabs={makeTabs()} activeTabId="notifications" onActiveTabIdChange={onActiveTabIdChange} />);
    expect(screen.getByTestId('panel-notifications')).toBeInTheDocument();
  });

  it('publishes each inline nav button as an agent-clickable tab', () => {
    render(<TabbedDialog tabs={makeTabs()} initialActiveTabId="appearance" />);
    const appearanceNav = screen.getByTestId('settings-dialog-nav-appearance');
    expect(appearanceNav).toHaveAttribute('data-agent-element', 'tab-appearance');
    expect(appearanceNav).toHaveAttribute('data-agent-role', 'button');
    expect(appearanceNav).toHaveAttribute('data-agent-label', 'Appearance');
  });

  it('leaves modal nav buttons untagged, so a same-page inline instance keeps a unique handle', () => {
    // A host can mount an inline shell and, once opened, a modal preview of the identical tab
    // set at the same time — if both published `data-agent-element="tab-appearance"`, the
    // handle would be ambiguous and a page driver would refuse to click either one.
    render(<TabbedDialog tabs={makeTabs()} onClose={() => {}} initialActiveTabId="appearance" />);
    const appearanceNav = screen.getByTestId('settings-dialog-nav-appearance');
    expect(appearanceNav).not.toHaveAttribute('data-agent-element');
    expect(appearanceNav).not.toHaveAttribute('data-agent-role');
    expect(appearanceNav).not.toHaveAttribute('data-agent-label');
  });

  it('calls onClose on backdrop click but not on inner dialog click', async () => {
    const onClose = vi.fn();
    render(<TabbedDialog tabs={makeTabs()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('settings-dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked and on Escape', async () => {
    const onClose = vi.fn();
    render(<TabbedDialog tabs={makeTabs()} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders no close button when onClose is omitted', () => {
    render(<TabbedDialog tabs={makeTabs()} />);
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('toggles the sidebar collapsed state', async () => {
    render(<TabbedDialog tabs={makeTabs()} />);
    const toggle = screen.getByLabelText('Collapse sidebar');
    await userEvent.click(toggle);
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();
  });

  it('toggles fullscreen and hides the control when fullscreenEnabled=false', async () => {
    const { rerender } = render(<TabbedDialog tabs={makeTabs()} />);
    const toggle = screen.getByLabelText('Fullscreen');
    await userEvent.click(toggle);
    expect(screen.getByLabelText('Exit fullscreen')).toBeInTheDocument();

    rerender(<TabbedDialog tabs={makeTabs()} fullscreenEnabled={false} />);
    expect(screen.queryByLabelText('Exit fullscreen')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fullscreen')).not.toBeInTheDocument();
  });

  it('renders the welcome hero instead of the per-tab header when welcome=true', () => {
    render(<TabbedDialog tabs={makeTabs()} welcome />);
    expect(screen.getByRole('heading', { level: 2, name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Appearance' })).not.toBeInTheDocument();
  });

  it('renders host-supplied chromeExtra', () => {
    render(<TabbedDialog tabs={makeTabs()} chromeExtra={<div data-testid="autosave-pill">Saved</div>} />);
    expect(screen.getByTestId('autosave-pill')).toBeInTheDocument();
  });

  it('uses the header title when a tab supplies one distinct from its label', () => {
    const tabs: TabbedDialogTab[] = [
      { id: 'appearance', label: 'Appearance', title: 'Look & feel', panel: <div>panel</div> },
    ];
    render(<TabbedDialog tabs={tabs} initialActiveTabId="appearance" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Look & feel' })).toBeInTheDocument();
  });

  it('renders an empty header title when there are no tabs at all', () => {
    render(<TabbedDialog tabs={[]} />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('');
  });

  it('renders host-supplied labels instead of the built-in defaults', () => {
    render(
      <TabbedDialog
        tabs={makeTabs()}
        onClose={() => {}}
        welcome
        labels={{
          kicker: 'Custom kicker',
          welcomeKicker: 'Custom welcome kicker',
          welcomeTitle: 'Custom welcome title',
          welcomeSubtitle: 'Custom welcome subtitle',
          closeLabel: 'Dismiss',
          fullscreenLabel: 'Go big',
          exitFullscreenLabel: 'Go small',
          collapseSidebarLabel: 'Hide sections',
          expandSidebarLabel: 'Show sections',
          sidebarAriaLabel: 'Sections nav',
        }}
      />,
    );
    expect(screen.getByText('Custom welcome kicker')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Custom welcome title' })).toBeInTheDocument();
    expect(screen.getByText('Custom welcome subtitle')).toBeInTheDocument();
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
    expect(screen.getByLabelText('Go big')).toBeInTheDocument();
    expect(screen.getByLabelText('Hide sections')).toBeInTheDocument();
    expect(screen.getByLabelText('Sections nav')).toBeInTheDocument();
  });

  it('renders translated chrome copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Close: 'Fermer' } }} initialLocale="fr">
        <TabbedDialog tabs={makeTabs()} onClose={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByLabelText('Fermer')).toBeInTheDocument();
  });

  describe('presentation', () => {
    it('renders inline with no backdrop and no aria-modal when onClose is omitted', () => {
      render(<TabbedDialog tabs={makeTabs()} />);
      // The backdrop is fixed/inset-0: rendering it around an embedded panel
      // covers the host's own navigation. That regression is what this guards.
      expect(screen.queryByTestId('settings-dialog-backdrop')).not.toBeInTheDocument();
      expect(screen.getByRole('region')).not.toHaveAttribute('aria-modal');
    });

    it('renders a backdrop and an aria-modal dialog when onClose is supplied', () => {
      render(<TabbedDialog tabs={makeTabs()} onClose={() => {}} />);
      expect(screen.getByTestId('settings-dialog-backdrop')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('honors an explicit inline presentation even when onClose is supplied', () => {
      render(<TabbedDialog tabs={makeTabs()} onClose={() => {}} presentation="inline" />);
      expect(screen.queryByTestId('settings-dialog-backdrop')).not.toBeInTheDocument();
      expect(screen.getByRole('region')).toBeInTheDocument();
      // The close affordance still renders — an embedded panel may offer its own hide control.
      expect(screen.getByLabelText('Close')).toBeInTheDocument();
    });

    it('honors an explicit modal presentation even when onClose is omitted', () => {
      render(<TabbedDialog tabs={makeTabs()} presentation="modal" />);
      expect(screen.getByTestId('settings-dialog-backdrop')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });
  });
});
