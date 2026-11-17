// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RevisionDiffCard } from './RevisionDiffCard.js';
import { I18nProvider, type useT } from '../../../i18n/index.js';
import type { RevisionReviewItem } from '../../types.js';

const revision: RevisionReviewItem = {
  id: 'r1',
  status: 'pending',
  feedback: 'Tighten the spacing scale.',
  baseBody: 'line1\nline2',
  proposedBody: 'line1\nline2\nline3',
  createdAt: '2026-03-01T10:30:00.000Z',
  updatedAt: '2026-03-01T10:30:00.000Z',
  sectionTitle: 'Spacing',
};

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('RevisionDiffCard', () => {
  it('renders the feedback and the diff-added-lines preview', () => {
    render(<RevisionDiffCard revision={revision} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('Tighten the spacing scale.')).toBeInTheDocument();
    expect(screen.getByText('line3')).toBeInTheDocument();
    expect(screen.queryByText(/line1/)).not.toBeInTheDocument();
  });

  it('falls back to the full proposed body when there is no diff (identical base/proposed)', () => {
    render(
      <RevisionDiffCard
        revision={{ ...revision, baseBody: revision.proposedBody }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText((_, el) => el?.textContent === 'line1\nline2\nline3')).toBeInTheDocument();
  });

  it('renders the section title and timestamp', () => {
    render(<RevisionDiffCard revision={revision} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText(/Spacing/)).toBeInTheDocument();
  });

  it('omits the section title prefix when absent, showing only the timestamp', () => {
    const { sectionTitle: _sectionTitle, ...withoutSection } = revision;
    render(<RevisionDiffCard revision={withoutSection} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.queryByText(/Spacing/)).not.toBeInTheDocument();
    expect(screen.getByText(/Mar 1/)).toBeInTheDocument();
  });

  it('omits the file draft preview section when there are no file changes', () => {
    render(<RevisionDiffCard revision={revision} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.queryByText('File draft preview')).not.toBeInTheDocument();
  });

  it('renders a per-file diff preview when fileChanges are present', () => {
    render(
      <RevisionDiffCard
        revision={{
          ...revision,
          fileChanges: [{ path: 'tokens.json', baseContent: 'a', proposedContent: 'a\nb' }],
        }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('File draft preview')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === 'tokens.json\n\nb')).toBeInTheDocument();
  });

  it('falls back to the full proposed content for a file change with no diff', () => {
    render(
      <RevisionDiffCard
        revision={{
          ...revision,
          fileChanges: [{ path: 'tokens.json', baseContent: 'same', proposedContent: 'same' }],
        }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText((_, el) => el?.textContent === 'tokens.json\n\nsame')).toBeInTheDocument();
  });

  it('calls onAccept/onReject and disables both buttons while saving', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { rerender } = render(<RevisionDiffCard revision={revision} onAccept={onAccept} onReject={onReject} />);
    await userEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText('Reject'));
    expect(onReject).toHaveBeenCalledTimes(1);

    rerender(<RevisionDiffCard revision={revision} saving onAccept={onAccept} onReject={onReject} />);
    expect(screen.getByText('Accept')).toBeDisabled();
    expect(screen.getByText('Reject')).toBeDisabled();
  });

  it('renders translated labels end-to-end under an I18nProvider', () => {
    render(
      <I18nProvider
        dictionaries={{ fr: { 'Pending revision': 'Révision en attente', Accept: 'Accepter', Reject: 'Rejeter' } }}
        initialLocale="fr"
      >
        <RevisionDiffCard revision={revision} onAccept={vi.fn()} onReject={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByText('Révision en attente')).toBeInTheDocument();
    expect(screen.getByText('Accepter')).toBeInTheDocument();
    expect(screen.getByText('Rejeter')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<RevisionDiffCard revision={revision} onAccept={vi.fn()} onReject={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByText('«Pending revision»')).toBeInTheDocument();
  });
});
