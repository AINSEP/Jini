// The extraction-history card renders a phase pill, title/meta, an optional
// failure explanation, the written-entry chips, and a delete action. These
// pin the written-id chips (each opens the preview), the failed-with-error
// branch, the skipped-with-reason branch, and the delete callback.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MemoryExtractionCard } from '../../../react/components/MemoryExtractionCard.js';
import type { MemoryExtractionRecord } from '../../../types.js';

function record(over: Partial<MemoryExtractionRecord> = {}): MemoryExtractionRecord {
  return {
    id: 'r1',
    startedAt: 1_000,
    phase: 'success',
    userMessagePreview: 'a saved fact',
    ...over,
  };
}

function renderCard(over: Partial<MemoryExtractionRecord> = {}) {
  const onOpenPreview = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <MemoryExtractionCard record={record(over)} nowClock={5_000} onOpenPreview={onOpenPreview} onDelete={onDelete} />,
  );
  return { ...utils, onOpenPreview, onDelete };
}

describe('MemoryExtractionCard', () => {
  it('renders the title, phase pill, and kind badge for a successful record', () => {
    renderCard();
    expect(screen.getByText('a saved fact')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(document.querySelector('.memory-extraction-card.is-success')).not.toBeNull();
  });

  it('renders a written-id chip per entry and opens its preview on click', async () => {
    const { onOpenPreview } = renderCard({ writtenIds: ['user_role', 'feedback_tests'] });
    const roleChip = screen.getByTitle('user_role');
    const testsChip = screen.getByTitle('feedback_tests');
    expect(roleChip).toBeInTheDocument();
    expect(testsChip).toBeInTheDocument();
    await userEvent.click(roleChip);
    expect(onOpenPreview).toHaveBeenCalledWith('user_role');
  });

  it('omits the written-id counts section when writtenIds is empty or absent', () => {
    renderCard({ writtenIds: [] });
    expect(document.querySelector('.memory-extraction-counts')).toBeNull();
  });

  it('renders the failure explanation for a failed record with an error', () => {
    renderCard({ phase: 'failed', error: 'quota_exceeded' });
    const failure = document.querySelector('.memory-extraction-failure');
    expect(failure).not.toBeNull();
    expect(failure?.textContent).toContain('quota or rate limit hit');
  });

  it('omits the failure explanation for a failed record with no error', () => {
    renderCard({ phase: 'failed', error: undefined });
    expect(document.querySelector('.memory-extraction-failure')).toBeNull();
  });

  it('renders the skip-reason line for a skipped record', () => {
    renderCard({ phase: 'skipped', reason: 'no-provider' });
    expect(screen.getByText('No memory extraction model is configured.')).toBeInTheDocument();
  });

  it('omits the skip-reason line for a record that was not skipped', () => {
    renderCard();
    expect(document.querySelector('.memory-extraction-reason')).toBeNull();
  });

  it('wires the delete action', async () => {
    const { onDelete } = renderCard();
    await userEvent.click(screen.getByLabelText('Remove'));
    expect(onDelete).toHaveBeenCalledWith('r1');
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Done: 'Terminé', Remove: 'Retirer' } }} initialLocale="fr">
        <MemoryExtractionCard record={record()} nowClock={5_000} onOpenPreview={vi.fn()} onDelete={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Terminé')).toBeInTheDocument();
    expect(screen.getByLabelText('Retirer')).toBeInTheDocument();
  });
});
