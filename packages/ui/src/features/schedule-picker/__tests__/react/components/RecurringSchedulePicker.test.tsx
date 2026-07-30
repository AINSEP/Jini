import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecurringSchedulePicker } from '../../../react/components/RecurringSchedulePicker.js';
import { I18nProvider } from '../../../../i18n/index.js';
import type { ScheduleValue } from '../../../types.js';

describe('RecurringSchedulePicker', () => {
  it('shows the schedule summary on the trigger and opens the popover on click', async () => {
    const value: ScheduleValue = { kind: 'daily', time: '09:00', timezone: 'UTC' };
    render(<RecurringSchedulePicker value={value} onChange={vi.fn()} />);
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Daily at 9:00 AM/ }));
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('switching kind tabs shows the weekday grid only for weekly', async () => {
    const value: ScheduleValue = { kind: 'daily', time: '09:00', timezone: 'UTC' };
    render(<RecurringSchedulePicker value={value} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Daily at/ }));
    expect(screen.queryByLabelText('Weekday')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    expect(screen.getByLabelText('Weekday')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Hourly' }));
    expect(screen.queryByLabelText('Weekday')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Minute of every hour')).toBeInTheDocument();
  });

  it('editing the schedule and clicking Done commits the new value and closes', async () => {
    const value: ScheduleValue = { kind: 'daily', time: '09:00', timezone: 'UTC' };
    const onChange = vi.fn();
    render(<RecurringSchedulePicker value={value} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Daily at/ }));

    const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
    await userEvent.clear(timeInput);
    await userEvent.type(timeInput, '13:00');

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'daily', time: '13:00', timezone: 'UTC' });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('closes the popover on outside click without committing', async () => {
    const value: ScheduleValue = { kind: 'daily', time: '09:00', timezone: 'UTC' };
    const onChange = vi.fn();
    render(
      <div>
        <RecurringSchedulePicker value={value} onChange={onChange} />
        <button type="button">outside</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Daily at/ }));
    expect(screen.getByRole('tablist')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables the trigger when disabled', () => {
    const value: ScheduleValue = { kind: 'hourly', minute: 0 };
    render(<RecurringSchedulePicker value={value} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('accepts a custom kinds/weekdays/timezones configuration', async () => {
    const value: ScheduleValue = { kind: 'weekly', weekday: 1, time: '09:00', timezone: 'UTC' };
    render(
      <RecurringSchedulePicker
        value={value}
        onChange={vi.fn()}
        kinds={[{ kind: 'weekly', label: 'Weekly' }]}
        weekdays={[{ value: 1, short: 'M', long: 'Mon-day' }]}
        timezones={['UTC']}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Mon-day at/ }));
    expect(screen.queryByRole('tab', { name: 'Hourly' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M' })).toBeInTheDocument();
  });

  it('renders translated copy end-to-end under an I18nProvider', async () => {
    const value: ScheduleValue = { kind: 'daily', time: '09:00', timezone: 'UTC' };
    render(
      <I18nProvider dictionaries={{ fr: { Daily: 'Quotidien', Done: 'Terminé', Time: 'Heure' } }} initialLocale="fr">
        <RecurringSchedulePicker value={value} onChange={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Quotidien')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Quotidien/ }));
    expect(screen.getByText('Heure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminé' })).toBeInTheDocument();
  });
});

describe('RecurringSchedulePicker 4-pattern hook override test suite', () => {
  const sampleValue: ScheduleValue = { kind: 'hourly', minute: 15 };

  it('Pattern 1 — State 1: Closed popover state via hook override', () => {
    const customHook = () => ({
      containerRef: { current: null },
      open: false,
      toggleOpen: vi.fn(),
      state: { kind: 'hourly' as const, minute: 15, weekday: 0, time: '09:00', timezone: 'UTC' },
      timezones: ['UTC'],
      setKind: vi.fn(),
      setWeekday: vi.fn(),
      setMinute: vi.fn(),
      setTime: vi.fn(),
      setTimezone: vi.fn(),
      commit: vi.fn(),
    });

    render(
      <RecurringSchedulePicker
        value={sampleValue}
        onChange={vi.fn()}
        useRecurringSchedulePicker={customHook as any}
      />,
    );

    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('Pattern 2 — State 2: Open popover state via hook override', () => {
    const customHook = () => ({
      containerRef: { current: null },
      open: true,
      toggleOpen: vi.fn(),
      state: { kind: 'daily' as const, minute: 0, weekday: 0, time: '09:00', timezone: 'UTC' },
      timezones: ['UTC'],
      setKind: vi.fn(),
      setWeekday: vi.fn(),
      setMinute: vi.fn(),
      setTime: vi.fn(),
      setTimezone: vi.fn(),
      commit: vi.fn(),
    });

    render(
      <RecurringSchedulePicker
        value={{ kind: 'daily', time: '09:00', timezone: 'UTC' }}
        onChange={vi.fn()}
        useRecurringSchedulePicker={customHook as any}
      />,
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('Pattern 3 — State 3: Weekly state with weekday grid via hook override', () => {
    const customHook = () => ({
      containerRef: { current: null },
      open: true,
      toggleOpen: vi.fn(),
      state: { kind: 'weekly' as const, minute: 0, weekday: 1, time: '09:00', timezone: 'UTC' },
      timezones: ['UTC'],
      setKind: vi.fn(),
      setWeekday: vi.fn(),
      setMinute: vi.fn(),
      setTime: vi.fn(),
      setTimezone: vi.fn(),
      commit: vi.fn(),
    });

    render(
      <RecurringSchedulePicker
        value={{ kind: 'weekly', weekday: 1, time: '09:00', timezone: 'UTC' }}
        onChange={vi.fn()}
        useRecurringSchedulePicker={customHook as any}
      />,
    );

    expect(screen.getByRole('button', { name: 'Mon' })).toBeInTheDocument();
  });

  it('Pattern 4 — State 4: Dynamic schedule value transition walkthrough using React useState inside test harness', () => {
    function DynamicScheduleHarness() {
      const [schedule, setSchedule] = useState<ScheduleValue>({ kind: 'hourly', minute: 0 });
      return <RecurringSchedulePicker value={schedule} onChange={setSchedule} />;
    }

    render(<DynamicScheduleHarness />);

    expect(screen.getByRole('button', { name: /Hourly at/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hourly at/ }));
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
