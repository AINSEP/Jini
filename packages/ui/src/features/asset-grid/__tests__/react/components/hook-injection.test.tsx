// @vitest-environment jsdom
import { createRef, type MutableRefObject } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type TranslationDict, type useT } from '../../../../i18n/index.js';
import type { useInView } from '../../../../../react/hooks/useInView.js';
import { AssetCard } from '../../../react/components/AssetCard.js';
import { AssetGrid } from '../../../react/components/AssetGrid.js';
import { AssetGridBody } from '../../../react/components/AssetGridBody.js';
import { AssetGridToolbar } from '../../../react/components/AssetGridToolbar.js';
import { DeleteConfirmDialog } from '../../../react/components/DeleteConfirmDialog.js';
import { SelectionActionBar } from '../../../react/components/SelectionActionBar.js';
import { createFakeAssetGridDependencies } from '../../../dependencies.js';

/** A translator that is visibly not the key, so a test proves the injected hook (not the passthrough) ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

/** An in-view hook that reports the element as already visible. */
const useAlwaysInView: typeof useInView = <T extends Element>() => ({ ref: { current: null } as MutableRefObject<T | null>, inView: true });

const ES: TranslationDict = {
  Grid: 'Cuadrícula',
  Timeline: 'Cronología',
  'Select all': 'Seleccionar todo',
  Clear: 'Limpiar',
  'Delete 1 asset?': '¿Eliminar 1 recurso?',
  'Preview {title}': 'Vista previa de {title}',
  'No assets yet.': 'Aún no hay recursos.',
};

function inSpanish(ui: React.ReactNode) {
  return <I18nProvider dictionaries={{ es: ES }} initialLocale="es">{ui}</I18nProvider>;
}

const toolbarProps = {
  search: '',
  onSearchChange: vi.fn(),
  kind: '',
  onKindChange: vi.fn(),
  kindFacets: [],
  source: '',
  onSourceChange: vi.fn(),
  sourceFacets: [],
  viewMode: 'grid' as const,
  onViewModeChange: vi.fn(),
  onRefresh: vi.fn(),
  loading: false,
};

describe('AssetGridToolbar translation hook', () => {
  it('renders the injected translator output for the toolbar controls', () => {
    render(<AssetGridToolbar {...toolbarProps} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Refresh»' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '«Search»' })).toBeInTheDocument();
  });

  it('resolves the real provider by default and renders the translated string, not the key', () => {
    render(inSpanish(<AssetGridToolbar {...toolbarProps} />));
    expect(screen.getByRole('button', { name: 'Cuadrícula' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cronología' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grid' })).not.toBeInTheDocument();
  });
});

describe('SelectionActionBar translation hook', () => {
  const props = { selectedIds: ['a'], onSelectAll: vi.fn(), onClear: vi.fn(), onRequestDelete: vi.fn() };

  it('renders the injected translator output', () => {
    render(<SelectionActionBar {...props} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Select all»' })).toBeInTheDocument();
  });

  it('renders the translated string from the real provider', () => {
    render(inSpanish(<SelectionActionBar {...props} />));
    expect(screen.getByRole('button', { name: 'Seleccionar todo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpiar' })).toBeInTheDocument();
  });
});

describe('DeleteConfirmDialog hooks', () => {
  it('renders the injected translator output and hands the dismiss handler to the injected hook', () => {
    const onCancel = vi.fn();
    const useFakeDismiss = vi.fn();
    render(
      <DeleteConfirmDialog
        count={1}
        onCancel={onCancel}
        onConfirm={vi.fn()}
        useTHook={useQuotingT}
        useDismissOnOutsideOrEscapeHook={useFakeDismiss}
      />,
    );
    expect(screen.getByRole('heading', { name: '«Delete 1 asset?»' })).toBeInTheDocument();
    expect(useFakeDismiss).toHaveBeenCalledWith({ onDismiss: onCancel });
  });

  it('renders the translated heading from the real provider', () => {
    render(inSpanish(<DeleteConfirmDialog count={1} onCancel={vi.fn()} onConfirm={vi.fn()} />));
    expect(screen.getByRole('heading', { name: '¿Eliminar 1 recurso?' })).toBeInTheDocument();
  });
});

describe('AssetCard hooks', () => {
  const asset = { id: 'a1' };
  const cardProps = {
    asset,
    index: 0,
    selected: false,
    title: 'My Asset',
    renderThumbnail: () => <div data-testid="thumb" />,
    onToggle: vi.fn(),
    onRange: vi.fn(),
    onPreview: vi.fn(),
  };

  it('renders from the injected hooks: translator, in-view state, and card handlers', () => {
    const handlePreviewClick = vi.fn();
    render(
      <AssetCard
        {...cardProps}
        useTHook={useQuotingT}
        useInViewHook={useAlwaysInView}
        useAssetCardHook={() => ({ handlePreviewClick, handleCheckboxClick: vi.fn() })}
      />,
    );
    expect(screen.getByTestId('thumb')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '«Preview {title}»' })).toBeInTheDocument();
  });

  it('renders the translated, interpolated label from the real provider', () => {
    render(inSpanish(<AssetCard {...cardProps} />));
    expect(screen.getByRole('button', { name: 'Vista previa de My Asset' })).toBeInTheDocument();
  });
});

describe('AssetGridBody translation hook', () => {
  it('threads the injected translator into the body', () => {
    render(
      <AssetGridBody
        viewMode="grid"
        assets={[{ id: 'a', day: '2000-01-01' }]}
        getDayKey={(a: { day: string }) => a.day}
        containerRef={createRef<HTMLDivElement>()}
        onMouseDown={vi.fn()}
        selecting={false}
        renderCard={(a) => <div key={a.id} data-testid={`card-${a.id}`} />}
        useTHook={useQuotingT}
      />,
    );
    expect(screen.getByTestId('card-a')).toBeInTheDocument();
  });
});

describe('AssetGrid hooks', () => {
  const selectors = {
    getKind: (a: { id: string }) => a.id,
    getSource: () => undefined,
    getTimestamp: () => 0,
    getTitle: (a: { id: string }) => a.id,
  };
  const renderGrid = (ui: (deps: ReturnType<typeof createFakeAssetGridDependencies<{ id: string }>>) => React.ReactNode) =>
    render(ui(createFakeAssetGridDependencies<{ id: string }>({ assets: [], matchesQuery: () => true })));

  it('renders the injected translator output in the empty state', async () => {
    renderGrid((dependencies) => (
      <AssetGrid selectors={selectors} dependencies={dependencies} renderThumbnail={() => null} searchDebounceMs={0} useTHook={useQuotingT} />
    ));
    expect(await screen.findByText('«No assets yet.»')).toBeInTheDocument();
  });

  it('renders the translated empty state from the real provider', async () => {
    renderGrid((dependencies) =>
      inSpanish(<AssetGrid selectors={selectors} dependencies={dependencies} renderThumbnail={() => null} searchDebounceMs={0} />),
    );
    expect(await screen.findByText('Aún no hay recursos.')).toBeInTheDocument();
  });
});
