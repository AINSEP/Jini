import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleFields } from '../../../react/components/ScheduleFields.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import type { ScheduleEditorState } from '../../../types.js';

const timezones = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'];

function hourlyState(overrides: Partial<ScheduleEditorState> = {}): ScheduleEditorState {
  return { kind: 'hourly', minute: 5, time: '09:00', weekday: 1, timezone: 'UTC', ...overrides };
}

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('ScheduleFields', () => {
  it('renders the minute field for hourly and calls onMinuteChange', async () => {
    const onMinuteChange = vi.fn();
    render(
      <ScheduleFields
        state={hourlyState()}
        timezones={timezones}
        onMinuteChange={onMinuteChange}
        onTimeChange={vi.fn()}
        onTimezoneChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Minute of every hour') as HTMLInputElement;
    expect(input.value).toBe('5');
    await userEvent.clear(input);
    await userEvent.type(input, '42');
    expect(onMinuteChange).toHaveBeenCalled();
  });

  it('renders time+timezone fields for a non-hourly kind and calls the change handlers', async () => {
    const onTimeChange = vi.fn();
    const onTimezoneChange = vi.fn();
    render(
      <ScheduleFields
        state={hourlyState({ kind: 'daily', time: '09:00', timezone: 'UTC' })}
        timezones={timezones}
        onMinuteChange={vi.fn()}
        onTimeChange={onTimeChange}
        onTimezoneChange={onTimezoneChange}
      />,
    );
    expect(screen.queryByLabelText('Minute of every hour')).not.toBeInTheDocument();

    const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
    expect(timeInput.value).toBe('09:00');
    await userEvent.clear(timeInput);
    await userEvent.type(timeInput, '11:30');
    expect(onTimeChange).toHaveBeenCalled();

    const tzSelect = screen.getByLabelText('Timezone');
    await userEvent.selectOptions(tzSelect, 'Asia/Tokyo');
    expect(onTimezoneChange).toHaveBeenCalledWith('Asia/Tokyo');
  });

  it('renders a timezone option per entry, city-labeled', () => {
    render(
      <ScheduleFields
        state={hourlyState({ kind: 'weekly' })}
        timezones={timezones}
        onMinuteChange={vi.fn()}
        onTimeChange={vi.fn()}
        onTimezoneChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: 'Los Angeles' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tokyo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'UTC' })).toBeInTheDocument();
  });

  it('renders translated field labels under an I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Time: 'Heure', Timezone: 'Fuseau horaire' } }} initialLocale="fr">
        <ScheduleFields
          state={hourlyState({ kind: 'weekdays' })}
          timezones={timezones}
          onMinuteChange={vi.fn()}
          onTimeChange={vi.fn()}
          onTimezoneChange={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Heure')).toBeInTheDocument();
    expect(screen.getByText('Fuseau horaire')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(
      <ScheduleFields state={hourlyState({ kind: 'weekdays' })} timezones={timezones} onMinuteChange={vi.fn()} onTimeChange={vi.fn()} onTimezoneChange={vi.fn()} useTHook={useQuotingT} />,
    );
    expect(screen.getByText('«Time»')).toBeInTheDocument();
    expect(screen.getByText('«Timezone»')).toBeInTheDocument();
  });
});
