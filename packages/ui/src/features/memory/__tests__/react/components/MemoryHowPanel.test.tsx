// Dumb panel for the "How it works" tab: the automatic-capture flow diagram,
// the primer copy, and the pluggable-hooks toggles (rendered by the shared
// MemoryHooksPanel). These pin that the panel renders the diagram/copy and
// passes enabled/flags/onToggle straight through to the hooks panel.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MemoryHowPanel } from '../../../react/components/MemoryHowPanel.js';
import type { MemoryConfigFlagKey } from '../../../rules.js';

function allFlags(value: boolean): Record<MemoryConfigFlagKey, boolean> {
  return {
    chatExtractionEnabled: value,
    profileEnabled: value,
    rewriteEnabled: value,
    verifyEnabled: value,
  };
}

function renderPanel(props: Partial<Parameters<typeof MemoryHowPanel>[0]> = {}) {
  const onToggleHook = vi.fn();
  const utils = render(<MemoryHowPanel enabled hookFlags={allFlags(true)} onToggleHook={onToggleHook} {...props} />);
  return { ...utils, onToggleHook };
}

describe('MemoryHowPanel', () => {
  it('renders the automatic-capture flow diagram and primer copy', () => {
    renderPanel();
    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    expect(screen.getByText('Brand context')).toBeInTheDocument();
    expect(screen.getByText('Chat signals')).toBeInTheDocument();
    expect(screen.getByText('Saved memory')).toBeInTheDocument();
    expect(screen.getByText(/gathered automatically from profile setup/)).toBeInTheDocument();
  });

  it('renders the hooks panel and passes enabled/flags/onToggle straight through', async () => {
    const { onToggleHook } = renderPanel({
      hookFlags: { ...allFlags(true), profileEnabled: false },
    });
    expect(screen.getByTestId('memory-hooks-panel')).toBeInTheDocument();

    const profileToggle = screen.getByRole('checkbox', { name: 'Profile injection' });
    expect(profileToggle).not.toBeChecked();

    await userEvent.click(profileToggle);
    expect(onToggleHook).toHaveBeenCalledWith('profileEnabled', true);
  });

  it('disables every hook toggle when the master switch is off', () => {
    renderPanel({ enabled: false });
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled();
    }
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            Onboarding: 'Intégration',
            'Saved memory': 'Mémoire enregistrée',
          },
        }}
        initialLocale="fr"
      >
        <MemoryHowPanel enabled hookFlags={allFlags(true)} onToggleHook={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Intégration')).toBeInTheDocument();
    expect(screen.getByText('Mémoire enregistrée')).toBeInTheDocument();
  });
});
