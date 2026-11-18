import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '../../../__tests__/fetch-query-support.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';
import { EditMediaPanel } from '../components/EditMediaPanel.js';
import { MediaCard, MediaPreview } from '../components/MediaCard.js';
import { MediaDialog } from '../components/MediaDialog.js';
import { MediaGrid } from '../components/MediaGrid.js';
import { MediaLightbox } from '../components/MediaLightbox.js';
import { MediaPicker } from '../components/MediaPicker.js';
import { MediaPurgeDialog } from '../components/MediaPurgeDialog.js';
import { UploadButton } from '../components/UploadButton.js';
import { MediaPage } from '../pages/MediaPage.js';
import { LibraryTab } from '../tabs/LibraryTab.js';
import { ProvidersTab } from '../tabs/ProvidersTab.js';

/**
 * @file One fake-hook output test per media component that takes its hook as a prop (hook-injection
 * rule). Each fake returns text the real hook can never produce, so seeing it rendered proves the
 * injected hook fed the markup. Components whose real hook reads the media ports context
 * (`MediaPage`, `LibraryTab`, `ProvidersTab`, `MediaPicker`) are rendered with no provider at all: the
 * real hook would throw there, so a clean render also proves it was not called. A fake returns only
 * the fields its component reads, hence the single `as` in `fake`. The `jini-` class-prefix loop
 * applies when a component moves, so it is not asserted here.
 */
afterEach(cleanup);

/** A fake view-model for hook `H`: the component under test reads only the fields given. */
const fake = <H extends (...args: never[]) => unknown>(vm: Partial<ReturnType<H>>) => vi.fn((..._args: Parameters<H>) => vm as ReturnType<H>);
const api = { originalUrl: () => '/media/x' } as unknown as MediaApiPort;
const asset = (patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'a1', title: 'REAL-TITLE', alt: '', contentType: null, publicUrl: null, status: 'active', sha256: 'x',
  caption: '', credit: '', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', version: 1, ...patch,
});
const NO_PICKS = { onChoose: () => undefined, onClose: () => undefined };

describe('media components render from their injected hooks', () => {
  it('MediaDialog renders the dialog the fake hook describes and nothing when it says closed', () => {
    const open = fake<typeof import('../hooks/MediaDialog.hooks.js').useMediaDialog>({ open: true, dialogProps: { open: true, title: 'FAKE-DIALOG', onClose: vi.fn(), children: 'FAKE-BODY' } });
    const { unmount } = render(<MediaDialog open={false} title="REAL" onClose={vi.fn()} useMediaDialogHook={open} />);
    expect(screen.getByText('FAKE-DIALOG')).toBeTruthy();
    expect(screen.queryByText('REAL')).toBeNull();
    unmount();
    const closed = fake<typeof import('../hooks/MediaDialog.hooks.js').useMediaDialog>({ open: false });
    const { container } = render(<MediaDialog open title="REAL" onClose={vi.fn()} useMediaDialogHook={closed} />);
    expect(container.innerHTML).toBe('');
  });

  it('MediaPurgeDialog shows the consequence text and accessible names of the fake hook', () => {
    const hook = fake<typeof import('../hooks/MediaPurgeDialog.hooks.js').useMediaPurgeDialog>({
      consequence: 'FAKE-CONSEQUENCE', actionAccessibleNames: { cancel: 'FAKE-CANCEL', confirm: 'FAKE-CONFIRM' },
    });
    render(<MediaPurgeDialog open pending={false} filename="REAL" onCancel={vi.fn()} onConfirm={vi.fn()} useMediaPurgeDialogHook={hook} />);
    expect(screen.getByText('FAKE-CONSEQUENCE')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'FAKE-CANCEL' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'FAKE-CONFIRM' })).toBeTruthy();
  });

  it('MediaGrid uses the class and empty label the fake hook returns', () => {
    const hook = fake<typeof import('../hooks/MediaGrid.hooks.js').useMediaGrid>({ className: 'FAKE-GRID', actions: [], emptyLabel: 'FAKE-EMPTY', api });
    const { container } = render(<MediaGrid actions={[{ item: asset() }]} api={api} useMediaGridHook={hook} />);
    expect(container.querySelector('.FAKE-GRID')).not.toBeNull();
    expect(screen.getByText('FAKE-EMPTY')).toBeTruthy();
  });

  it('MediaLightbox shows no media when the fake hook resolves no item', () => {
    const hook = fake<typeof import('../hooks/MediaLightbox.hooks.js').useMediaLightbox>({ item: null, lightbox: { open: false, title: 'FAKE-LIGHTBOX', index: 0, count: 0, onNavigate: vi.fn(), onClose: vi.fn() } });
    const { container } = render(<MediaLightbox items={[asset()]} api={api} activeIndex={0} onNavigate={vi.fn()} onClose={vi.fn()} useMediaLightboxHook={hook} />);
    expect(hook).toHaveBeenCalledOnce();
    expect(container.querySelector('.jini-media-lightbox-media')).toBeNull();
  });

  const cardVm = (patch: object = {}) => fake<typeof import('../hooks/MediaCard.hooks.js').useMediaCard>({
    item: asset({ title: 'FAKE-CARD-TITLE', id: 'fake' }), image: false, video: false, src: undefined, alt: 'FAKE-ALT', canPreview: false, imagePreview: false,
    busy: false, statusClassName: 'FAKE-STATUS', statusLabel: 'trashed', statusTone: 'success', menuItems: [], menuLabel: 'FAKE-MENU', menuAttrs: { 'data-agent-element': 'fake', 'data-agent-label': 'fake' },
    byteSize: 'FAKE-SIZE', metadataSeparator: '|', uploadDate: 'FAKE-DATE', ...patch,
  });

  it('MediaCard renders the title, status and metadata of the fake hook', () => {
    const { container } = render(<MediaCard item={asset()} api={api} useMediaCardHook={cardVm()} />);
    expect(screen.getByText('FAKE-CARD-TITLE')).toBeTruthy();
    expect(screen.getByText('trashed')).toBeTruthy();
    expect(screen.getByText('FAKE-SIZE')).toBeTruthy();
    expect(screen.queryByText('REAL-TITLE')).toBeNull();
    expect(container.querySelector('[data-media-id="fake"]')).not.toBeNull();
  });

  it('MediaPreview renders the placeholder state the fake hook selects', () => {
    render(<MediaPreview item={asset()} api={api} useMediaCardHook={cardVm({ src: '/fake/original' })} />);
    expect(screen.getByText('Preview not available')).toBeTruthy();
    expect(screen.getByText('Download original').getAttribute('href')).toBe('/fake/original');
  });

  it('EditMediaPanel uses the title, hint and save state of the fake hook', () => {
    const close = vi.fn();
    const hook = fake<typeof import('../hooks/EditMediaPanel.hooks.js').useEditMediaPanel>({
      title: 'FAKE-EDIT-TITLE', close, saving: false, fieldRows: [], copies: [], hint: 'FAKE-HINT', canReplace: false, snapshot: null, onSave: vi.fn(),
    });
    render(<EditMediaPanel item={asset()} api={api} onSaved={vi.fn()} onClose={vi.fn()} useEditMediaPanelHook={hook} />);
    expect(screen.getByText('FAKE-EDIT-TITLE')).toBeTruthy();
    expect(screen.getByText('FAKE-HINT')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalled();
  });

  it('MediaPicker routes the search box and retry through the fake hook', () => {
    const onSearch = vi.fn();
    const hook = fake<typeof import('../hooks/MediaPicker.hooks.js').useMediaPicker>({
      search: 'FAKE-SEARCH', onSearch, onClose: vi.fn(), loading: true, actions: [], api, snapshot: null, onRetry: vi.fn(),
    });
    render(<MediaPicker api={api} accept={[]} {...NO_PICKS} useMediaPickerHook={hook} />);
    expect(screen.getByLabelText('Search media')).toHaveProperty('value', 'FAKE-SEARCH');
    fireEvent.change(screen.getByLabelText('Search media'), { target: { value: 'q' } });
    expect(onSearch).toHaveBeenCalled();
    expect(screen.getByText('Loading media…')).toBeTruthy();
  });

  it('UploadButton shows the labels, file name and success text of the fake hook', () => {
    const onPress = vi.fn();
    const hook = fake<typeof import('../hooks/UploadButton.hooks.js').useUploadButton>({
      handles: { toolbar: 't', file: 'f', alt: 'a', submit: 's' }, chooseLabel: 'FAKE-CHOOSE', selectedFileName: 'FAKE-FILE', withAlt: false,
      label: 'FAKE-UPLOAD', success: 'FAKE-SUCCESS', error: null, onPress, disabled: false, uploadDisabled: false, multiple: true,
    });
    render(<UploadButton upload={vi.fn()} useUploadButtonHook={hook} />);
    expect(screen.getByText('FAKE-FILE')).toBeTruthy();
    expect(screen.getByText('FAKE-SUCCESS')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'FAKE-UPLOAD' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'FAKE-CHOOSE' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('MediaPage shows the permission notice of the fake hook without a ports provider', () => {
    const hook = fake<typeof import('../hooks/MediaPage.hooks.js').useMediaPage>({ denied: true, tabs: [], headerActions: null, library: null as never });
    const description = { label: 'FAKE-PAGE-TITLE' } as never;
    render(<MediaPage description={description} tabs={{}} useMediaPageHook={hook} />);
    expect(screen.getByText('FAKE-PAGE-TITLE')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Permission denied');
  });

  it('LibraryTab renders the success text and empty state of the fake hook without a ports provider', () => {
    const hook = fake<typeof import('../hooks/LibraryTab.hooks.js').useLibraryTab>({
      canUpload: false, orderBy: 'created', search: '', statusFilter: 'all', success: 'FAKE-SUCCESS', untyped: true, loading: false, snapshot: null,
      actions: [], emptyLabel: 'FAKE-EMPTY', mediaApi: api, items: [], lightboxIndex: null, editing: null, t: { untyped: 'FAKE-UNTYPED', loading: 'x' } as never,
      purgeDialog: { open: false, pending: false }, onOrder: vi.fn(), onSearch: vi.fn(), onStatus: vi.fn(), onNavigate: vi.fn(), closeLightbox: vi.fn(),
      cancelPurge: vi.fn(), confirmPurge: vi.fn(), onRetry: vi.fn(),
    });
    render(<LibraryTab params={{}} permissions={[]} useLibraryTabHook={hook} />);
    expect(screen.getByText('FAKE-SUCCESS')).toBeTruthy();
    expect(screen.getByText('FAKE-UNTYPED')).toBeTruthy();
    expect(screen.getByText('FAKE-EMPTY')).toBeTruthy();
  });

  it('ProvidersTab renders the labels of the fake hook and routes Save to it without a ports provider', () => {
    const save = vi.fn();
    const hook = fake<typeof import('../hooks/ProvidersTab.hooks.js').useProvidersTab>({
      rows: [], reload: vi.fn(), reloadDisabled: false, reloadLabel: 'FAKE-RELOAD', unreachable: true, empty: true, save, saveLabel: 'FAKE-SAVE',
      saveDisabled: false, saved: false, saveError: false, disabled: false, settingsDisabled: false,
    });
    render(<ProvidersTab params={{}} useProvidersTabHook={hook} />);
    expect(screen.getByText('FAKE-RELOAD')).toBeTruthy();
    fireEvent.click(screen.getByText('FAKE-SAVE'));
    expect(save).toHaveBeenCalledOnce();
  });
});
