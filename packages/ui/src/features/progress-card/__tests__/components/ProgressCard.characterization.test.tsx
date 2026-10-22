import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { ProgressCard } from '../../components/ProgressCard.js';
import type { ProgressCardData } from '../../types.js';

const base: ProgressCardData = { id: 'pin-card', status: 'running', progress: 40, steps: [] };

describe('ProgressCard characterization', () => {
  it.each([
    { progress: 42.6, width: '43%', value: '43', indeterminate: false },
    { progress: -5, width: '0%', value: '0', indeterminate: false },
    { progress: 145, width: '100%', value: '100', indeterminate: false },
    { progress: Number.NaN, width: '0%', value: '0', indeterminate: false },
    { progress: 'indeterminate', width: '', value: null, indeterminate: true },
  ] as const)('preserves width, accessible value, and label for $progress', ({ progress, width, value, indeterminate }) => {
    const { container } = render(<ProgressCard data={{ ...base, title: 'Pinned', progress }} />);
    const bar = screen.getByRole('progressbar', { name: 'Pinned progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe(value);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.classList.contains('is-indeterminate')).toBe(indeterminate);
    expect(bar.querySelector('span')?.style.width).toBe(width);
    expect(container.querySelector('section')?.getAttribute('data-progress-card-id')).toBe('pin-card');
  });

  it('preserves empty supplied title and detail instead of falling back', () => {
    const { container } = render(<ProgressCard data={{ ...base, title: '', detail: '' }} />);
    expect(container.querySelector('strong')?.textContent).toBe('');
    expect(container.querySelector('small')?.textContent).toBe('');
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe(' progress');
  });

  it('uses the default caps and renders primary rows as spans and secondary rows as code', () => {
    const steps = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, label: `Step ${index}`, status: 'pending' as const }));
    const secondaryItems = Array.from({ length: 7 }, (_, index) => ({ id: `f${index}`, label: `file-${index}`, status: 'succeeded' as const }));
    const { container } = render(<ProgressCard data={{ ...base, steps, secondaryItems }} />);
    expect(container.querySelectorAll('.progress-card-steps > span')).toHaveLength(6);
    expect(container.querySelectorAll('.progress-card-secondary-item-list > code')).toHaveLength(5);
    expect(screen.queryByText('Step 6')).toBeNull();
    expect(screen.queryByText('file-5')).toBeNull();
    expect(screen.getByText('Files touched').tagName).toBe('SPAN');
  });

  it('omits both lists when explicit zero caps hide supplied items', () => {
    const { container } = render(<ProgressCard data={{ ...base,
      steps: [{ id: 's', label: 'step', status: 'running' }],
      secondaryItems: [{ id: 'f', label: 'file', status: 'succeeded' }],
    }} maxSteps={0} maxSecondaryItems={0} />);
    expect(container.querySelector('.progress-card-steps')).toBeNull();
    expect(container.querySelector('.progress-card-secondary-items')).toBeNull();
  });

  it('omits an explicitly empty secondary list and uses slice semantics for negative caps', () => {
    const { container } = render(<ProgressCard data={{ ...base,
      steps: [{ id: 's1', label: 'first', status: 'pending' }, { id: 's2', label: 'last', status: 'pending' }],
      secondaryItems: [],
    }} maxSteps={-1} />);
    expect(container.querySelector('.progress-card-secondary-items')).toBeNull();
    expect(screen.getByText('first').tagName).toBe('SPAN');
    expect(screen.queryByText('last')).toBeNull();
  });

  it('translates fallback copy, a custom secondary heading, and the progress label', () => {
    render(<I18nProvider initialLocale="fr" dictionaries={{ fr: {
      Running: 'En cours', 'In progress.': 'Traitement', Artifacts: 'Documents', '{title} progress': 'Avancement : {title}',
    } }}>
      <ProgressCard data={{ ...base, secondaryItemsLabel: 'Artifacts', secondaryItems: [{ id: 'f', label: 'a.ts', status: 'succeeded' }] }} />
    </I18nProvider>);
    expect(screen.getByText('En cours').tagName).toBe('STRONG');
    expect(screen.getByText('Traitement').tagName).toBe('SMALL');
    expect(screen.getByText('Documents').tagName).toBe('SPAN');
    expect(screen.getByRole('progressbar', { name: 'Avancement : En cours' }).getAttribute('aria-valuenow')).toBe('40');
  });
});
