import { Suspense, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import { createLibraryController } from '../../controllers/library.controller.js';
import { createAdmin } from '../../../core/module/index.js';
import { createOverlayController } from '../../../react/overlays.js';
import { media } from '../index.js';
import { MediaLightbox } from '../components/MediaLightbox.js';
import { EditMediaPanel } from '../components/EditMediaPanel.js';
import type { MediaApiPort } from '../../ports.js';
const input = { filename: 'a.png', contentType: 'image/png', dataBase64: 'aA==' };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const memory = createMemoryMediaApi({});
  const a = await memory.upload(input), b = await memory.upload({ ...input, filename: 'b.png' });
  const api = { ...memory, originalUrl: ({ id }: { id: string }) => `/original/${id}` };
  return { api, a, b };
}
function page(api: MediaApiPort) {
  const feature = media({ overlays: createOverlayController({}) });
  const admin = createAdmin({ modules: [feature], ports: { mediaApi: api } }, { permissions: ['media.read', 'media.update', 'media.upload', 'media.trash', 'media.restore'] });
  const { Page, tabs } = feature.react.pages.library;
  render(<feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} /></Suspense></feature.react.Provider>);
}
// Upload and library each keep a persistent sr-only live region; only the announced text is non-empty.
function announcements() {
  return screen.getAllByRole('status').map(node => node.textContent).filter(Boolean);
}
it('continues lightbox navigation when a replaced preview loses focus to the document', async () => {
  const { api, a, b } = await fixture();
  function Preview() { const [index, setIndex] = useState<number | null>(0); return <MediaLightbox api={api} items={[a, b]} activeIndex={index} onNavigate={setIndex} onClose={() => setIndex(null)} />; }
  render(<Preview />);
  fireEvent.keyDown(document, { key: 'ArrowRight' }); expect(screen.getByText('2 / 2')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'ArrowLeft' }); expect(screen.getByText('1 / 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.keyDown(document, { key: 'ArrowRight' }); expect(screen.queryByRole('dialog')).toBeNull();
}, 20000);
it('opens the editor at Title and at the top even after a prior scrolled dialog', async () => {
  const { api, a } = await fixture();
  const view = render(<EditMediaPanel api={api} item={a} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Title')).toHaveFocus();
  const dialog = screen.getByRole('dialog'); dialog.scrollTop = 450;
  view.unmount(); render(<EditMediaPanel api={api} item={a} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Title')).toHaveFocus(); expect(screen.getByRole('dialog').scrollTop).toBe(0);
}, 20000);
it('keeps the existing grid mounted during uploads and focuses it without scrolling', async () => {
  const { api } = await fixture(); page(api); await screen.findByRole('heading', { name: 'a.png' }, { timeout: 10000 });
  const grid = document.querySelector<HTMLElement>('[data-jini-part="media.grid"]')!;
  const focus = vi.spyOn(grid, 'focus');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(api, 'list').mockImplementationOnce(async () => { await gate; return []; });
  fireEvent.change(screen.getByLabelText('File to upload'), { target: { files: [new File(['x'], 'new.png')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(api.list).toHaveBeenCalled());
  expect(grid.isConnected).toBe(true);
  await act(async () => { release(); });
  await screen.findByText('Uploaded new.png'); expect(grid.isConnected).toBe(true);
  expect(document.activeElement).not.toBe(document.body); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
}, 20000);
it('restores focus and announces Trash and Restore after their refreshes', async () => {
  const { api } = await fixture(); page(api); await screen.findByRole('heading', { name: 'a.png' }, { timeout: 10000 });
  const card = screen.getByRole('heading', { name: 'a.png' }).closest('article')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Actions for "a.png"' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Trash' }));
  await waitFor(() => expect(card).toHaveFocus()); expect(announcements()).toEqual(['Trashed a.png']);
  fireEvent.click(within(card).getByRole('button', { name: 'Actions for "a.png"' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
  await waitFor(() => expect(card).toHaveFocus()); expect(announcements()).toEqual(['Restored a.png']);
}, 20000);
it('announces Replace and returns focus without removing the grid', async () => {
  const { api } = await fixture(); page(api); await screen.findByRole('heading', { name: 'a.png' }, { timeout: 10000 });
  const grid = document.querySelector('[data-jini-part="media.grid"]')!;
  const card = screen.getByRole('heading', { name: 'a.png' }).closest('article')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Edit "a.png"' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('File to upload'), { target: { files: [new File(['replacement'], 'replacement.png')] } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Replace file' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(card).toHaveFocus()); expect(grid.isConnected).toBe(true);
  expect(announcements()).toEqual(['Replaced a.png']);
}, 20000);
it('accepts a second card Trash while the first write is pending and executes both in order', async () => {
  const { api, a, b } = await fixture();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const originalTrash = api.trash; const trash = vi.spyOn(api, 'trash'); trash.mockImplementationOnce(async required => { await gate; return originalTrash(required); });
  const controller = createLibraryController({ api }); await controller.load();
  const first = controller.trash({ id: a.id }); const second = controller.trash({ id: b.id });
  release(); expect(await first).toBe(true); expect(await second).toBe(true);
  expect(trash.mock.calls.map(([required]) => required.id)).toEqual([a.id, b.id]); controller.dispose();
}, 20000);
