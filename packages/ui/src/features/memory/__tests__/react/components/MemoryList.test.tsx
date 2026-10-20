// The saved-memory list is presentation over the entries/extractions hooks:
// the counts, the type-filter pills, the clear/refresh toolbar, and the
// unified card list. These pin the empty state, the filter/refresh/clear
// callbacks, and the extraction badge pluralization.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type MutableRefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MemoryList } from '../../../react/components/MemoryList.js';
import type { MemoryEntrySummary, MemoryExtractionRecord } from '../../../types.js';

function entry(over: Partial<MemoryEntrySummary> = {}): MemoryEntrySummary {
  return { id: 'e1', name: 'n', description: 'd', type: 'feedback', ...over };
}
function record(over: Partial<MemoryExtractionRecord> = {}): MemoryExtractionRecord {
  return { id: 'r1', startedAt: 1, phase: 'success', userMessagePreview: 'm', ...over };
}

function renderList(props: Partial<Parameters<typeof MemoryList>[0]> = {}) {
  const onFilterChange = vi.fn();
  const onClearExtractions = vi.fn();
  const onRefreshExtractions = vi.fn();
  const handlers = {
    onOpenPreview: vi.fn(),
    onStartEdit: vi.fn(),
    onDeleteEntry: vi.fn(),
    onDeleteExtraction: vi.fn(),
  };
  const sectionRef = createRef<HTMLElement>() as MutableRefObject<HTMLElement | null>;
  const utils = render(
    <MemoryList
      sectionRef={sectionRef}
      entries={[entry()]}
      filtered={[entry()]}
      visibleExtractions={[]}
      filter="all"
      onFilterChange={onFilterChange}
      unifiedMemoryCount={1}
      onClearExtractions={onClearExtractions}
      onRefreshExtractions={onRefreshExtractions}
      isRefreshing={false}
      previewId={null}
      previewBody={null}
      nowClock={0}
      {...handlers}
      {...props}
    />,
  );
  return { ...utils, onFilterChange, onClearExtractions, onRefreshExtractions, ...handlers };
}

describe('MemoryList', () => {
  it('renders the saved count and the entry card for each filtered entry', () => {
    renderList();
    expect(screen.getByText('1 saved')).toBeInTheDocument();
    expect(screen.getByText('n')).toBeInTheDocument();
  });

  it('renders the empty state when nothing is visible', () => {
    renderList({ entries: [], filtered: [], unifiedMemoryCount: 0 });
    expect(screen.getByText('No saved memories yet')).toBeInTheDocument();
    expect(screen.getByText('I prefer dark mode')).toBeInTheDocument();
  });

  it('fires onFilterChange for the "All" pill and a type pill', async () => {
    const { onFilterChange } = renderList({ entries: [entry({ type: 'feedback' })], filtered: [entry({ type: 'feedback' })] });
    await userEvent.click(screen.getByRole('button', { name: /All/ }));
    expect(onFilterChange).toHaveBeenCalledWith('all');
    // The feedback type has a nonzero count, so its pill renders.
    await userEvent.click(screen.getByRole('button', { name: /Feedback/i }));
    expect(onFilterChange).toHaveBeenCalledWith('feedback');
  });

  it('omits a zero-count type pill unless it is the active filter', () => {
    renderList({ entries: [entry({ type: 'feedback' })], filtered: [entry({ type: 'feedback' })] });
    expect(screen.queryByRole('button', { name: /Project/i })).toBeNull();
  });

  it('keeps a zero-count type pill visible while it is the active filter', () => {
    // `project` has no entries, but because it is the active filter the pill
    // stays rendered (the `count === 0 && filter !== type` cull is skipped).
    renderList({ entries: [entry({ type: 'feedback' })], filtered: [entry({ type: 'feedback' })], filter: 'project' });
    expect(screen.getByRole('button', { name: /Project/i })).toBeInTheDocument();
  });

  it('hides clear/refresh when there are no extractions', () => {
    renderList({ visibleExtractions: [] });
    expect(screen.queryByTitle('Clear extraction history')).toBeNull();
    expect(screen.queryByTitle('Refresh')).toBeNull();
  });

  it('shows clear/refresh only with extractions and wires both', async () => {
    const { onClearExtractions, onRefreshExtractions } = renderList({
      visibleExtractions: [record()],
      unifiedMemoryCount: 2,
    });
    // Singular extraction badge.
    expect(screen.getByText(/1 extraction$/)).toBeInTheDocument();
    await userEvent.click(screen.getByTitle('Clear extraction history'));
    await userEvent.click(screen.getByTitle('Refresh'));
    expect(onClearExtractions).toHaveBeenCalled();
    expect(onRefreshExtractions).toHaveBeenCalled();
  });

  it('shows the refreshing label and disables refresh while a refresh is in flight', () => {
    renderList({ visibleExtractions: [record()], unifiedMemoryCount: 2, isRefreshing: true });
    expect(screen.getByText('Refreshing')).toBeInTheDocument();
    expect(screen.getByTitle('Refresh')).toBeDisabled();
  });

  it('pluralizes the extraction badge past one', () => {
    renderList({
      visibleExtractions: [record({ id: 'r1' }), record({ id: 'r2' })],
      unifiedMemoryCount: 3,
    });
    expect(screen.getByText(/2 extractions$/)).toBeInTheDocument();
  });

  it('renders extraction cards alongside entry cards when the unified list has both', () => {
    renderList({
      entries: [entry()],
      filtered: [entry()],
      visibleExtractions: [record({ userMessagePreview: 'extraction row' })],
      unifiedMemoryCount: 2,
    });
    expect(screen.getByText('n')).toBeInTheDocument();
    expect(screen.getByText('extraction row')).toBeInTheDocument();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    const sectionRef = createRef<HTMLElement>() as MutableRefObject<HTMLElement | null>;
    render(
      <I18nProvider dictionaries={{ fr: { 'Saved memory': 'Mémoire enregistrée', All: 'Tout' } }} initialLocale="fr">
        <MemoryList
          sectionRef={sectionRef}
          entries={[]}
          filtered={[]}
          visibleExtractions={[]}
          filter="all"
          onFilterChange={vi.fn()}
          unifiedMemoryCount={0}
          onClearExtractions={vi.fn()}
          onRefreshExtractions={vi.fn()}
          isRefreshing={false}
          previewId={null}
          previewBody={null}
          nowClock={0}
          onOpenPreview={vi.fn()}
          onStartEdit={vi.fn()}
          onDeleteEntry={vi.fn()}
          onDeleteExtraction={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Mémoire enregistrée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tout/ })).toBeInTheDocument();
  });

  it('publishes no agent handles when no agentHandle is given', () => {
    const { container } = renderList({ visibleExtractions: [record()], unifiedMemoryCount: 2 });
    expect(container.querySelector('[data-agent-element]')).toBeNull();
  });

  it('publishes the toolbar sub-handles under the agentHandle base', () => {
    const { container } = renderList({ agentHandle: 'mem', visibleExtractions: [record()], unifiedMemoryCount: 2 });
    const handles = [...container.querySelectorAll('.library-toolbar [data-agent-element]')].map((el) => el.getAttribute('data-agent-element'));
    expect(handles).toEqual(['mem-filter-all', 'mem-filter-feedback', 'mem-clear-extractions', 'mem-refresh-extractions']);
  });

  it('publishes per-row entry and extraction sub-handles under the agentHandle base', () => {
    const { container } = renderList({
      agentHandle: 'mem',
      entries: [entry({ id: 'E1' })],
      filtered: [entry({ id: 'E1' })],
      visibleExtractions: [record({ id: 'R1' })],
      unifiedMemoryCount: 2,
    });
    const handles = [...container.querySelectorAll('.memory-unified-list [data-agent-element]')].map((el) => el.getAttribute('data-agent-element'));
    expect(handles).toContain('mem-entry-e1-preview');
    expect(handles).toContain('mem-extraction-r1-delete');
  });

  it('counts every saved entry plus visible extractions on the All pill', () => {
    const { container } = renderList({
      entries: [entry({ id: 'a' }), entry({ id: 'b', type: 'rule' })],
      filtered: [entry({ id: 'a' })],
      visibleExtractions: [record()],
      unifiedMemoryCount: 2,
    });
    const counts = [...container.querySelectorAll('.filter-pill-count')].map((el) => el.textContent);
    expect(counts).toEqual(['3', '1', '1']);
    expect(container.querySelector('.filter-pill.active')?.textContent).toBe('All3');
  });

  it('marks only the active type pill as active', () => {
    const { container } = renderList({ filter: 'feedback' });
    expect([...container.querySelectorAll('.filter-pill.active')].map((el) => el.textContent)).toEqual(['Feedback1']);
  });

  it('spins the refresh icon only while refreshing', () => {
    const idle = renderList({ visibleExtractions: [record()], unifiedMemoryCount: 2 });
    expect(idle.container.querySelector('.memory-refresh-extractions .icon-spin')).toBeNull();
    idle.unmount();
    const busy = renderList({ visibleExtractions: [record()], unifiedMemoryCount: 2, isRefreshing: true });
    expect(busy.container.querySelector('.memory-refresh-extractions .icon-spin')).not.toBeNull();
  });

  it('routes an extraction row delete to onDeleteExtraction with its id', async () => {
    const { container, onDeleteExtraction, onDeleteEntry } = renderList({
      agentHandle: 'mem',
      visibleExtractions: [record({ id: 'r9' })],
      unifiedMemoryCount: 2,
    });
    const remove = container.querySelector('[data-agent-element="mem-extraction-r9-delete"]');
    expect(remove).not.toBeNull();
    await userEvent.click(remove as HTMLElement);
    expect(onDeleteExtraction).toHaveBeenCalledWith('r9');
    expect(onDeleteEntry).not.toHaveBeenCalled();
  });
});
