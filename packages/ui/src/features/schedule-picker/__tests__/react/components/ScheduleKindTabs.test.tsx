import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleKindTabs } from '../../../react/components/ScheduleKindTabs.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { DEFAULT_SCHEDULE_KINDS } from '../../../constants.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('ScheduleKindTabs', () => {
  it('renders each kind as a tab and marks the active one selected', () => {
    render(<ScheduleKindTabs kinds={DEFAULT_SCHEDULE_KINDS} active="daily" onChange={vi.fn()} />);
    const daily = screen.getByRole('tab', { name: 'Daily' });
    const weekly = screen.getByRole('tab', { name: 'Weekly' });
    expect(daily).toHaveAttribute('aria-selected', 'true');
    expect(weekly).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked kind', async () => {
    const onChange = vi.fn();
    render(<ScheduleKindTabs kinds={DEFAULT_SCHEDULE_KINDS} active="daily" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    expect(onChange).toHaveBeenCalledWith('weekly');
  });

  it('renders translated tab labels under an I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Daily: 'Quotidien', Weekly: 'Hebdomadaire' } }} initialLocale="fr">
        <ScheduleKindTabs kinds={DEFAULT_SCHEDULE_KINDS} active="daily" onChange={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Quotidien' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hebdomadaire' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<ScheduleKindTabs kinds={DEFAULT_SCHEDULE_KINDS} active="daily" onChange={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('tab', { name: '«Daily»' })).toBeInTheDocument();
  });
});
