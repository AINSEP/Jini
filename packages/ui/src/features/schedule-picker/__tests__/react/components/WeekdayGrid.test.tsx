import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WeekdayGrid } from '../../../react/components/WeekdayGrid.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { DEFAULT_WEEKDAYS } from '../../../constants.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('WeekdayGrid', () => {
  it('renders every weekday short label and marks the active one pressed', () => {
    render(<WeekdayGrid weekdays={DEFAULT_WEEKDAYS} active={1} onChange={vi.fn()} />);
    const mon = screen.getByRole('button', { name: 'Mon' });
    const tue = screen.getByRole('button', { name: 'Tue' });
    expect(mon).toHaveAttribute('aria-pressed', 'true');
    expect(tue).toHaveAttribute('aria-pressed', 'false');
    expect(mon).toHaveAttribute('title', 'Monday');
  });

  it('calls onChange with the clicked weekday value', async () => {
    const onChange = vi.fn();
    render(<WeekdayGrid weekdays={DEFAULT_WEEKDAYS} active={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fri' }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('renders translated weekday labels under an I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Mon: 'Lun', Monday: 'Lundi' } }} initialLocale="fr">
        <WeekdayGrid weekdays={DEFAULT_WEEKDAYS} active={1} onChange={vi.fn()} />
      </I18nProvider>,
    );
    const mon = screen.getByRole('button', { name: 'Lun' });
    expect(mon).toBeInTheDocument();
    expect(mon).toHaveAttribute('title', 'Lundi');
  });

  it('renders the translator supplied through useTHook', () => {
    render(<WeekdayGrid weekdays={DEFAULT_WEEKDAYS} active={1} onChange={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByLabelText('«Weekday»')).toBeInTheDocument();
  });
});
