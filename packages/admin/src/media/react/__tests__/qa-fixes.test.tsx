import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import { createAdmin } from '../../../core/module/index.js';
import { createOverlayController } from '../../../react/overlays.js';
import { media } from '../index.js';
import { Suspense } from 'react';
import { MediaCard } from '../components/MediaCard.js';
import { MediaLightbox } from '../components/MediaLightbox.js';
import { UploadButton } from '../components/UploadButton.js';
import type { MediaApiPort } from '../../ports.js';
const input = { filename: 'photo.png', contentType: 'image/png', dataBase64: 'aA==' };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const memory = createMemoryMediaApi({}); const image = await memory.upload(input);
  const trash = await memory.upload({ ...input, filename: 'trash.png' }); await memory.trash({ id: trash.id });
  const api = { ...memory, originalUrl: ({ id }: { id: string }) => `/original/${id}` };
  return { api, image, trash };
}
function page(api: MediaApiPort) {
  const feature = media({ overlays: createOverlayController({}) }, { headerActions: <button>Publish media</button> });
  const admin = createAdmin({ modules: [feature], ports: { mediaApi: api } }, { permissions: ['media.read', 'media.update', 'media.trash', 'media.restore', 'media.delete.force'] });
  const { Page, tabs } = feature.react.pages.library;
  return render(<feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} /></Suspense></feature.react.Provider>);
}
it('renders an unmuted legacy video after image failure, then a placeholder after video failure', async () => {
  const { api, image } = await fixture();
  render(<MediaCard api={api} item={{ ...image, contentType: 'video/mp4' }} />);
  fireEvent.error(screen.getByRole('img'));
  const video = document.querySelector('video')!;
  // Legacy markup: audible by default and no playsinline.
  expect(video.muted).toBe(false); expect(video).not.toHaveAttribute('muted'); expect(video).not.toHaveAttribute('playsinline');
  fireEvent.error(video); expect(screen.getByText('Preview not available')).toBeInTheDocument();
});
it('hides the native picker, retains chosen files until explicit submit, and reports success', async () => {
  const upload = vi.fn(async (_required: { input: import('../../models.js').UploadInput; alt?: string }) => true); render(<UploadButton upload={upload} />);
  const picker = screen.getByLabelText('File to upload'); expect(picker).toHaveAttribute('hidden');
  expect(screen.getByRole('button', { name: 'Choose file' })).toBeEnabled();
  fireEvent.change(picker, { target: { files: [new File(['hello'], 'a.png', { type: 'image/png' })] } });
  expect(upload).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Upload alt text'), { target: { value: 'After choosing' } });
  // Legacy shows no success banner: the persistent sr-only live region exists empty, then announces.
  const live = screen.getByRole('status');
  expect(live).toHaveClass('jini-media-success'); expect(live).toHaveAttribute('aria-live', 'polite'); expect(live).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(live).toHaveTextContent(/^Uploaded a\.png$/));
  expect(upload.mock.calls[0]?.[0]).toMatchObject({ alt: 'After choosing' });
});
it('reports a false upload result and keeps file/alt for retry', async () => {
  render(<UploadButton upload={async () => false} />);
  fireEvent.change(screen.getByLabelText('File to upload'), { target: { files: [new File(['x'], 'a.png')] } });
  fireEvent.change(screen.getByLabelText('Upload alt text'), { target: { value: 'Keep' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed');
  expect(screen.getByLabelText('Upload alt text')).toHaveValue('Keep');
  expect(screen.getByText('a.png')).toBeInTheDocument();
});
it('drops multiple files into one upload flow with feedback', async () => {
  const upload = vi.fn(async (_required: { input: import('../../models.js').UploadInput; alt?: string }) => true); render(<UploadButton upload={upload} />);
  const zone = document.querySelector('[data-agent-element="media-upload-toolbar"]')!;
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.png'), new File(['y'], 'b.png')] } });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Uploaded a\.png, b\.png$/));
  expect(upload).toHaveBeenCalledTimes(2);
});
it('shows only an error after failure and recovers through Retry', async () => {
  const { api } = await fixture(); let unavailable = true;
  const list = vi.fn((query, options) => unavailable ? Promise.reject(new Error('HTTP 500')) : api.list(query, options));
  page({ ...api, list }); await screen.findByRole('alert');
  expect(screen.queryByText('Loading media…')).toBeNull();
  unavailable = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('heading', { name: 'photo.png' });
  expect(screen.queryByRole('alert')).toBeNull();
});
it('places host actions in the header, marks selected sort, and filters Trash with optional Restore pills', async () => {
  const { api, trash } = await fixture(); page(api);
  await screen.findByRole('heading', { name: 'photo.png' });
  expect(screen.getByText('Content')).toBeInTheDocument();
  expect(screen.getByText('Upload and manage image and video assets used across the site.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish media' }).closest('[data-jini-part="media.header.actions"]')).not.toBeNull();
  expect(screen.getByLabelText('Order by')).toHaveValue('created');
  fireEvent.change(screen.getByLabelText('Order by'), { target: { value: 'alphabetical' } });
  expect(screen.getByLabelText('Order by')).toHaveValue('alphabetical');
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'trashed' } });
  expect(screen.queryByRole('heading', { name: 'photo.png' })).toBeNull();
  expect(screen.getByText('trashed')).toHaveAttribute('data-jini-part', 'media.status');
  fireEvent.click(screen.getByRole('button', { name: 'Actions for "trash.png"' }));
  // Legacy's trashed menu plus the owner-requested Restore; no Trash on an already-trashed card.
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Edit metadata', 'Restore', 'Delete permanently']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'trash.png' })).toBeNull());
  expect((await api.list({})).find(row => row.id === trash.id)?.status).toBe('active');
});
it('names the permanent deletion and focuses the next card, then the empty grid', async () => {
  const { api, image } = await fixture(); await api.trash({ id: image.id }); page(api);
  await screen.findByRole('heading', { name: 'photo.png' });
  fireEvent.change(screen.getByLabelText('Order by'), { target: { value: 'alphabetical' } });
  const card = screen.getByRole('heading', { name: 'photo.png' }).closest('article')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Actions for "photo.png"' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete permanently' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(/permanently delete "photo.png"/i)).toBeInTheDocument();
  // Legacy plain action names; the consequence is the confirm button's accessible description.
  expect(within(dialog).getByRole('button', { name: 'Cancel', description: 'Permanently delete "photo.png"? This cannot be undone.' })).toHaveFocus();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently', description: 'Permanently delete "photo.png"? This cannot be undone.' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'trash.png' }).closest('article')).toHaveFocus());
  expect(screen.getByRole('status')).toHaveTextContent(/^Deleted permanently photo\.png$/);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for "trash.png"' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete permanently' }));
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete permanently', description: 'Permanently delete "trash.png"? This cannot be undone.' }));
  await waitFor(() => expect(document.querySelector('[data-jini-part="media.grid"]')).toHaveFocus());
  expect(screen.getByRole('status')).toHaveTextContent(/^Deleted permanently trash\.png$/);
});
it('provides one Close and an enlarged lightbox, hides closed overlays, and restores trigger focus', async () => {
  const { api, image } = await fixture(); const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const props = { api, items: [image], onNavigate: vi.fn(), onClose: vi.fn() };
  const view = render(<MediaLightbox {...props} activeIndex={0} />);
  expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  expect(screen.getByRole('dialog')).toHaveAttribute('data-jini-size', 'large');
  view.rerender(<MediaLightbox {...props} activeIndex={null} />);
  expect(document.querySelector('dialog')).toBeNull(); expect(trigger).toHaveFocus(); trigger.remove();
});
