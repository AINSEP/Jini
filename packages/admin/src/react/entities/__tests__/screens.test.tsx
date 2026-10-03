import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort, AdminEntityRowData } from '../../../core/ports/entities.js';
import { matchRoute } from '../../../core/routing/rules.js';
import { EntityList } from '../EntityList.js';
import { EntityDetail } from '../EntityDetail.js';
import { EntityEdit } from '../EntityEdit.js';
import { createEntityPanel, createEntityRoutes } from '../contribution.js';
import type { EntityRegistryPort } from '../types.js';

const descriptor = {
  name: 'items', labelSingular: 'Item', labelPlural: 'Items', titleField: 'title',
  fields: [
    { name: 'title', kind: 'text', required: true },
    { name: 'note', kind: 'text' },
    { name: 'active', kind: 'boolean', required: true },
    { name: 'payload', kind: 'json' },
  ],
} as const;

function fixture() {
  const row = { id: 'new', title: 'Stored item', note: 'Old note', active: false, payload: { x: 1 } };
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: [row], nextCursor: null })),
    get: vi.fn(async () => row),
    create: vi.fn(async (input) => ({ ...input, id: 'created' })),
    update: vi.fn(async (id, input) => ({ ...input, id })),
    remove: vi.fn(async () => undefined),
  };
  const registry: EntityRegistryPort = {
    listEntities: () => [port],
    getEntity: ({ name }) => name === 'items' ? port : null,
  };
  const navigate = vi.fn();
  const routes = createEntityRoutes({ adminBase: '/console', panelId: 'data', navigate });
  const translate = ({ key }: { readonly key: string }) => `tr:${key}`;
  return { port, registry, routes, navigate, translate, row };
}

describe('entity screens', () => {
  it('supports registries that return fresh diagnostic wrappers on each lookup', async () => {
    const f = fixture();
    f.registry.getEntity = ({ name }) => name === 'items' ? { ...f.port } : null;
    render(<EntityList {...f} entityName="items" limitParam={null} />);
    await screen.findByText('Stored item');
    expect(f.port.list).toHaveBeenCalledTimes(1);
  });

  it('renders descriptor columns through the port and preserves server order without sort controls', async () => {
    const f = fixture();
    render(<EntityList {...f} entityName="items" limitParam="2" />);
    expect(await screen.findByRole('link', { name: 'Stored item' })).toHaveAttribute('href', '/console/data/items/row/new');
    expect(f.port.list).toHaveBeenCalledWith({ limit: 2 });
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('tr:title');
    for (const header of headers) expect(within(header).queryByRole('button')).toBeNull();
    expect(screen.getByText('tr:No')).toBeInTheDocument();
  });

  it('walks opaque cursors and returns to the prior cursor even when pages are shorter than limit', async () => {
    const f = fixture();
    const list = vi.fn(async (query?: { cursor?: string }) => query?.cursor
      ? { items: [{ ...f.row, id: 'b', title: 'Second' }], nextCursor: null }
      : { items: [f.row], nextCursor: 'opaque+cursor' });
    f.port.list = list;
    render(<EntityList {...f} entityName="items" limitParam="25" />);
    await screen.findByText('Stored item');
    fireEvent.click(screen.getByRole('button', { name: 'tr:Next' }));
    await screen.findByText('Second');
    expect(list).toHaveBeenLastCalledWith({ limit: 25, cursor: 'opaque+cursor' });
    expect(screen.getByText('tr:Showing 2–2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tr:Previous' }));
    await screen.findByText('Stored item');
    expect(list).toHaveBeenLastCalledWith({ limit: 25 });
  });

  it('renders read-only detail and hides removal when the port lacks that capability', async () => {
    const f = fixture();
    delete f.port.remove;
    render(<EntityDetail {...f} entityName="items" id="new" />);
    await screen.findByRole('heading', { name: 'Stored item' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'tr:Delete' })).toBeNull();
    expect(screen.getByRole('link', { name: 'tr:Edit' })).toHaveAttribute('href', '/console/data/items/row/new/edit');
  });

  it('blocks malformed JSON then creates only declared filled fields and the required false boolean', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="items" id={null} />);
    fireEvent.change(await screen.findByLabelText('tr:title *'), { target: { value: 'Fresh' } });
    const json = screen.getByLabelText('tr:payload');
    fireEvent.change(json, { target: { value: '{bad' } });
    expect(screen.getByRole('button', { name: 'tr:Save' })).toBeDisabled();
    fireEvent.change(json, { target: { value: '{"x":2}' } });
    fireEvent.click(screen.getByRole('button', { name: 'tr:Save' }));
    await waitFor(() => expect(f.port.create).toHaveBeenCalledWith({ title: 'Fresh', active: false, payload: { x: 2 } }));
    await waitFor(() => expect(f.navigate).toHaveBeenCalledWith({ routePath: '/data/items/row/created' }));
  });

  it('sends explicit undefined to clear an optional field on update', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="items" id="new" />);
    const note = await screen.findByLabelText('tr:note');
    await waitFor(() => expect(note).toHaveValue('Old note'));
    fireEvent.change(note, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'tr:Save' }));
    await waitFor(() => expect(f.port.update).toHaveBeenCalledWith('new', { title: 'Stored item', note: undefined, active: false, payload: { x: 1 } }));
  });

  it('shows a missing row and does not permit saving it', async () => {
    const f = fixture();
    f.port.get = vi.fn(async () => null);
    render(<EntityEdit {...f} entityName="items" id="missing" />);
    expect(await screen.findByRole('status')).toHaveTextContent('tr:Row not found');
    expect(screen.queryByRole('button', { name: 'tr:Save' })).toBeNull();
  });

  it('displays failures from the adapter without navigating', async () => {
    const f = fixture();
    f.port.create = vi.fn(async () => { throw new Error('offline'); });
    render(<EntityEdit {...f} entityName="items" id={null} />);
    fireEvent.change(await screen.findByLabelText('tr:title *'), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'tr:Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('tr:Operation failed');
    expect(f.navigate).not.toHaveBeenCalled();
  });

  it('ignores a row read that settles after the screen changes entities', async () => {
    const f = fixture();
    let settle!: (row: AdminEntityRowData) => void;
    f.port.get = vi.fn(() => new Promise<AdminEntityRowData | null>((resolve) => { settle = resolve; }));
    const view = render(<EntityEdit {...f} entityName="items" id="pending" />);
    view.rerender(<EntityEdit {...f} entityName="unknown" id="pending" />);
    await waitFor(() => expect(settle).toBeTypeOf('function'));
    await act(async () => settle(f.row));
    expect(screen.getByRole('alert')).toHaveTextContent('tr:Unknown entity');
    expect(screen.queryByDisplayValue('Stored item')).toBeNull();
  });

  it('does not navigate when a save settles after its editor unmounts', async () => {
    const f = fixture();
    let settle!: (row: AdminEntityRowData) => void;
    f.port.create = vi.fn(() => new Promise<AdminEntityRowData>((resolve) => { settle = resolve; }));
    const view = render(<EntityEdit {...f} entityName="items" id={null} />);
    fireEvent.change(await screen.findByLabelText('tr:title *'), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'tr:Save' }));
    await waitFor(() => expect(settle).toBeTypeOf('function'));
    view.unmount();
    await act(async () => settle({ ...f.row, id: 'saved' }));
    expect(f.navigate).not.toHaveBeenCalled();
  });

  it('ignores repeated save calls while a mutation is pending', async () => {
    const f = fixture();
    let settle!: (row: AdminEntityRowData) => void;
    f.port.create = vi.fn(() => new Promise<AdminEntityRowData>((resolve) => { settle = resolve; }));
    render(<EntityEdit {...f} entityName="items" id={null} />);
    fireEvent.change(await screen.findByLabelText('tr:title *'), { target: { value: 'Fresh' } });
    const save = screen.getByRole('button', { name: 'tr:Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(settle).toBeTypeOf('function'));
    expect(f.port.create).toHaveBeenCalledTimes(1);
    await act(async () => settle({ ...f.row, id: 'saved' }));
  });

  it('removes through the existing port then returns to the entity list', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="items" id="new" />);
    const remove = await screen.findByRole('button', { name: 'tr:Delete' });
    fireEvent.click(remove);
    await waitFor(() => expect(f.port.remove).toHaveBeenCalledWith('new'));
    await waitFor(() => expect(f.navigate).toHaveBeenCalledWith({ routePath: '/data/items' }));
  });
});

describe('shell contribution', () => {
  it('keeps dot-segment ids inside the contributed URL space', () => {
    const f = fixture();
    expect(new URL(f.routes.href({ entity: '..', id: '.' }), 'https://example.test').pathname).toBe('/console/data/~../row/~.');
    expect(f.routes.href({ entity: '~..', id: '~.' })).toBe('/console/data/%7E../row/%7E.');
  });

  it('uses the shell manifest and distinguishes create from a saved row named new', () => {
    const f = fixture();
    const panel = createEntityPanel({ ...f, adminBase: '/console', panelId: 'data', navigate: f.navigate });
    expect(panel.agentReachable).toBe(false);
    expect(panel.nav?.label).toBe('tr:Data');
    expect(matchRoute({ routePath: '/data/items/new', panels: [panel] }).view).toBe('create');
    expect(matchRoute({ routePath: '/data/items/row/new', panels: [panel] }).view).toBe('detail');
    expect(matchRoute({ routePath: '/data/items/row/new/edit', panels: [panel] }).view).toBe('edit');
    expect(f.routes.href({ entity: 'a/b', id: 'c?d', view: 'edit' })).toBe('/console/data/a%2Fb/row/c%3Fd/edit');
  });
});
