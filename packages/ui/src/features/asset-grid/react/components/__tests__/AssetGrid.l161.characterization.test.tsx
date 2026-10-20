// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetGrid, type AssetGridProps } from '../AssetGrid.js';
import { createFakeAssetGridDependencies } from '../../../dependencies.js';
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../../constants.js';
import type { AssetGridDataPort, AssetGridLiveUpdateHandlers, AssetGridLiveUpdatesPort } from '../../../ports.js';
import type { AssetGridSelectors } from '../../../types.js';

type Asset = { id: string; title: string; kind: string };
const assets: Asset[] = [{ id: 'one', title: 'One', kind: 'image' }];
const selectors: AssetGridSelectors<Asset> = {
  getTitle: (asset) => asset.title, getKind: (asset) => asset.kind,
  getTimestamp: () => new Date(2026, 9, 20).getTime(),
};

function grid(overrides: Partial<AssetGridProps<Asset>>, _options = {}) {
  return render(<AssetGrid selectors={selectors} renderThumbnail={() => <span>Thumbnail</span>}
    dependencies={createFakeAssetGridDependencies({ assets })} {...overrides} />);
}

describe('AssetGrid L161 characterization', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows loading ahead of a custom empty state while the first fetch is pending', () => {
    const data: AssetGridDataPort<Asset> = { fetchAssets: () => new Promise(() => {}) };
    grid({ dependencies: { data }, emptyState: <span>Custom empty</span> });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Custom empty')).not.toBeInTheDocument();
    expect(screen.queryByText('No assets yet.')).not.toBeInTheDocument();
  });

  it.each([undefined, null, false, '', 0, 'Custom empty'])('retains the empty-state value %s', async (emptyState) => {
    const { container } = grid({ dependencies: createFakeAssetGridDependencies({ assets: [] }), emptyState });
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.queryByText('No assets yet.') !== null).toBe(emptyState == null);
    expect(screen.queryByText('Custom empty') !== null).toBe(emptyState === 'Custom empty');
    if (emptyState === 0) expect(container.querySelector('.asset-grid-root')).toHaveTextContent('0');
    expect(container.querySelector('.asset-grid-grid')).toBeNull();
  });

  it('keeps loaded cards visible during a refresh', async () => {
    const fetchAssets = vi.fn<AssetGridDataPort<Asset>['fetchAssets']>()
      .mockResolvedValueOnce(assets).mockImplementation(() => new Promise(() => {}));
    grid({ dependencies: { data: { fetchAssets } } });
    await screen.findByRole('button', { name: 'One' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(fetchAssets).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('defaults to grid mode and retains a user-selected mode across rerenders', async () => {
    const result = grid({});
    await screen.findByRole('button', { name: 'One' });
    expect(result.container.querySelector('.asset-grid-grid')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(result.container.querySelector('.asset-grid-timeline')).not.toBeNull();
    result.rerender(<AssetGrid selectors={selectors} renderThumbnail={() => null} initialViewMode="grid"
      dependencies={createFakeAssetGridDependencies({ assets })} />);
    expect(result.container.querySelector('.asset-grid-timeline')).not.toBeNull();
  });

  it('accepts an explicit initial timeline mode and day-key selector', async () => {
    const getDayKey = vi.fn(() => 'custom-day');
    const { container } = grid({ initialViewMode: 'timeline', selectors: { ...selectors, getDayKey } });
    await screen.findByRole('button', { name: 'One' });
    expect(container.querySelector('.asset-grid-timeline')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'custom-day' })).toBeInTheDocument();
    expect(getDayKey).toHaveBeenCalledWith(assets[0]);
  });

  it('resolves supplied facet labels and falls back to the raw kind when facets are omitted', async () => {
    const result = grid({
      selectors: { ...selectors, getSource: () => 'upload' },
      kindFacets: [{ value: 'image', label: 'Images' }],
      sourceFacets: [{ value: 'upload', label: 'Uploads' }],
    });
    await screen.findByRole('button', { name: 'One' });
    expect(result.container.querySelector('[data-badge="kind"]')).toHaveTextContent('Images');
    expect(result.container.querySelector('[data-badge="source"]')).toHaveTextContent('Uploads');
    result.rerender(<AssetGrid selectors={selectors} renderThumbnail={() => null}
      dependencies={createFakeAssetGridDependencies({ assets })} />);
    expect(result.container.querySelector('[data-badge="kind"]')).toHaveTextContent('image');
    expect(result.container.querySelector('[data-badge="source"]')).toBeNull();
  });

  it.each(['kind', 'source', 'search'] as const)('passes the %s filter through the data port', async (filter) => {
    const fetchAssets = vi.fn<AssetGridDataPort<Asset>['fetchAssets']>().mockResolvedValue(assets);
    grid({ dependencies: { data: { fetchAssets } }, searchDebounceMs: 0,
      kindFacets: [{ value: '', label: 'All' }, { value: 'image', label: 'Images' }],
      sourceFacets: [{ value: '', label: 'All' }, { value: 'upload', label: 'Uploads' }],
    });
    await screen.findByRole('button', { name: 'One' });
    if (filter === 'search') fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' One ' } });
    else fireEvent.change(screen.getByRole('combobox', { name: `Filter by ${filter}` }), {
      target: { value: filter === 'kind' ? 'image' : 'upload' },
    });
    await waitFor(() => expect(fetchAssets).toHaveBeenLastCalledWith({ [filter]: filter === 'kind' ? 'image' : filter === 'source' ? 'upload' : 'One' }));
  });

  it('uses the default search debounce and omits whitespace-only search', async () => {
    vi.useFakeTimers();
    const fetchAssets = vi.fn<AssetGridDataPort<Asset>['fetchAssets']>().mockResolvedValue(assets);
    grid({ dependencies: { data: { fetchAssets } } });
    await act(async () => {});
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'One' } });
    await act(async () => { vi.advanceTimersByTime(DEFAULT_SEARCH_DEBOUNCE_MS - 1); });
    expect(fetchAssets).toHaveBeenCalledTimes(1);
    expect(fetchAssets).toHaveBeenCalledWith({});
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(fetchAssets).toHaveBeenLastCalledWith({ search: 'One' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  ' } });
    await act(async () => { vi.advanceTimersByTime(DEFAULT_SEARCH_DEBOUNCE_MS); });
    expect(fetchAssets).toHaveBeenLastCalledWith({});
  });

  it.each([
    { filter: 'none', query: {}, filtered: false },
    { filter: 'whitespace', query: {}, filtered: false },
    { filter: 'kind', query: { kind: 'image' }, filtered: true },
    { filter: 'source', query: { source: 'upload' }, filtered: true },
    { filter: 'search', query: { search: 'One' }, filtered: true },
  ])('uses full reloads only for active filters on ingest: $filter', async ({ filter, query, filtered }) => {
    vi.useFakeTimers();
    const fetchAssets = vi.fn<AssetGridDataPort<Asset>['fetchAssets']>().mockResolvedValue(assets);
    const fetchAssetById = vi.fn<NonNullable<AssetGridDataPort<Asset>['fetchAssetById']>>()
      .mockResolvedValue({ id: 'two', title: 'Two', kind: 'image' });
    let onIngest: AssetGridLiveUpdateHandlers['onIngest'] = () => { throw new Error('Not subscribed'); };
    const liveUpdates: AssetGridLiveUpdatesPort = {
      subscribe: (handlers) => { onIngest = handlers.onIngest; return () => {}; },
    };
    grid({
      dependencies: { data: { fetchAssets, fetchAssetById }, liveUpdates },
      searchDebounceMs: 0,
      liveUpdateCoalesceMs: 1,
      kindFacets: [{ value: '', label: 'All' }, { value: 'image', label: 'Images' }],
      sourceFacets: [{ value: '', label: 'All' }, { value: 'upload', label: 'Uploads' }],
    });
    await act(async () => {});
    if (filter === 'kind' || filter === 'source') {
      fireEvent.change(screen.getByRole('combobox', { name: `Filter by ${filter}` }), {
        target: { value: filter === 'kind' ? 'image' : 'upload' },
      });
    }
    if (filter === 'search' || filter === 'whitespace') {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: filter === 'search' ? 'One' : '  ' } });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fetchAssets.mockClear();
    act(() => { onIngest('two'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    if (filtered) {
      expect(fetchAssets).toHaveBeenCalledTimes(1);
      expect(fetchAssets).toHaveBeenCalledWith(query);
      expect(fetchAssetById).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Two' })).not.toBeInTheDocument();
    } else {
      expect(fetchAssets).not.toHaveBeenCalled();
      expect(fetchAssetById).toHaveBeenCalledTimes(1);
      expect(fetchAssetById).toHaveBeenCalledWith('two');
      expect(screen.getByRole('button', { name: 'Two' })).toBeInTheDocument();
    }
  });

  it('opens Delete confirmation without a host handler and retains rows and selection (reported, not fixed)', async () => {
    grid({});
    await screen.findByRole('button', { name: 'One' });
    fireEvent.click(screen.getByRole('button', { name: 'Select asset' }));
    fireEvent.keyDown(window, { key: 'Delete' });
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 1' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
