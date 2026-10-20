import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort, AdminEntityRowData } from '../../../core/ports/entities.js';
import { EntityEdit } from '../EntityEdit.js';
import { EntityList } from '../EntityList.js';
import { createEntityRoutes } from '../contribution.js';
import type { EntityRegistryPort } from '../types.js';

// Load-failure, unknown-entity, labelled-field and truncated-relation states of the entity screens.
const descriptor = {
  name: 'items', labelSingular: 'Item', labelPlural: 'Items', titleField: 'title',
  fields: [
    { name: 'title', kind: 'text', required: true },
    { name: 'due', kind: 'datetime', label: 'Due date' },
    { name: 'count', kind: 'integer' },
    { name: 'tag', kind: 'relation', target: 'tags' },
    { name: 'meta', kind: 'json' },
  ],
} as const;
const tagDescriptor = { name: 'tags', labelSingular: 'Tag', labelPlural: 'Tags', titleField: 'title', fields: [{ name: 'title', kind: 'text' }] } as const;

function fixture({ tagsTruncated = false }: { tagsTruncated?: boolean } = {}) {
  const rows: AdminEntityRowData[] = [{ id: 'a', title: 'Alpha', count: 1.5 }];
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: rows, nextCursor: null })),
    get: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
    create: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'created' })),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ ...patch, id })),
  };
  const tags: AdminErasedEntityPort = {
    descriptor: tagDescriptor,
    list: vi.fn(async () => ({ items: [{ id: 't1', title: 'One' }], nextCursor: tagsTruncated ? 'more' : null })),
    get: vi.fn(async () => null),
    create: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'created' })),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ ...patch, id })),
  };
  const registry: EntityRegistryPort = {
    listEntities: () => [port, tags],
    getEntity: ({ name }) => ({ items: port, tags })[name] ?? null,
  };
  const routes = createEntityRoutes({ adminBase: '/console', panelId: 'data', navigate: vi.fn() });
  const translate = ({ key }: { readonly key: string }) => `tr:${key}`;
  return { port, registry, routes, translate };
}

afterEach(cleanup);

describe('EntityEdit states', () => {
  it('shows a load failure instead of the form', async () => {
    const f = fixture();
    f.port.get = vi.fn().mockRejectedValue(new Error('offline'));
    render(<EntityEdit {...f} entityName="items" id="a" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('tr:Unable to load row');
    expect(screen.queryByRole('button', { name: 'tr:Save' })).toBeNull();
  });

  it('labels fields by their declared label and marks datetimes as UTC', async () => {
    render(<EntityEdit {...fixture()} entityName="items" id={null} />);
    expect(await screen.findByLabelText('tr:Due date (tr:UTC)')).toHaveAttribute('type', 'datetime-local');
  });

  it('flags a stored value that does not fit its field kind', async () => {
    render(<EntityEdit {...fixture()} entityName="items" id="a" />);
    expect(await screen.findByText('tr:Invalid value')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tr:Save' })).toBeDisabled();
  });

  it('names relation targets whose options were cut at the limit', async () => {
    render(<EntityEdit {...fixture({ tagsTruncated: true })} entityName="items" id={null} />);
    expect(await screen.findByText('tr:Related names limited to 100 rows: tags')).toBeInTheDocument();
  });

  it('reports malformed JSON on its field', async () => {
    const { container } = render(<EntityEdit {...fixture()} entityName="items" id={null} />);
    await screen.findByLabelText('tr:meta');
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '{ broken' } });
    expect(screen.getByRole('alert')).toHaveTextContent('tr:Invalid JSON');
  });
});

describe('EntityList states', () => {
  it('rejects an entity the registry does not know without listing anything', () => {
    const f = fixture();
    render(<EntityList {...f} entityName="ghost" limitParam={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('tr:Unknown entity');
    expect(f.port.list).not.toHaveBeenCalled();
  });

  it('shows a load failure instead of the table', async () => {
    const f = fixture();
    f.port.list = vi.fn().mockRejectedValue(new Error('offline'));
    render(<EntityList {...f} entityName="items" limitParam={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('tr:Unable to load rows');
  });

  it('says there are no rows for an empty page', async () => {
    const f = fixture();
    f.port.list = vi.fn(async () => ({ items: [], nextCursor: null }));
    render(<EntityList {...f} entityName="items" limitParam={null} />);
    expect(await screen.findByRole('button', { name: 'tr:Next' })).toBeDisabled();
    expect(screen.getAllByText('tr:No rows').length).toBeGreaterThan(0);
    expect(screen.queryByText(/tr:Showing/)).toBeNull();
  });

  it('names relation targets whose options were cut at the limit', async () => {
    render(<EntityList {...fixture({ tagsTruncated: true })} entityName="items" limitParam={null} />);
    expect(await screen.findByText('tr:Related names limited to 100 rows: tags')).toBeInTheDocument();
  });

  it('a new page size restarts the cursor walk at the first page', async () => {
    const f = fixture();
    f.port.list = vi.fn(async (query?: { readonly cursor?: string }) => ({ items: [{ id: query?.cursor ?? 'a', title: query?.cursor ?? 'First' }], nextCursor: 'next' }));
    const view = render(<EntityList {...f} entityName="items" limitParam="10" />);
    await screen.findByText('First');
    fireEvent.click(screen.getByRole('button', { name: 'tr:Next' }));
    await screen.findByText('next');
    view.rerender(<EntityList {...f} entityName="items" limitParam="20" />);
    await screen.findByText('First');
    expect(f.port.list).toHaveBeenLastCalledWith({ limit: 20 });
    expect(screen.getByRole('button', { name: 'tr:Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'tr:Next' }));
    await screen.findByText('next');
    expect(f.port.list).toHaveBeenLastCalledWith({ limit: 20, cursor: 'next' });
  });
});
