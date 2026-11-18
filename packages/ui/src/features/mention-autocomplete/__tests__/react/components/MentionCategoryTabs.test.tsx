import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MentionCategoryTabs } from '../../../react/components/MentionCategoryTabs.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';

const CATEGORIES = [
  { id: 'skills', label: 'Skills' },
  { id: 'plugins', label: 'Plugins' },
];

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('MentionCategoryTabs', () => {
  it('renders the All tab plus every category, marking the active one selected', () => {
    render(<MentionCategoryTabs categories={CATEGORIES} active="skills" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Plugins' })).toHaveAttribute('aria-selected', 'false');
  });

  it('marks All selected when active is "all"', () => {
    render(<MentionCategoryTabs categories={CATEGORIES} active="all" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onChange with the clicked category id, and with "all" for the All tab', async () => {
    const onChange = vi.fn();
    render(<MentionCategoryTabs categories={CATEGORIES} active="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Plugins' }));
    expect(onChange).toHaveBeenCalledWith('plugins');
    await userEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('supports a custom allLabel', () => {
    render(<MentionCategoryTabs categories={CATEGORIES} active="all" onChange={vi.fn()} allLabel="Everything" />);
    expect(screen.getByRole('tab', { name: 'Everything' })).toBeInTheDocument();
  });

  it('renders translated tab labels under an I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { All: 'Tout', Skills: 'Compétences' } }} initialLocale="fr">
        <MentionCategoryTabs categories={CATEGORIES} active="skills" onChange={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Tout' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Compétences' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<MentionCategoryTabs categories={CATEGORIES} active="all" onChange={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('tab', { name: '«All»' })).toBeInTheDocument();
  });
});
