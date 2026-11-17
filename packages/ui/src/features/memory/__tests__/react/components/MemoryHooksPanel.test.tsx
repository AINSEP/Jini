// The pluggable-hooks panel toggles the four individual memory hooks while
// the master switch stays on. These pin the head copy, each hook row's
// label/description/checkbox, the master-off disabled state, the onToggle
// wiring (key + next value), and an i18n-wiring-retrofit proof.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { MemoryHooksPanel, type MemoryHookKey } from '../../../react/components/MemoryHooksPanel.js';

function allFlags(value: boolean): Record<MemoryHookKey, boolean> {
  return {
    chatExtractionEnabled: value,
    profileEnabled: value,
    rewriteEnabled: value,
    verifyEnabled: value,
  };
}

function renderPanel(props: Partial<Parameters<typeof MemoryHooksPanel>[0]> = {}) {
  const onToggle = vi.fn();
  const utils = render(<MemoryHooksPanel enabled flags={allFlags(true)} onToggle={onToggle} {...props} />);
  return { ...utils, onToggle };
}

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('MemoryHooksPanel', () => {
  it('renders the head copy and every hook row label/description', () => {
    renderPanel();
    expect(screen.getByText('Memory hooks')).toBeInTheDocument();
    expect(screen.getByText('Fine-tune how memory is captured and used, without turning it off entirely.')).toBeInTheDocument();

    expect(screen.getByText('Profile injection')).toBeInTheDocument();
    expect(screen.getByText('Include your saved profile in the prompt.')).toBeInTheDocument();
    expect(screen.getByText('Query rewrite')).toBeInTheDocument();
    expect(screen.getByText('Expand short requests into a fuller task brief first.')).toBeInTheDocument();
    expect(screen.getByText('Self-verify')).toBeInTheDocument();
    expect(screen.getByText('Check responses against saved rules and report a scorecard.')).toBeInTheDocument();
    expect(screen.getByText('Chat extraction')).toBeInTheDocument();
    expect(screen.getByText('Learn new facts and preferences from chat turns.')).toBeInTheDocument();
  });

  it('reflects the checked state of each hook flag', () => {
    renderPanel({
      flags: { chatExtractionEnabled: true, profileEnabled: false, rewriteEnabled: true, verifyEnabled: false },
    });
    expect(screen.getByRole('checkbox', { name: 'Profile injection' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Query rewrite' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Self-verify' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chat extraction' })).toBeChecked();
  });

  it('fires onToggle with the hook key and next checked value', async () => {
    const { onToggle } = renderPanel({ flags: { ...allFlags(true), profileEnabled: false } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Profile injection' }));
    expect(onToggle).toHaveBeenCalledWith('profileEnabled', true);
  });

  it('disables every hook toggle when the master switch is off', () => {
    renderPanel({ enabled: false });
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled();
    }
  });

  it('enables every hook toggle when the master switch is on', () => {
    renderPanel({ enabled: true });
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).not.toBeDisabled();
    }
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            'Memory hooks': 'Crochets de mémoire',
            'Profile injection': 'Injection de profil',
          },
        }}
        initialLocale="fr"
      >
        <MemoryHooksPanel enabled flags={allFlags(true)} onToggle={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Crochets de mémoire')).toBeInTheDocument();
    expect(screen.getByText('Injection de profil')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    renderPanel({ useTHook: useQuotingT });
    expect(screen.getByText('«Memory hooks»')).toBeInTheDocument();
    expect(screen.getByText('«Profile injection»')).toBeInTheDocument();
  });
});
