import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { DeckNavigationControls } from '../../../react/components/DeckNavigationControls.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('DeckNavigationControls', () => {
  it('renders nothing when there is no counter label yet', () => {
    const { container } = render(
      <DeckNavigationControls canGoPrev={false} canGoNext={false} counterLabel={null} onPrev={vi.fn()} onNext={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the counter and gates prev/next by the given booleans', () => {
    render(
      <DeckNavigationControls canGoPrev={false} canGoNext={true} counterLabel="1 / 3" onPrev={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeEnabled();
  });

  it('calls onPrev/onNext on click', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <DeckNavigationControls canGoPrev canGoNext counterLabel="2 / 3" onPrev={onPrev} onNext={onNext} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('renders translated strings under I18nProvider', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: { 'Slide navigation': 'Navigation des diapositives', 'Previous slide': 'Diapositive précédente', 'Next slide': 'Diapositive suivante' },
        }}
        initialLocale="fr"
      >
        <DeckNavigationControls canGoPrev canGoNext counterLabel="2 / 3" onPrev={vi.fn()} onNext={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'Navigation des diapositives' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diapositive précédente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diapositive suivante' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<DeckNavigationControls canGoPrev canGoNext counterLabel="1 / 3" onPrev={vi.fn()} onNext={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Previous slide»' })).toBeInTheDocument();
  });
});
