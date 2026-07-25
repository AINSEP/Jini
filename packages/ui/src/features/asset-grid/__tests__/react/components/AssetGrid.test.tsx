import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssetGrid } from '../../../react/components/AssetGrid.js';
import { createFakeAssetGridDependencies } from '../../../dependencies.js';
import { I18nProvider } from '../../../../i18n/index.js';
import type { AssetGridSelectors } from '../../../types.js';

interface TestAsset {
  id: string;
  kind: string;
  source?: string;
  title: string;
  capturedAt: number;
}

const NOW = Date.now();

function makeAssets(): TestAsset[] {
  return [
    { id: 'a', kind: 'image', source: 'clipper', title: 'Sunset photo', capturedAt: NOW },
    { id: 'b', kind: 'video', source: 'upload', title: 'Demo clip', capturedAt: NOW - 1000 },
  ];
}

const selectors: AssetGridSelectors<TestAsset> = {
  getKind: (a) => a.kind,
  getSource: (a) => a.source,
  getTimestamp: (a) => a.capturedAt,
  getTitle: (a) => a.title,
};

function fakeDeps(assets: TestAsset[]) {
  return createFakeAssetGridDependencies<TestAsset>({
    assets,
    matchesQuery: (a, q) =>
      (!q.kind || a.kind === q.kind) &&
      (!q.source || a.source === q.source) &&
      (!q.search || a.title.toLowerCase().includes(q.search.toLowerCase())),
  });
}

function renderGrid(overrides: Partial<React.ComponentProps<typeof AssetGrid<TestAsset>>> = {}) {
  const assets = makeAssets();
  const deps = overrides.dependencies ?? fakeDeps(assets);
  return render(
    <AssetGrid<TestAsset>
      selectors={selectors}
      dependencies={deps}
      renderThumbnail={() => <div data-testid="thumb" />}
      kindFacets={[
        { value: '', label: 'All kinds' },
        { value: 'image', label: 'Images' },
        { value: 'video', label: 'Videos' },
      ]}
      searchDebounceMs={0}
      {...overrides}
    />,
  );
}

describe('AssetGrid', () => {
  it('loads and renders assets', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    expect(screen.getByText('Demo clip')).toBeInTheDocument();
  });

  it('shows the empty state when there are no assets', async () => {
    renderGrid({ dependencies: fakeDeps([]) });
    await waitFor(() => expect(screen.getByText('No assets yet.')).toBeInTheDocument());
  });

  it('filters by the kind facet', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by kind' }), 'video');
    await waitFor(() => expect(screen.queryByText('Sunset photo')).not.toBeInTheDocument());
    expect(screen.getByText('Demo clip')).toBeInTheDocument();
  });

  it('filters by a debounced search', async () => {
    renderGrid({ searchDebounceMs: 30 });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'demo');
    await waitFor(() => expect(screen.queryByText('Sunset photo')).not.toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('Demo clip')).toBeInTheDocument();
  });

  it('clicking a card preview calls onPreview with the asset', async () => {
    const onPreview = vi.fn();
    renderGrid({ onPreview });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Preview Sunset photo' }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('selecting a card shows the selection bar with select-all/clear', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Select asset' })[0]!);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('bulk delete: request -> confirm dialog -> confirm calls onDeleteSelected and removes the items', async () => {
    const onDeleteSelected = vi.fn().mockResolvedValue(undefined);
    renderGrid({ onDeleteSelected });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Select asset' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 1 asset?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 1' }));
    await waitFor(() => expect(onDeleteSelected).toHaveBeenCalledWith(['a']));
    await waitFor(() => expect(screen.queryByText('Sunset photo')).not.toBeInTheDocument());
    expect(screen.getByText('Demo clip')).toBeInTheDocument();
  });

  it('bulk delete: cancel closes the dialog without calling onDeleteSelected', async () => {
    const onDeleteSelected = vi.fn();
    renderGrid({ onDeleteSelected });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Select asset' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onDeleteSelected).not.toHaveBeenCalled();
    expect(screen.getByText('Sunset photo')).toBeInTheDocument();
  });

  it('Cmd/Ctrl+A selects all, Escape clears the selection', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.keyboard('{Meta>}a{/Meta}');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('the Delete key opens the bulk-delete confirm dialog when a selection exists', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Select asset' })[0]!);
    await userEvent.keyboard('{Delete}');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('per-card Remove calls onDeleteAsset and removes just that card', async () => {
    const onDeleteAsset = vi.fn().mockResolvedValue(undefined);
    renderGrid({ onDeleteAsset });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(removeButtons[0]!);
    await waitFor(() => expect(onDeleteAsset).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.queryByText('Sunset photo')).not.toBeInTheDocument());
    expect(screen.getByText('Demo clip')).toBeInTheDocument();
  });

  it('the Grid/Timeline toggle switches rendering mode', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('renders host-supplied renderCardExtra and renderBulkActions', async () => {
    renderGrid({
      renderCardExtra: (asset) => <a href={`/open/${asset.id}`}>Open project</a>,
      renderBulkActions: (ids) => <span data-testid="bulk">{ids.length}</span>,
    });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    expect(screen.getAllByRole('link', { name: 'Open project' })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Select asset' })[0]!);
    expect(screen.getByTestId('bulk')).toHaveTextContent('1');
  });

  it('Refresh button re-fetches the current query', async () => {
    const assets = makeAssets();
    const deps = fakeDeps(assets);
    const fetchAssetsSpy = vi.spyOn(deps.data, 'fetchAssets');
    renderGrid({ dependencies: deps });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    const callsBeforeRefresh = fetchAssetsSpy.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(fetchAssetsSpy.mock.calls.length).toBe(callsBeforeRefresh + 1));
  });

  it('renders a host-supplied subtitle and omits the source badge when getSource yields nothing', async () => {
    const assets = makeAssets();
    const selectorsWithSubtitleNoSource: AssetGridSelectors<TestAsset> = {
      getKind: (a) => a.kind,
      // No getSource at all -> sourceValue is always undefined -> AssetGrid's
      // `sourceValue ? resolveFacetLabel(...) : undefined` false arm.
      getTimestamp: (a) => a.capturedAt,
      getTitle: (a) => a.title,
      getSubtitle: (a) => `subtitle-${a.id}`,
    };
    render(
      <AssetGrid<TestAsset>
        selectors={selectorsWithSubtitleNoSource}
        dependencies={fakeDeps(assets)}
        renderThumbnail={() => <div data-testid="thumb" />}
        searchDebounceMs={0}
      />,
    );
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    expect(screen.getByText('subtitle-a')).toBeInTheDocument();
    expect(screen.queryByText('clipper')).not.toBeInTheDocument();
  });

  it('confirmDelete no-ops if the selection is cleared while the confirm dialog is still open (race guard)', async () => {
    const onDeleteSelected = vi.fn();
    renderGrid({ onDeleteSelected });
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Select asset' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    const dialog = await screen.findByRole('alertdialog');
    // The selection bar and the confirm dialog are independently conditioned
    // -- clearing the selection does not auto-close an already-open dialog.
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 0' }));
    expect(onDeleteSelected).not.toHaveBeenCalled();
  });

  it('Escape while the confirm dialog is open closes only the dialog, and does not also clear the grid selection (no stopPropagation misfire)', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Select asset' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // The dialog closes (its own dismiss-on-Escape)...
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // ...but the grid's own Cmd/Ctrl+A/Escape/Delete shortcut listener was
    // gated off (`enabled: !confirmDeleteOpen`) the whole time the dialog was
    // open, so the selection survives -- proving DeleteConfirmDialog's switch
    // to `useDismissOnOutsideOrEscape` (which does not call
    // `stopPropagation()`, unlike the raw listener it replaced) doesn't leak
    // the same Escape keypress into the grid's own shortcut handler.
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('translates its strings under an I18nProvider dictionary', async () => {
    const assets = makeAssets();
    render(
      <I18nProvider
        initialLocale="fr"
        dictionaries={{
          fr: {
            'No assets yet.': 'Aucun élément.',
            Refresh: 'Actualiser',
            'Select asset': 'Sélectionner',
            'Select all': 'Tout sélectionner',
            'Delete {count}': 'Supprimer {count}',
          },
        }}
      >
        <AssetGrid<TestAsset>
          selectors={selectors}
          dependencies={fakeDeps(assets)}
          renderThumbnail={() => <div />}
          searchDebounceMs={0}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Actualiser' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Sunset photo')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Sélectionner' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Tout sélectionner' }));
    expect(screen.getByRole('button', { name: 'Supprimer 2' })).toBeInTheDocument();
  });
});

describe('AssetGrid hook override 4-pattern test suite', () => {
  it('Pattern 1 — State 1: Default empty state via useWiredAssetGridData hook override', () => {
    const customDataHook = () => ({
      assets: [],
      setAssets: vi.fn(),
      loading: false,
      reload: vi.fn(),
    });

    render(
      <AssetGrid<TestAsset>
        selectors={selectors}
        renderThumbnail={() => <div />}
        useWiredAssetGridData={customDataHook as any}
      />,
    );

    expect(screen.getByText('No assets yet.')).toBeInTheDocument();
  });

  it('Pattern 2 — State 2: Active loading state via useWiredAssetGridData hook override', () => {
    const customDataHook = () => ({
      assets: [],
      setAssets: vi.fn(),
      loading: true,
      reload: vi.fn(),
    });

    render(
      <AssetGrid<TestAsset>
        selectors={selectors}
        renderThumbnail={() => <div />}
        useWiredAssetGridData={customDataHook as any}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('Pattern 3 — State 3: Multi-selection bar state via useAssetGridSelection hook override', () => {
    const mockClearSelection = vi.fn();
    const assets = makeAssets();

    const customDataHook = () => ({
      assets,
      setAssets: vi.fn(),
      loading: false,
      reload: vi.fn(),
    });

    const customSelectionHook = () => ({
      selectedIds: new Set(['a', 'b']),
      setSelectedIds: vi.fn(),
      toggleOne: vi.fn(),
      rangeTo: vi.fn(),
      selectAll: vi.fn(),
      clearSelection: mockClearSelection,
    });

    render(
      <AssetGrid<TestAsset>
        selectors={selectors}
        renderThumbnail={() => <div />}
        useWiredAssetGridData={customDataHook as any}
        useAssetGridSelection={customSelectionHook as any}
      />,
    );

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(mockClearSelection).toHaveBeenCalledTimes(1);
  });

  it('Pattern 4 — State 4: Dynamic full state transition walkthrough using React useState inside hook override', () => {
    function useTestDynamicData() {
      const [assets, setAssets] = useState<TestAsset[]>(makeAssets());
      const [loading, setLoading] = useState(false);

      const reload = () => {
        setLoading(true);
        setTimeout(() => {
          setAssets([makeAssets()[0]!]);
          setLoading(false);
        }, 10);
      };

      return { assets, setAssets, loading, reload };
    }

    render(
      <AssetGrid<TestAsset>
        selectors={selectors}
        renderThumbnail={() => <div />}
        useWiredAssetGridData={useTestDynamicData as any}
      />,
    );

    expect(screen.getByText('Sunset photo')).toBeInTheDocument();
    expect(screen.getByText('Demo clip')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  });
});
