import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../../constants.js';
import { AssetGrid } from '../AssetGrid.js';
import type { AssetGridDataPort, AssetGridLiveUpdateHandlers, AssetGridLiveUpdatesPort } from '../../../ports.js';
import type { AssetGridSelectors } from '../../../types.js';

type Asset = { id: string; title: string; kind: string };
const assets: Asset[] = [{ id: 'one', title: 'One', kind: 'image' }];
const selectors: AssetGridSelectors<Asset> = {
  getTitle: (asset) => asset.title,
  getKind: (asset) => asset.kind,
  getTimestamp: () => 0,
  getSource: () => 'upload',
};

describe('AssetGrid filter state characterization', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('defaults to raw facet labels and the package search debounce when controls are omitted', async () => {
    vi.useFakeTimers();
    const fetchAssets = vi.fn<AssetGridDataPort<Asset>['fetchAssets']>().mockResolvedValue(assets);
    const { container } = render(<AssetGrid selectors={selectors} renderThumbnail={() => null}
      dependencies={{ data: { fetchAssets } }} />);
    await act(async () => {});
    expect(container.querySelector('[data-badge="kind"]')).toHaveTextContent('image');
    expect(container.querySelector('[data-badge="source"]')).toHaveTextContent('upload');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' One ' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_SEARCH_DEBOUNCE_MS - 1); });
    expect(fetchAssets.mock.calls).toEqual([[{}]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchAssets.mock.calls).toEqual([[{}], [{ search: 'One' }]]);
  });

  it.each([
    { kind: '', source: '', search: '', filtered: false, query: {} },
    { kind: '', source: '', search: '  ', filtered: false, query: {} },
    { kind: 'image', source: '', search: '', filtered: true, query: { kind: 'image' } },
    { kind: '', source: 'upload', search: '', filtered: true, query: { source: 'upload' } },
    { kind: '', source: '', search: ' One ', filtered: true, query: { search: 'One' } },
    { kind: 'image', source: 'upload', search: ' One ', filtered: true,
      query: { kind: 'image', source: 'upload', search: 'One' } },
    { kind: 'all-images', source: '', search: '', filtered: true, query: {} },
  ])('retains raw filter membership for live ingest: $kind/$source/$search', async ({ kind, source, search, filtered, query }) => {
    vi.useFakeTimers();
    const fetchAssets = vi.fn<AssetGridDataPort<Asset>['fetchAssets']>().mockResolvedValue(assets);
    const fetchAssetById = vi.fn<NonNullable<AssetGridDataPort<Asset>['fetchAssetById']>>()
      .mockResolvedValue({ id: 'two', title: 'Two', kind: 'image' });
    let ingest: AssetGridLiveUpdateHandlers['onIngest'] = () => { throw new Error('Not subscribed'); };
    const liveUpdates: AssetGridLiveUpdatesPort = {
      subscribe: (handlers) => { ingest = handlers.onIngest; return () => {}; },
    };
    const { container } = render(<AssetGrid selectors={{ ...selectors,
      mapKindToQuery: (value) => value === 'all-images' ? undefined : value,
      matchesKindFilter: () => true,
    }} renderThumbnail={() => null} dependencies={{ data: { fetchAssets, fetchAssetById }, liveUpdates }}
      kindFacets={[{ value: '', label: 'All' }, { value: 'image', label: 'Images' }, { value: 'all-images', label: 'All images' }]}
      sourceFacets={[{ value: '', label: 'All' }, { value: 'upload', label: 'Uploads' }]}
      searchDebounceMs={0} liveUpdateCoalesceMs={1} />);
    await act(async () => {});
    expect(container.querySelector('[data-badge="kind"]')).toHaveTextContent('Images');
    expect(container.querySelector('[data-badge="source"]')).toHaveTextContent('Uploads');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by kind' }), { target: { value: kind } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by source' }), { target: { value: source } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: search } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchAssets).toHaveBeenLastCalledWith(query);
    fetchAssets.mockClear();
    act(() => { ingest('two'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchAssets.mock.calls).toEqual(filtered ? [[query]] : []);
    expect(fetchAssetById.mock.calls).toEqual(filtered ? [] : [['two']]);
    expect(screen.queryByRole('button', { name: 'Two' }) !== null).toBe(!filtered);

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by kind' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by source' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  ' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fetchAssets.mockClear();
    fetchAssetById.mockClear();
    act(() => { ingest('two'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchAssets).not.toHaveBeenCalled();
    expect(fetchAssetById.mock.calls).toEqual([['two']]);
  });
});
