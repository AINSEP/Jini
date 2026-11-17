import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SelectedMentionChips } from '../../../react/components/SelectedMentionChips.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import type { MentionItem } from '../../../types.js';
import type { ReactNode } from 'react';

const ITEMS: MentionItem<ReactNode>[] = [
  { id: '1', label: 'Alpha', category: 'skills' },
  { id: '2', label: 'Beta', category: 'plugins' },
];

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('SelectedMentionChips', () => {
  it('renders nothing when there are no selected items', () => {
    const { container } = render(<SelectedMentionChips items={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a chip per selected item with its label', () => {
    render(<SelectedMentionChips items={ITEMS} onRemove={vi.fn()} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('calls onRemove with the clicked chip item', async () => {
    const onRemove = vi.fn();
    render(<SelectedMentionChips items={ITEMS} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    expect(onRemove).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('renders the removeIcon and per-category class, and sets a Remove title', () => {
    render(<SelectedMentionChips items={ITEMS} onRemove={vi.fn()} removeIcon={<span data-testid="x" />} />);
    const chips = screen.getAllByTestId('x');
    expect(chips).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Alpha/ })).toHaveClass('is-skills');
    expect(screen.getByRole('button', { name: /Alpha/ })).toHaveAttribute('title', 'Remove Alpha');
  });

  it('renders translated chip-row aria-label and remove title under an I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Selected context': 'Contexte sélectionné', 'Remove {label}': 'Retirer {label}' } }} initialLocale="fr">
        <SelectedMentionChips items={ITEMS} onRemove={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByLabelText('Contexte sélectionné')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alpha/ })).toHaveAttribute('title', 'Retirer Alpha');
  });

  it('renders the translator supplied through useTHook', () => {
    render(<SelectedMentionChips items={ITEMS} onRemove={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByLabelText('«Selected context»')).toBeInTheDocument();
  });
});
