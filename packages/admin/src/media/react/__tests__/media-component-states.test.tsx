import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '../../../__tests__/fetch-query-support.js';
import { AdminConfigError } from '../../../core/module/index.js';
import { createOverlayController } from '../../../react/overlays.js';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort, MediaProvidersPort } from '../../ports.js';
import { media, useGallerySelection, useMediaPorts } from '../index.js';
import { MediaDialog } from '../components/MediaDialog.js';
import { MediaGrid } from '../components/MediaGrid.js';
import { MediaPicker } from '../components/MediaPicker.js';
import { ProvidersTab } from '../tabs/ProvidersTab.js';
import { MediaPortsContext } from '../hooks/MediaPorts.hooks.js';
import { useEditMediaPanel } from '../hooks/EditMediaPanel.hooks.js';
import { useMediaLibraryQuery } from '../hooks/MediaQuery.hooks.js';

afterEach(cleanup);
const input = { filename: 'photo.png', contentType: 'image/png', dataBase64: 'aGVsbG8=' };

describe('media picker factory', () => {
  async function picker() {
    const api = createMemoryMediaApi({});
    const overlays = createOverlayController({});
    const open = vi.spyOn(overlays, 'open');
    const port = media({ overlays }).factories.mediaPicker({ ports: { mediaApi: api }, permissions: ['media.read'] });
    return { port, open };
  }

  it('resolves null without opening an overlay when the caller already aborted', async () => {
    const { port, open } = await picker();
    const abort = new AbortController(); abort.abort();
    expect(await port.pick({ accept: [] }, { signal: abort.signal })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('cancels an open pick on dispose and refuses picks afterwards', async () => {
    const { port, open } = await picker();
    const pending = port.pick({ accept: ['image/*'] });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    port.dispose();
    expect(await pending).toBeNull();
    expect(await port.pick({ accept: [] })).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('media components', () => {
  it('renders nothing for a closed dialog', () => {
    const { container } = render(<MediaDialog open={false} title="Hidden" onClose={vi.fn()}>Body</MediaDialog>);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the default empty label and disables card actions while the grid is busy', async () => {
    const api = createMemoryMediaApi({});
    const { rerender } = render(<MediaGrid actions={[]} api={api} />);
    expect(screen.getByText('No media found')).toBeVisible();
    const item = await api.upload(input);
    const onEdit = vi.fn();
    rerender(<MediaGrid actions={[{ item, onEdit }]} api={api} busy />);
    expect(screen.getByRole('button', { name: `Actions for "${item.title}"` })).toBeDisabled();
    rerender(<MediaGrid actions={[{ item, onEdit }]} api={api} />);
    expect(screen.getByRole('button', { name: `Actions for "${item.title}"` })).toBeEnabled();
  });

  it('lets the picker retry a failed library read and search the library', async () => {
    const memory = createMemoryMediaApi({});
    await memory.upload(input);
    await memory.upload({ ...input, filename: 'other.png' });
    let fail = true;
    const list = vi.fn((query: Parameters<MediaApiPort['list']>[0], options?: Parameters<MediaApiPort['list']>[1]) => (fail ? Promise.reject(new Error('Library offline')) : memory.list(query, options)));
    render(<MediaPicker api={{ ...memory, list }} accept={['image/*']} onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Library offline');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    fireEvent.change(screen.getByLabelText('Search media'), { target: { value: 'other' } });
    await waitFor(() => expect(screen.getByLabelText('Search media')).toHaveValue('other'));
  });
});

describe('providers tab rendering', () => {
  it('reports an unreachable service without a provider port', async () => {
    render(<MediaPortsContext.Provider value={{ mediaApi: {} as MediaApiPort }}><ProvidersTab params={{}} /></MediaPortsContext.Provider>);
    expect(await screen.findByText('Could not reach the server. Showing local changes only.')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('reports a failed save of pending provider changes', async () => {
    const providers = {
      list: async () => [{ id: 'p1', label: 'Provider', configured: false }],
      saveChanges: vi.fn(async () => { throw new Error('denied'); }),
      saveCredential: vi.fn(), removeCredential: vi.fn(),
    } as unknown as MediaProvidersPort;
    render(<MediaPortsContext.Provider value={{ mediaApi: {} as MediaApiPort, mediaProviders: providers }}><ProvidersTab params={{}} /></MediaPortsContext.Provider>);
    fireEvent.change(await screen.findByLabelText('Provider base URL'), { target: { value: 'https://api.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Could not save media providers.')).toHaveAttribute('role', 'alert');
    expect(providers.saveChanges).toHaveBeenCalledTimes(1);
  });

  it('separates pinned providers from the rest and flags an unsafe base URL', async () => {
    const providers: MediaProvidersPort = {
      catalog: [{ id: 'pinned', label: 'Pinned' }, { id: 'other', label: 'Other' }],
      pinnedProviderIds: ['pinned'],
      list: async () => [{ id: 'pinned', label: 'Pinned', configured: false }, { id: 'other', label: 'Other', configured: false }],
      saveChanges: vi.fn(async () => []), saveCredential: vi.fn(), removeCredential: vi.fn(),
    } as unknown as MediaProvidersPort;
    const { container } = render(<MediaPortsContext.Provider value={{ mediaApi: {} as MediaApiPort, mediaProviders: providers }}><ProvidersTab params={{}} /></MediaPortsContext.Provider>);
    const otherUrl = await screen.findByLabelText('Other base URL');
    expect(container.querySelectorAll('hr.jini-media-provider-divider')).toHaveLength(1);
    fireEvent.change(otherUrl, { target: { value: 'not a url' } });
    expect(await screen.findByText(/Enter an absolute http/)).toHaveAttribute('role', 'alert');
  });
});

describe('media hooks', () => {
  it('fails loudly when media hooks run outside the bound provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useMediaPorts())).toThrow(AdminConfigError);
    expect(() => renderHook(() => useMediaPorts())).toThrow(/React scope unavailable: media/);
  });

  it('leaves the gallery unchanged for a self-move or a move involving unknown ids', () => {
    const onChange = vi.fn();
    const images = [{ mediaId: 'a', alt: '', caption: '' }, { mediaId: 'b', alt: '', caption: '' }];
    const { result } = renderHook(() => useGallerySelection({ images, onChange }));
    result.current.move({ mediaId: 'a', beforeId: 'a' });
    result.current.move({ mediaId: 'zz', beforeId: 'a' });
    result.current.move({ mediaId: 'a', beforeId: 'zz' });
    expect(onChange).not.toHaveBeenCalled();
    result.current.move({ mediaId: 'b', beforeId: 'a' });
    expect(onChange).toHaveBeenCalledWith([images[1], images[0]]);
  });

  it('routes replacement through the cached API only when the host supports it', async () => {
    const memory = createMemoryMediaApi({});
    const replace = vi.fn(async ({ id }: { id: string }) => (await memory.list({})).find(item => item.id === id)!);
    const withReplace = renderHook(() => useMediaLibraryQuery({ api: { ...memory, replace, replaceSupported: true } }));
    expect(typeof withReplace.result.current.api.replace).toBe('function');
    const { replace: _replace, restore: _restore, ...plain } = memory;
    const without = renderHook(() => useMediaLibraryQuery({ api: plain }));
    expect(without.result.current.api.replace).toBeUndefined();
    expect(without.result.current.api.restore).toBeUndefined();
  });

  it('answers false for a replacement requested before the edit controller exists', async () => {
    const api = createMemoryMediaApi({});
    const item: MediaAsset = await api.upload(input);
    const onSaved = vi.fn();
    let firstRender: ReturnType<typeof useEditMediaPanel> | undefined;
    renderHook(() => { const vm = useEditMediaPanel({ api, item, onSaved, onClose: vi.fn() } as unknown as Parameters<typeof useEditMediaPanel>[0]); firstRender ??= vm; return vm; });
    let result!: boolean;
    await act(async () => { result = await firstRender!.replace({ input }); });
    expect(result).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
