import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import { Suspense } from 'react';
import { createAdmin } from '../../../core/module/index.js';
import { createMemoryMediaApi, createMemoryMediaProviders } from '../../adapters/memory.js';
import { createOverlayController } from '../../../react/overlays.js';
import { media } from '../index.js';
import { MediaCard } from '../components/MediaCard.js';
import { MediaLightbox } from '../components/MediaLightbox.js';
import { UploadButton } from '../components/UploadButton.js';
import { MediaPortsContext } from '../hooks/MediaPorts.hooks.js';
import { ProvidersTab } from '../tabs/ProvidersTab.js';
import type { MediaApiPort, MediaEventsPort } from '../../ports.js';
// First lazy imports can take more than 1s on a shared machine; behavior assertions stay exact.
configure({ asyncUtilTimeout: 5000 });
const upload = { filename: 'zebra.png', contentType: 'image/png', dataBase64: 'aGVsbG8=' };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const memory = createMemoryMediaApi({});
  const image = await memory.upload(upload, { alt: 'Zebra', slug: 'zebra' });
  const clip = await memory.upload({ ...upload, filename: 'apple.webm', contentType: 'video/webm' });
  const untyped = { ...image, id: 'opaque', title: 'Unreadable', contentType: null, byteSize: 839680 };
  const api: MediaApiPort = { ...createMemoryMediaApi({ assets: [image, clip, untyped] }), originalUrl: ({ id }) => `/injected-original/${id}` };
  return { api, image, clip, untyped };
}
function mountPage({ api, events, requestedTab }: { api: MediaApiPort; events?: MediaEventsPort; requestedTab?: string }, { permissions = ['media.read', 'media.upload', 'media.update', 'media.trash', 'media.delete.force'] }: { permissions?: string[] } = {}) {
  const overlays = createOverlayController({}), module = media({ overlays });
  const admin = createAdmin({ modules: [module], ports: { mediaApi: api, ...(events ? { mediaEvents: events } : {}) } }, { permissions });
  const { Page, tabs } = module.react.pages.library;
  const changed = vi.fn();
  const view = render(<module.react.Provider admin={admin}><Suspense fallback="Loading">
    <Page tabs={tabs} description={admin.describe().pages[0]!} onTabChange={changed} {...(requestedTab ? { requestedTab } : {})} />
  </Suspense></module.react.Provider>);
  return { ...view, admin, overlays, changed };
}
// Counts render in the legacy pill beside the label; the tab's accessible name stays the bare label.
function tabCount({ name }: { name: string }) {
  return screen.getByRole('tab', { name }).querySelector('.jini-tab-bar-count');
}
describe('legacy library presentation guards', () => {
  // Several lazy tab mounts share this scenario; allow the same bounded startup window
  // as the existing lazy-page test on a busy shared host. All assertions remain exact.
  it('keeps full counts across search/type tabs, preserves sorting, and avoids filter rereads', async () => {
    const { api } = await fixture(); const list = vi.fn(api.list);
    mountPage({ api: { ...api, list } });
    await screen.findByRole('heading', { name: 'zebra.png' });
    expect(tabCount({ name: 'All' })).toHaveTextContent(/^3$/);
    expect(tabCount({ name: 'Images' })).toHaveTextContent(/^1$/);
    expect(tabCount({ name: 'Videos' })).toHaveTextContent(/^1$/);
    expect(screen.getByText('820 KB')).toBeInTheDocument();
    const order = screen.getByLabelText('Order by'); expect(order).toHaveValue('created');
    fireEvent.change(order, { target: { value: 'alphabetical' } });
    expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['apple.webm', 'Unreadable', 'zebra.png']);
    fireEvent.change(screen.getByLabelText('Search media'), { target: { value: 'zebra' } });
    expect(tabCount({ name: 'All' })).toHaveTextContent(/^3$/);
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'apple.webm' })).toBeNull());
    expect(screen.getByLabelText('Order by')).toHaveValue('alphabetical');
    expect(screen.getByLabelText('Search media')).toHaveValue('zebra');
    expect(await screen.findByText(/Some assets have no recorded content type/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Search media'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByRole('heading', { name: 'Unreadable' });
    expect(screen.queryByText(/Some assets have no recorded content type/)).toBeNull();
  }, 15000);
  it('distinguishes initial unknown counts from authoritative zero and gives type-specific empty copy', async () => {
    let finish!: (items: []) => void;
    const api: MediaApiPort = { ...createMemoryMediaApi({}), list: vi.fn(() => new Promise<[]>(resolve => { finish = resolve; })) };
    mountPage({ api });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.getByRole('tab', { name: 'Videos' })).toHaveTextContent(/^Videos$/);
    await act(async () => finish([]));
    expect(tabCount({ name: 'Videos' })).toHaveTextContent(/^0$/);
    fireEvent.click(screen.getByRole('tab', { name: 'Videos' }));
    await screen.findByText('No videos yet. Upload a video to see it here.');
  });
  it.each(['all', 'images', 'videos'])('honors the %s deep link and defaults invalid links to All', async requestedTab => {
    const { api } = await fixture(); mountPage({ api, requestedTab });
    await screen.findByRole('heading', { name: requestedTab === 'videos' ? 'apple.webm' : 'zebra.png' });
    const selected = screen.getByRole('tab', { name: requestedTab === 'all' ? 'All' : requestedTab === 'images' ? 'Images' : 'Videos' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tablist', { name: 'Media' })).toContainElement(selected);
  });
  it('rejects an invalid tab and publishes unchanged literal tab handles through a host callback', async () => {
    const { api } = await fixture(); const page = mountPage({ api, requestedTab: 'typo' });
    await screen.findByRole('heading', { name: 'Unreadable' });
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Videos' }));
    expect(page.changed).toHaveBeenCalledWith({ tab: 'videos' });
    expect(screen.getByRole('tab', { name: 'Videos' })).toHaveAttribute('data-agent-element', 'media-tab-videos');
  });
  it('rereads injected refresh events and unsubscribes/aborts on unmount', async () => {
    const { api } = await fixture(); let refresh!: () => void;
    const off = vi.fn(), list = vi.fn(api.list);
    const events: MediaEventsPort = { subscribe: ({ onRefresh }) => { refresh = onRefresh; return off; } };
    const view = mountPage({ api: { ...api, list }, events });
    await screen.findByRole('heading', { name: 'zebra.png' });
    const before = list.mock.calls.length;
    await api.upload({ ...upload, filename: 'new.png' });
    await act(async () => refresh()); await screen.findByRole('heading', { name: 'new.png' });
    expect(list.mock.calls.length).toBe(before + 1);
    const lastSignal = list.mock.calls.at(-1)?.[1]?.signal;
    view.unmount(); expect(off).toHaveBeenCalled(); expect(lastSignal?.aborted).toBe(true);
    const after = list.mock.calls.length;
    await act(async () => refresh()); expect(list.mock.calls.length).toBe(after);
  });
  it('publishes distinct original row handles and opens one form from eye and menu actions', async () => {
    const { api, image } = await fixture(); mountPage({ api });
    await screen.findByRole('heading', { name: 'zebra.png' });
    const handles = [...document.querySelectorAll<HTMLElement>('button[data-agent-element]')].map(node => node.dataset.agentElement);
    expect(new Set(handles).size).toBe(handles.length);
    const edit = document.querySelector<HTMLElement>(`[data-agent-element="media-item-${image.id}-edit"]`)!;
    // Legacy heading: the dialog is named after the asset being edited.
    fireEvent.click(edit); await screen.findByRole('dialog', { name: 'Editing "zebra.png"' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(document.querySelector<HTMLElement>(`[data-agent-element="media-item-${image.id}-menu"]`)!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit metadata' }));
    expect(await screen.findByRole('dialog', { name: 'Editing "zebra.png"' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog', { name: 'Editing "zebra.png"' })).toHaveLength(1);
    expect(screen.getByLabelText('Title')).toHaveValue('zebra.png');
  });
  it('does not read protected media when the page grant is absent', async () => {
    const { api } = await fixture(); const list = vi.fn(api.list);
    mountPage({ api: { ...api, list } }, { permissions: [] });
    await screen.findByText('Permission denied');
    expect(list).not.toHaveBeenCalled();
  });
});
describe('preview and lightbox parity', () => {
  it('uses the injected original URL, image click/keyboard target, and independent video controls', async () => {
    const { api, image } = await fixture(); const preview = vi.fn(), edit = vi.fn();
    render(<MediaCard api={api} item={image} onPreview={preview} onEdit={edit} />);
    const img = screen.getByRole('img'); expect(img).toHaveAttribute('src', `/injected-original/${image.id}`);
    expect(img).toHaveAttribute('alt', 'Zebra');
    fireEvent.click(img); expect(preview).toHaveBeenCalledTimes(1);
    fireEvent.error(img);
    const video = document.querySelector('video')!;
    expect(video).toHaveAttribute('controls'); expect(video).not.toHaveAttribute('autoplay');
    expect(video.closest('button')).toBeNull();
    fireEvent.click(video); expect(preview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'View "zebra.png" larger' })); expect(preview).toHaveBeenCalledTimes(2);
    fireEvent.error(video);
    expect(screen.queryByRole('button', { name: 'View "zebra.png" larger' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute('href', `/injected-original/${image.id}`);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "zebra.png"' })); expect(edit).toHaveBeenCalledTimes(1);
  });
  it('clamps arrow navigation, resets fallback per ID, and restores focus on controlled Escape', async () => {
    const { api, image, clip } = await fixture();
    const navigate = vi.fn(), close = vi.fn();
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const props = { api, items: [image, clip], onNavigate: navigate, onClose: close };
    const view = render(<MediaLightbox {...props} activeIndex={0} />);
    const dialog = screen.getByRole('dialog', { name: 'Media preview: zebra.png' });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(document.querySelector('[data-agent-element="media-lightbox-close"]')).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' }); expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' }); expect(navigate).toHaveBeenCalledWith(1);
    fireEvent.error(screen.getByRole('img')); expect(document.querySelector('video')).toBeInTheDocument();
    view.rerender(<MediaLightbox {...props} activeIndex={1} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', `/injected-original/${clip.id}`);
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    navigate.mockClear(); fireEvent.keyDown(dialog, { key: 'ArrowRight' }); expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' }); expect(navigate).toHaveBeenCalledWith(0);
    const cancel = new Event('cancel', { bubbles: true, cancelable: true }); fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true); expect(close).toHaveBeenCalledTimes(1);
    view.rerender(<MediaLightbox {...props} activeIndex={null} />);
    expect(trigger).toHaveFocus(); trigger.remove();
  });
  it('ignores content clicks and routes only backdrop clicks to controlled close', async () => {
    const { api, image } = await fixture(); const close = vi.fn();
    render(<MediaLightbox items={[image]} api={api} activeIndex={0} onNavigate={vi.fn()} onClose={close} />);
    fireEvent.click(screen.getByRole('img')); expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog')); expect(close).toHaveBeenCalledTimes(1);
  });
});
it('uploads only after submit with advisory video MIME support, exact bytes and trimmed alt then clears input', async () => {
  const uploadFile = vi.fn(async () => true);
  render(<UploadButton upload={uploadFile} />);
  const fileInput = screen.getByLabelText('File to upload');
  expect(fileInput).toHaveAttribute('data-agent-element', 'media-upload-file');
  expect(fileInput.getAttribute('accept')?.split(',')).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm']);
  fireEvent.change(screen.getByLabelText('Upload alt text'), { target: { value: '  Clip  ' } });
  const file = new File(['hello'], 'clip.webm', { type: 'video/webm' });
  fireEvent.change(fileInput, { target: { files: [file] } });
  expect(screen.getByText('clip.webm')).toBeInTheDocument(); expect(uploadFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(uploadFile).toHaveBeenCalledWith({ input: { filename: 'clip.webm', contentType: 'video/webm', dataBase64: 'aGVsbG8=' }, alt: 'Clip' }));
  expect(screen.getByLabelText('Upload alt text')).toHaveValue('');
  expect(screen.getByText('No file chosen')).toBeInTheDocument();
  expect(fileInput).toHaveValue('');
});
it('displays endpoint/model controls, persists them through one Save changes without touching secrets or siblings, and fails closed for old ports', async () => {
  const { api } = await fixture();
  const memory = createMemoryMediaProviders({ providers: [
    { id: 'example', label: 'Example', configured: true, baseUrl: 'https://old', model: 'old-model' },
    { id: 'sibling', label: 'Sibling', configured: true, baseUrl: 'https://sibling', model: 'sibling-model' },
  ] });
  // Legacy renders a model picker only for catalog entries that advertise models.
  const mediaProviders = { ...memory, catalog: [{ id: 'example', label: 'Example', models: ['old-model', 'new-model'] }, { id: 'sibling', label: 'Sibling' }] };
  const saveCredential = vi.spyOn(mediaProviders, 'saveCredential'), removeCredential = vi.spyOn(mediaProviders, 'removeCredential');
  const view = render(<MediaPortsContext.Provider value={{ mediaApi: api, mediaProviders }}><ProvidersTab params={{}} /></MediaPortsContext.Provider>);
  const url = await screen.findByLabelText('Example base URL');
  expect(url).toHaveValue('https://old');
  expect(screen.queryByLabelText('Sibling model')).toBeNull();
  fireEvent.change(url, { target: { value: 'https://new' } });
  fireEvent.change(screen.getByLabelText('Example model'), { target: { value: 'new-model' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(async () => expect(await mediaProviders.list({})).toEqual([
    { id: 'example', label: 'Example', configured: true, baseUrl: 'https://new', model: 'new-model' },
    { id: 'sibling', label: 'Sibling', configured: true, baseUrl: 'https://sibling', model: 'sibling-model' },
  ]));
  expect(saveCredential).not.toHaveBeenCalled(); expect(removeCredential).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Sibling base URL')).toHaveValue('https://sibling');
  const { saveSettings: _saveSettings, ...oldHost } = mediaProviders;
  view.rerender(<MediaPortsContext.Provider value={{ mediaApi: api, mediaProviders: oldHost }}><ProvidersTab params={{}} /></MediaPortsContext.Provider>);
  expect(await screen.findByLabelText('Example base URL')).toBeDisabled();
  expect(screen.getByLabelText('Example model')).toBeDisabled();
  // Credentials still save through the old per-provider method.
  expect(screen.getByLabelText('Example credential')).toBeEnabled();
});
