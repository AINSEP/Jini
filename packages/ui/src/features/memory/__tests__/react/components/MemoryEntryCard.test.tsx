// The saved-memory card is pure presentation: it renders a title/description,
// a preview disclosure whose open/closed state is owned by the orchestrator,
// and edit/delete actions. These pin the description-fallback branch, the
// three preview-body states (loading / empty / rendered), and the action
// callbacks.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MemoryEntryCard } from '../../../react/components/MemoryEntryCard.js';
import type { MemoryEntrySummary } from '../../../types.js';

function entry(over: Partial<MemoryEntrySummary> = {}): MemoryEntrySummary {
  return {
    id: 'e1',
    name: 'Prefers dark mode',
    description: 'A saved preference',
    type: 'feedback',
    ...over,
  };
}

function renderCard(props: Partial<Parameters<typeof MemoryEntryCard>[0]> = {}) {
  const onOpenPreview = vi.fn();
  const onStartEdit = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <MemoryEntryCard
      entry={entry()}
      previewId={null}
      previewBody={null}
      onOpenPreview={onOpenPreview}
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      {...props}
    />,
  );
  return { ...utils, onOpenPreview, onStartEdit, onDelete };
}

describe('MemoryEntryCard', () => {
  it('renders the entry name and description', () => {
    renderCard();
    expect(screen.getByText('Prefers dark mode')).toBeInTheDocument();
    expect(screen.getByText('A saved preference')).toBeInTheDocument();
  });

  it('falls back to an em dash when the entry has no description', () => {
    renderCard({ entry: entry({ description: '' }) });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('wires the preview / edit / delete actions to their callbacks', async () => {
    const { onOpenPreview, onStartEdit, onDelete } = renderCard();
    await userEvent.click(screen.getByTitle('Preview'));
    await userEvent.click(screen.getByTitle('Edit'));
    await userEvent.click(screen.getByTitle('Delete'));
    expect(onOpenPreview).toHaveBeenCalledWith('e1');
    expect(onStartEdit).toHaveBeenCalledWith('e1');
    expect(onDelete).toHaveBeenCalledWith('e1');
  });

  it('does not render a preview section when previewId does not match the entry', () => {
    renderCard({ previewId: 'other', previewBody: 'body' });
    expect(document.querySelector('.library-preview')).toBeNull();
  });

  it('shows a loading line while the preview body is still null and open', () => {
    renderCard({ previewId: 'e1', previewBody: null });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an em-dash hint when the open preview body is empty', () => {
    renderCard({ previewId: 'e1', previewBody: '' });
    // The empty-body branch renders a hint em dash inside the open preview.
    expect(document.querySelector('.library-preview .hint')?.textContent).toBe('—');
  });

  it('renders the markdown body when the open preview has content', () => {
    renderCard({ previewId: 'e1', previewBody: 'Hello **world**' });
    expect(document.querySelector('.library-preview-body')).not.toBeNull();
    expect(screen.getByText('world')).toBeInTheDocument();
    expect(document.querySelector('.library-preview-body strong')?.textContent).toBe('world');
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Preview: 'Aperçu', Edit: 'Modifier', Delete: 'Supprimer' } }} initialLocale="fr">
        <MemoryEntryCard
          entry={entry()}
          previewId={null}
          previewBody={null}
          onOpenPreview={vi.fn()}
          onStartEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByTitle('Aperçu')).toBeInTheDocument();
    expect(screen.getByTitle('Modifier')).toBeInTheDocument();
    expect(screen.getByTitle('Supprimer')).toBeInTheDocument();
  });
});
