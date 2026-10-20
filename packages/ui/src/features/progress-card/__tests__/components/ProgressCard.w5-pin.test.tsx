import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { ProgressCard } from '../../components/ProgressCard.js';
import type { ProgressCardData } from '../../types.js';

const base: ProgressCardData = { id: 'w5-card', status: 'running', progress: 40, steps: [] };

describe('ProgressCard independent copy and prop updates', () => {
  it.each([
    { title: 'Host title', expectedTitle: 'Host title', expectedDetail: 'Traitement' },
    { detail: 'Host detail', expectedTitle: 'En cours', expectedDetail: 'Host detail' },
  ])('falls back independently for $expectedTitle / $expectedDetail', ({
    title, detail, expectedTitle, expectedDetail,
  }) => {
    const { container } = render(
      <I18nProvider initialLocale="fr" dictionaries={{ fr: {
        Running: 'En cours',
        'In progress.': 'Traitement',
        'Host title': 'Translated host title',
        'Host detail': 'Translated host detail',
      } }}>
        <ProgressCard data={{ ...base, ...(title === undefined ? {} : { title }), ...(detail === undefined ? {} : { detail }) }} />
      </I18nProvider>,
    );
    expect(container.querySelector('strong')?.textContent).toBe(expectedTitle);
    expect(container.querySelector('small')?.textContent).toBe(expectedDetail);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe(`${expectedTitle} progress`);
  });

  it('preserves an empty secondary heading while keeping the secondary list', () => {
    const { container } = render(<ProgressCard data={{
      ...base,
      secondaryItemsLabel: '',
      secondaryItems: [{ id: 'file', label: 'result.txt', status: 'pending' }],
    }} />);
    expect(container.querySelector('.progress-card-secondary-items > span')?.textContent).toBe('');
    expect(screen.queryByText('Files touched')).toBeNull();
    expect(screen.getByText('result.txt').tagName).toBe('CODE');
  });

  it('updates fallback copy and clears the determinate bar when props change', () => {
    const { rerender } = render(<ProgressCard data={base} />);
    const bar = screen.getByRole('progressbar', { name: 'Running progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.querySelector('span')?.style.width).toBe('40%');

    rerender(<ProgressCard data={{ ...base, status: 'failed', progress: 'indeterminate' }} />);
    const updatedBar = screen.getByRole('progressbar', { name: 'Needs attention progress' });
    expect(screen.getByText('Needs attention.').tagName).toBe('SMALL');
    expect(updatedBar.hasAttribute('aria-valuenow')).toBe(false);
    expect(updatedBar.querySelector('span')?.style.width).toBe('');
    expect(updatedBar.classList.contains('is-indeterminate')).toBe(true);
  });
});
