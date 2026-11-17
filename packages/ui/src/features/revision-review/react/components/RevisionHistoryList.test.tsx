// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RevisionHistoryList } from './RevisionHistoryList.js';
import { I18nProvider, type useT } from '../../../i18n/index.js';
import type { RevisionReviewItem } from '../../types.js';

const revisions: RevisionReviewItem[] = [
  {
    id: 'r1',
    status: 'accepted',
    feedback: 'x',
    baseBody: 'a',
    proposedBody: 'b',
    createdAt: '2026-03-01T10:30:00.000Z',
    updatedAt: '2026-03-02T10:30:00.000Z',
    sectionTitle: 'Spacing',
  },
  {
    id: 'r2',
    status: 'rejected',
    feedback: 'y',
    baseBody: 'a',
    proposedBody: 'c',
    createdAt: '2026-03-01T10:30:00.000Z',
    updatedAt: '2026-03-03T10:30:00.000Z',
  },
];

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('RevisionHistoryList', () => {
  it('renders a row per revision with its status class and section title', () => {
    const { container } = render(<RevisionHistoryList revisions={revisions} />);
    expect(screen.getByText('Spacing')).toBeInTheDocument();
    expect(container.querySelector('.is-accepted')).not.toBeNull();
    expect(container.querySelector('.is-rejected')).not.toBeNull();
  });

  it('falls back to "General revision" when sectionTitle is absent', () => {
    render(<RevisionHistoryList revisions={revisions} />);
    expect(screen.getByText('General revision')).toBeInTheDocument();
  });

  it('renders nothing but the heading for an empty list', () => {
    render(<RevisionHistoryList revisions={[]} />);
    expect(screen.getByText('Revision history')).toBeInTheDocument();
  });

  it('renders translated labels end-to-end under an I18nProvider', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: { 'Revision history': 'Historique des révisions', accepted: 'accepté', rejected: 'rejeté' },
        }}
        initialLocale="fr"
      >
        <RevisionHistoryList revisions={revisions} />
      </I18nProvider>,
    );
    expect(screen.getByText('Historique des révisions')).toBeInTheDocument();
    expect(screen.getByText('accepté')).toBeInTheDocument();
    expect(screen.getByText('rejeté')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<RevisionHistoryList revisions={revisions} useTHook={useQuotingT} />);
    expect(screen.getByText('«Revision history»')).toBeInTheDocument();
  });
});
