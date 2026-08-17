import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsDialogShell } from '../../../react/components/SettingsDialogShell.js';
import type { SettingsDialogTab } from '../../../react/components/SettingsDialogShell.js';

// `SettingsDialogShell` is a thin wrapper around `TabbedDialog` (2026-08-13 extraction) —
// the generic shell behavior (tab switching, presentation, fullscreen/collapse, close
// affordances, host-supplied label overrides, …) is covered once, generically, in
// `../../../../tabbed-dialog/__tests__/react/components/TabbedDialog.test.tsx`. This file
// only covers what the wrapper itself adds: its settings-flavoured label defaults, and that
// every other prop still passes through unchanged.

function makeTabs(): SettingsDialogTab[] {
  return [{ id: 'appearance', label: 'Appearance', panel: <div data-testid="panel-appearance">panel</div> }];
}

describe('SettingsDialogShell', () => {
  it('supplies its own settings-flavoured label defaults when the host passes none', () => {
    render(<SettingsDialogShell tabs={makeTabs()} initialActiveTabId="appearance" />);
    // Kicker text is uppercased by CSS (`text-transform: uppercase`) in real rendering, not
    // in the DOM's actual text content — jsdom doesn't apply CSS, so this asserts the raw string.
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings sections')).toBeInTheDocument();
    expect(screen.getByLabelText('Collapse settings sidebar')).toBeInTheDocument();
  });

  it('lets a host override any individual settings default without losing the others', () => {
    render(
      <SettingsDialogShell tabs={makeTabs()} initialActiveTabId="appearance" labels={{ kicker: 'Preferences' }} />,
    );
    expect(screen.getByText('Preferences')).toBeInTheDocument();
    // Untouched defaults still apply — overriding one label must not blank out the rest.
    expect(screen.getByLabelText('Settings sections')).toBeInTheDocument();
  });

  it('defaults dialogAriaLabelledBy to "settings-dialog-title", matching this component pre-extraction', () => {
    render(<SettingsDialogShell tabs={makeTabs()} initialActiveTabId="appearance" />);
    expect(document.getElementById('settings-dialog-title')).not.toBeNull();
    expect(screen.getByRole('region')).toHaveAttribute('aria-labelledby', 'settings-dialog-title');
  });

  it('forwards non-label props straight through to TabbedDialog', () => {
    render(
      <SettingsDialogShell
        tabs={makeTabs()}
        initialActiveTabId="appearance"
        chromeExtra={<div data-testid="autosave-pill">Saved</div>}
      />,
    );
    expect(screen.getByTestId('panel-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('autosave-pill')).toBeInTheDocument();
  });
});
