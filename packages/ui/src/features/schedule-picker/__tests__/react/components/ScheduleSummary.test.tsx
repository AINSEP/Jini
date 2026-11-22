import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScheduleSummary } from '../../../react/components/ScheduleSummary.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import type { ScheduleValue } from '../../../types.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('ScheduleSummary', () => {
  it('renders an hourly summary', () => {
    const schedule: ScheduleValue = { kind: 'hourly', minute: 5 };
    render(<ScheduleSummary schedule={schedule} />);
    expect(screen.getByText('Hourly')).toBeInTheDocument();
    expect(screen.getByText(':05')).toBeInTheDocument();
  });

  it('renders a timed (daily) summary with freq/time/tz segments', () => {
    const schedule: ScheduleValue = { kind: 'daily', time: '09:00', timezone: 'UTC' };
    render(<ScheduleSummary schedule={schedule} />);
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('9:00 AM')).toBeInTheDocument();
    expect(screen.getByText('UTC')).toBeInTheDocument();
  });

  it('renders a weekly summary using the weekday long name', () => {
    const schedule: ScheduleValue = { kind: 'weekly', weekday: 3, time: '10:00', timezone: 'UTC' };
    render(<ScheduleSummary schedule={schedule} />);
    expect(screen.getByText('Wednesday')).toBeInTheDocument();
  });

  it('renders translated segments under an I18nProvider', () => {
    const schedule: ScheduleValue = { kind: 'daily', time: '09:00', timezone: 'UTC' };
    render(
      <I18nProvider dictionaries={{ fr: { Daily: 'Quotidien' } }} initialLocale="fr">
        <ScheduleSummary schedule={schedule} />
      </I18nProvider>,
    );
    expect(screen.getByText('Quotidien')).toBeInTheDocument();
  });

  it('renders translated Hourly segment under an I18nProvider', () => {
    const schedule: ScheduleValue = { kind: 'hourly', minute: 15 };
    render(
      <I18nProvider dictionaries={{ fr: { Hourly: 'Toutes les heures' } }} initialLocale="fr">
        <ScheduleSummary schedule={schedule} />
      </I18nProvider>,
    );
    expect(screen.getByText('Toutes les heures')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    const schedule: ScheduleValue = { kind: 'hourly', minute: 5 };
    render(<ScheduleSummary schedule={schedule} useTHook={useQuotingT} />);
    expect(screen.getByText('«Hourly»')).toBeInTheDocument();
  });
});
