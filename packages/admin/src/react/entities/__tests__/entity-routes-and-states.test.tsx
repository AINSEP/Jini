import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort } from '../../../core/ports/entities.js';
import { matchRoute } from '../../../core/routing/rules.js';
import { EntityCell } from '../EntityCell.js';
import { EntityDetail } from '../EntityDetail.js';
import { EntityIndex } from '../EntityIndex.js';
import { createEntityPanel, createEntityRoutes } from '../contribution.js';
import { loadEntityRow } from '../use-entity-read.js';
import type { EntityRegistryPort } from '../types.js';

afterEach(cleanup);
const translate = ({ key }: { readonly key: string }) => `tr:${key}`;

const tags: AdminErasedEntityPort = {
  descriptor: { name: 'tags', labelSingular: 'Tag', labelPlural: 'Tags', titleField: 'label', fields: [{ name: 'label', kind: 'text' }] },
  // The second tag has no usable title, so pickers and cells fall back to its id.
  list: vi.fn(async () => ({ items: [{ id: 't1', label: 'Red' }, { id: 't2', label: '' }], nextCursor: null })),
  get: vi.fn(async () => null), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
};
function itemsPort(get: AdminErasedEntityPort['get']): AdminErasedEntityPort {
  return {
    descriptor: { name: 'items', labelSingular: 'Item', labelPlural: 'Items', titleField: 'title',
      fields: [{ name: 'title', kind: 'text' }, { name: 'tag', kind: 'relation', target: 'tags' }, { name: 'active', kind: 'boolean' }] },
    list: vi.fn(async () => ({ items: [], nextCursor: null })), get, create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  };
}
function registryOf(...ports: AdminErasedEntityPort[]): EntityRegistryPort {
  return { listEntities: () => ports, getEntity: ({ name }) => ports.find(p => p.descriptor.name === name) ?? null };
}
const routes = createEntityRoutes({ adminBase: '/console', panelId: 'data', navigate: vi.fn() });

describe('entity index', () => {
  it('lists each registered entity with a link and its field count', () => {
    render(<EntityIndex registry={registryOf(itemsPort(vi.fn()), tags)} routes={routes} translate={translate} />);
    expect(screen.getByRole('heading', { name: 'tr:Data' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'tr:Items' })).toHaveAttribute('href', '/console/data/items');
    expect(screen.getByRole('row', { name: /tr:Tags tags 1/ })).toBeVisible();
  });

  it('says so when nothing is registered', () => {
    render(<EntityIndex registry={registryOf()} routes={routes} translate={translate} />);
    expect(screen.getByText('tr:No entities registered')).toBeVisible();
  });
});

describe('entity detail states', () => {
  it('rejects an unknown entity', async () => {
    render(<EntityDetail entityName="ghosts" id="1" registry={registryOf()} routes={routes} translate={translate} />);
    expect(screen.getByRole('alert')).toHaveTextContent('tr:Unknown entity');
    expect(await loadEntityRow({ registry: registryOf(), entityName: 'ghosts', id: '1' })).toEqual({ row: null, relations: {} });
  });

  it('reports a failed read and a missing row', async () => {
    const failing = itemsPort(vi.fn(async () => { throw new Error('down'); }));
    const view = render(<EntityDetail entityName="items" id="1" registry={registryOf(failing, tags)} routes={routes} translate={translate} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('tr:Unable to load row');
    view.unmount();
    const missing = itemsPort(vi.fn(async () => null));
    render(<EntityDetail entityName="items" id="1" registry={registryOf(missing, tags)} routes={routes} translate={translate} />);
    expect(await screen.findByText('tr:Row not found')).toHaveAttribute('role', 'status');
  });

  it('titles an untitled row by its id and renders relation and boolean cells', async () => {
    const port = itemsPort(vi.fn(async () => ({ id: 'row-7', title: '', tag: 't2', active: true })));
    render(<EntityDetail entityName="items" id="row-7" registry={registryOf(port, tags)} routes={routes} translate={translate} />);
    expect(await screen.findByRole('heading', { name: 'row-7' })).toBeVisible();
    expect(screen.getByText('t2')).toBeVisible();
    expect(screen.getByText('tr:Yes')).toBeVisible();
  });
});

describe('entity cell', () => {
  const relation = { name: 'tag', kind: 'relation', target: 'tags' } as const;
  it('shows a resolved relation title, and flags an unresolved id', () => {
    const { rerender } = render(<EntityCell field={relation} row={{ id: 'r', tag: 't1' }} relations={{ tags: { titles: { t1: 'Red' }, truncated: false } }} translate={translate} />);
    expect(screen.getByText('Red')).toBeVisible();
    rerender(<EntityCell field={relation} row={{ id: 'r', tag: 'gone' }} relations={{}} translate={translate} />);
    expect(screen.getByText('gone ⚠')).toHaveAttribute('title', 'tr:Unresolved {target}: {id}'.replace('{target}', 'tags').replace('{id}', 'gone'));
  });

  it('renders false as No', () => {
    render(<EntityCell field={{ name: 'active', kind: 'boolean' }} row={{ id: 'r', active: false }} relations={{}} translate={translate} />);
    expect(screen.getByText('tr:No')).toBeVisible();
  });
});

describe('entity panel contribution', () => {
  const registry = registryOf(itemsPort(vi.fn(async () => ({ id: '..', title: 'Dotted', tag: null, active: false }))), tags);
  const panel = createEntityPanel({ registry, translate, adminBase: '/console', panelId: 'data', navigate: vi.fn() }, { requires: ['entities'], permissions: ['data.read'] });
  const renderPath = (routePath: string) => render(panel.render({ route: matchRoute({ routePath, panels: [panel] }) } as Parameters<typeof panel.render>[0]) as ReactElement);

  it('carries host gating options onto the panel', () => {
    expect(panel.requires).toEqual(['entities']);
    expect(panel.permissions).toEqual(['data.read']);
  });

  it('renders the index, then a dot-protected detail route', async () => {
    const index = renderPath('/data');
    expect(screen.getByRole('heading', { name: 'tr:Data' })).toBeVisible();
    index.unmount();
    renderPath('/data/items/row/~..');
    expect(await screen.findByRole('heading', { name: 'Dotted' })).toBeVisible();
  });

  it('renders the list, create and edit views for their routes', async () => {
    const list = renderPath('/data/items');
    expect(await screen.findByRole('heading', { name: 'tr:Items' })).toBeVisible();
    list.unmount();
    const create = renderPath('/data/items/new');
    expect(await screen.findByRole('heading', { name: /tr:New/ })).toBeVisible();
    create.unmount();
    renderPath('/data/items/row/~../edit');
    expect(await screen.findByRole('heading', { name: /tr:Edit/ })).toBeVisible();
  });

  it('treats a host route that carries a view but no entity param as an unknown entity', () => {
    const route = { panelId: 'data', view: 'list', params: {}, query: new URLSearchParams() };
    render(panel.render({ route } as unknown as Parameters<typeof panel.render>[0]) as ReactElement);
    expect(screen.getByRole('alert')).toHaveTextContent('tr:Unknown entity');
  });

  it('refuses a route whose segments do not decode', () => {
    renderPath('/data/items/row/%E0%A4%A');
    expect(screen.getByRole('alert')).toHaveTextContent('tr:Invalid route');
  });

  it('refuses empty segments and malformed panel ids or bases', () => {
    expect(() => routes.href({ entity: '' })).toThrow('Entity route segments must be non-empty');
    expect(() => createEntityRoutes({ adminBase: '/console', panelId: 'a/b', navigate: vi.fn() })).toThrow('Entity panelId must be one URL segment');
    for (const adminBase of ['console', '//evil.test', '/console?x=1']) {
      expect(() => createEntityRoutes({ adminBase, panelId: 'data', navigate: vi.fn() })).toThrow('Entity adminBase must be an absolute pathname');
    }
  });
});
