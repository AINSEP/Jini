import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { ProgressCard } from '../../components/ProgressCard.js';
import type { ProgressCardData } from '../../types.js';

function data(overrides: Partial<ProgressCardData> = {}): ProgressCardData {
  return { id: 'run-1', status: 'running', progress: 40, steps: [], ...overrides };
}

describe('ProgressCard', () => {
  it('renders a supplied title/detail verbatim, without falling back to defaults', () => {
    render(<ProgressCard data={data({ title: 'Rebuilding tokens', detail: 'Preparing a draft.' })} />);
    expect(screen.getByText('Rebuilding tokens')).toBeTruthy();
    expect(screen.getByText('Preparing a draft.')).toBeTruthy();
  });

  it.each([
    ['pending', 'Queued'],
    ['running', 'Running'],
    ['succeeded', 'Complete'],
    ['failed', 'Needs attention'],
  ] as const)('falls back to a neutral title for status=%s', (status, expectedTitle) => {
    render(<ProgressCard data={data({ status })} />);
    expect(screen.getByText(expectedTitle)).toBeTruthy();
  });

  it('renders a determinate progress bar with the clamped percentage width and aria-valuenow', () => {
    render(<ProgressCard data={data({ progress: 137 })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.className).not.toContain('is-indeterminate');
  });

  it('renders an indeterminate progress bar with no aria-valuenow', () => {
    render(<ProgressCard data={data({ progress: 'indeterminate' })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.className).toContain('is-indeterminate');
  });

  it('renders every status transition with the matching section class', () => {
    (['pending', 'running', 'succeeded', 'failed'] as const).forEach((status) => {
      const { container, unmount } = render(<ProgressCard data={data({ status })} />);
      expect(container.querySelector(`.progress-card.is-${status}`)).toBeTruthy();
      unmount();
    });
  });

  it('renders the step list with per-step status classes and a check icon only for succeeded steps', () => {
    render(
      <ProgressCard
        data={data({
          steps: [
            { id: 'a', label: 'First', status: 'succeeded' },
            { id: 'b', label: 'Second', status: 'running' },
          ],
        })}
      />,
    );
    const first = screen.getByText('First').closest('span');
    const second = screen.getByText('Second').closest('span');
    expect(first?.className).toContain('is-succeeded');
    expect(first?.querySelector('svg')).toBeTruthy();
    expect(second?.className).toContain('is-running');
    expect(second?.querySelector('svg')).toBeFalsy();
  });

  it('renders nothing for the step section when steps is empty', () => {
    const { container } = render(<ProgressCard data={data({ steps: [] })} />);
    expect(container.querySelector('.jini-progress-card-steps')).toBeNull();
  });

  it('caps rendered steps at maxSteps', () => {
    const steps = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      label: `Step ${index}`,
      status: 'pending' as const,
    }));
    render(<ProgressCard data={data({ steps })} maxSteps={3} />);
    expect(screen.getAllByText(/^Step \d$/)).toHaveLength(3);
  });

  it('renders secondaryItems under a default "Files touched" heading, capped at maxSecondaryItems', () => {
    const secondaryItems = Array.from({ length: 7 }, (_, index) => ({
      id: `f${index}`,
      label: `file-${index}.ts`,
      status: 'succeeded' as const,
    }));
    render(<ProgressCard data={data({ secondaryItems })} maxSecondaryItems={2} />);
    expect(screen.getByText('Files touched')).toBeTruthy();
    expect(screen.getAllByText(/^file-\d\.ts$/)).toHaveLength(2);
  });

  it('omits the secondary-items section entirely when there are none', () => {
    const { container } = render(<ProgressCard data={data()} />);
    expect(container.querySelector('.jini-progress-card-secondary-items')).toBeNull();
  });

  it('renders translated title/detail/heading copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            Running: 'En cours',
            'In progress.': 'En cours de traitement.',
            'Files touched': 'Fichiers modifiés',
          },
        }}
        initialLocale="fr"
      >
        <ProgressCard
          data={data({
            secondaryItems: [{ id: 'f1', label: 'a.ts', status: 'succeeded' }],
          })}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('En cours')).toBeTruthy();
    expect(screen.getByText('En cours de traitement.')).toBeTruthy();
    expect(screen.getByText('Fichiers modifiés')).toBeTruthy();
  });
});
