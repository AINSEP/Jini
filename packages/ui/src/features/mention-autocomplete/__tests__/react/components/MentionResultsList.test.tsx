import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MentionResultsList } from '../../../react/components/MentionResultsList.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import type { MentionResultGroup } from '../../../rules.js';
import type { MentionItem } from '../../../types.js';
import type { ReactNode } from 'react';

const GROUPS: MentionResultGroup<MentionItem<ReactNode>>[] = [
  {
    category: { id: 'skills', label: 'Skills' },
    items: [{ id: '1', label: 'Alpha', category: 'skills' }],
  },
];

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('MentionResultsList', () => {
  it('renders each group with a translated section label and its items', () => {
    render(
      <MentionResultsList groups={GROUPS} hasResults query="" selectedIds={new Set()} onPick={vi.fn()} />,
    );
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('shows the query-specific empty state when there are no results and a query is present', () => {
    render(<MentionResultsList groups={[]} hasResults={false} query="zzz" selectedIds={new Set()} onPick={vi.fn()} />);
    expect(screen.getByText('No results for "zzz".')).toBeInTheDocument();
  });

  it('shows the default empty-query placeholder when there is no query', () => {
    render(<MentionResultsList groups={[]} hasResults={false} query="" selectedIds={new Set()} onPick={vi.fn()} />);
    expect(screen.getByText('Start typing to search.')).toBeInTheDocument();
  });

  it('supports a custom emptyPlaceholder', () => {
    render(
      <MentionResultsList
        groups={[]}
        hasResults={false}
        query=""
        selectedIds={new Set()}
        onPick={vi.fn()}
        emptyPlaceholder="Search everything."
      />,
    );
    expect(screen.getByText('Search everything.')).toBeInTheDocument();
  });

  it('marks items present in selectedIds as selected via the composite key', () => {
    render(
      <MentionResultsList groups={GROUPS} hasResults selectedIds={new Set(['skills:1'])} onPick={vi.fn()} query="" />,
    );
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onPick with the picked item', async () => {
    const onPick = vi.fn();
    render(<MentionResultsList groups={GROUPS} hasResults selectedIds={new Set()} onPick={onPick} query="" />);
    await userEvent.click(screen.getByRole('option'));
    expect(onPick).toHaveBeenCalledWith(GROUPS[0]?.items[0]);
  });

  it('renders translated section labels and empty state under an I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Skills: 'Compétences', 'Start typing to search.': 'Commencez à taper.' } }} initialLocale="fr">
        <MentionResultsList groups={GROUPS} hasResults query="" selectedIds={new Set()} onPick={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Compétences')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<MentionResultsList groups={[]} hasResults={false} query="zzz" selectedIds={new Set()} onPick={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByText('«No results for "{query}".»')).toBeInTheDocument();
  });
});
